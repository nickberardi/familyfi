/**
 * Recommended protection and the network checkup (#251): the checkup reads what sync read plus the
 * Wi-Fi networks, never writes to the gateway, keeps a dismissal while the finding is about the same
 * thing, and Block countries is a built-in rule enforced through UniFi's region filter.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FamilyRole, GroupKind } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getCheckup } from "@/app/api/v1/checkup/route";
import { POST as runCheckup } from "@/app/api/v1/checkup/run/route";
import { PATCH as patchFinding } from "@/app/api/v1/checkup/findings/[id]/route";
import { POST as createGroup } from "@/app/api/v1/groups/route";
import { DELETE as deleteGroup } from "@/app/api/v1/groups/[id]/route";
import { POST as unblockGroup } from "@/app/api/v1/groups/[id]/unblock/route";
import { GET as listRules } from "@/app/api/v1/rules/route";
import { DELETE as deleteRule, PATCH as patchRule } from "@/app/api/v1/rules/[id]/route";
import { POST as turnOnRule } from "@/app/api/v1/rules/[id]/on/route";
import { GET as getSync } from "@/app/api/v1/sync/route";
import type { CheckupState } from "@/lib/checkup";
import type { Rule } from "@/lib/rules";
import { prisma } from "@/server/db";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { createFixtureUnifiClient } from "@/server/unifi/dev-mock";
import type { MockUnifiClient } from "@/server/unifi/mock";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { configureConnectedHousehold, resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

async function signedIn(): Promise<SessionAuth> {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
    }),
  );
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

const json = { "content-type": "application/json" };

async function checkup(auth: SessionAuth): Promise<CheckupState> {
  const response = await getCheckup(request("/api/v1/checkup", { auth }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { checkup: CheckupState }).checkup;
}

async function checkNow(auth: SessionAuth): Promise<Response> {
  return runCheckup(request("/api/v1/checkup/run", { method: "POST", auth, headers: json, body: "{}" }));
}

async function dismiss(auth: SessionAuth, id: string, dismissed: boolean): Promise<Response> {
  return patchFinding(request(`/api/v1/checkup/findings/${id}`, { method: "PATCH", auth, headers: json, body: JSON.stringify({ dismissed }) }), {
    params: Promise.resolve({ id }),
  });
}

async function problems(auth: SessionAuth): Promise<number> {
  return ((await (await getSync(request("/api/v1/sync", { auth }))).json()) as { checkupProblems: number }).checkupProblems;
}

async function rules(auth: SessionAuth): Promise<Rule[]> {
  return ((await (await listRules(request("/api/v1/rules", { auth }))).json()) as { rules: Rule[] }).rules;
}

async function patchCountries(auth: SessionAuth, body: object): Promise<Response> {
  return patchRule(request("/api/v1/rules/countries", { method: "PATCH", auth, headers: json, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "countries" }),
  });
}

const checks = (state: CheckupState) => state.findings.map((finding) => finding.check);

describe("network checkup", () => {
  let client: MockUnifiClient;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    // The mock household's gateway: Sonos wired and on Wi-Fi, two private addresses, mDNS off on IoT.
    client = createFixtureUnifiClient({ friendlyNames: true });
    setReconcileClientForTests(client);
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("runs after a sync, from what it read and the Wi-Fi networks, and writes nothing to the gateway", async () => {
    const auth = await signedIn();
    expect((await checkup(auth)).ranAt).toBeNull();
    await runReconcileOnce();
    const state = await checkup(auth);
    expect(state.ranAt).not.toBeNull();
    expect(state.error).toBeNull();
    expect(checks(state)).toEqual(["private_addresses", "wifi_multicast", "sonos_mdns", "sonos_mixed", "casting_mdns", "dns_override"]);
    // Nothing is in a Things group yet, so no Wi-Fi carries smart-home devices.
    expect(state.passed).toEqual(["smart_home_wifi", "unmanaged_networks"]);
    const privates = state.findings.find((finding) => finding.check === "private_addresses")!;
    expect(privates.details.devices?.map((device) => device.name)).toEqual(["Galaxy S24", "Melinda's iPhone"]);
    // Sonos wired and on Wi-Fi, DNS and casting are notes, which the badge never counts.
    expect(await problems(auth)).toBe(3);
    // The checkup's reads are GETs; every write of the pass is a firewall policy.
    expect(client.calls.filter((call) => call.method !== "GET").every((call) => call.path.includes("/firewall/policies"))).toBe(true);
    expect(client.calls.some((call) => call.path.endsWith("/wifi/broadcasts"))).toBe(true);
  });

  it("runs at most once an interval from sync, and at once on Check now", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const first = (await checkup(auth)).ranAt;
    await runReconcileOnce();
    expect((await checkup(auth)).ranAt).toBe(first);
    const response = await checkNow(auth);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { checkup: CheckupState }).checkup.ranAt).not.toBe(first);
  });

  it("keeps a dismissal while the finding is about the same devices, and brings it back when they change", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const response = await dismiss(auth, "private_addresses", true);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { checkup: CheckupState }).checkup.findings.find((finding) => finding.id === "private_addresses")?.dismissed).toBe(true);
    expect(await problems(auth)).toBe(2);

    await checkNow(auth);
    expect((await checkup(auth)).findings.find((finding) => finding.id === "private_addresses")?.dismissed).toBe(true);

    // A new phone with a private address: the finding is about something new, so it shows again.
    client.state.clients.push({ id: "44444444-4444-4444-8444-000000000999", name: "New Pixel", type: "WIRELESS", macAddress: "0a:00:00:00:0f:01", ipAddress: "192.0.2.199" });
    await runReconcileOnce();
    await checkNow(auth);
    const again = (await checkup(auth)).findings.find((finding) => finding.id === "private_addresses");
    expect(again?.dismissed).toBe(false);
    expect(again?.details.devices?.map((device) => device.name)).toContain("New Pixel");

    // The phone goes again: the finding is back to what was dismissed, but it changed since, so it stays shown.
    client.state.clients.pop();
    await prisma().device.delete({ where: { mac: "0a:00:00:00:0f:01" } });
    await checkNow(auth);
    expect((await checkup(auth)).findings.find((finding) => finding.id === "private_addresses")?.dismissed).toBe(false);

    expect((await dismiss(auth, "private_addresses", false)).status).toBe(200);
    expect((await dismiss(auth, "missing", true)).status).toBe(404);
  });

  it("keeps the Wi-Fi findings, and passes neither, when Wi-Fi cannot be read", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    client.listWifiBroadcasts = async () => {
      throw new Error("Wi-Fi unavailable");
    };
    await checkNow(auth);
    const state = await checkup(auth);
    expect(checks(state)).toContain("wifi_multicast");
    expect(state.passed).not.toContain("wifi_multicast");
    expect(state.passed).not.toContain("smart_home_wifi");
  });

  it("keeps the last findings and passes nothing when the network cannot be read", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const before = checks(await checkup(auth));
    client.listClients = async () => {
      throw new Error("Gateway unavailable");
    };
    await checkNow(auth);
    const state = await checkup(auth);
    expect(state.error).toBe("Gateway unavailable");
    expect(checks(state)).toEqual(before);
    expect(state.passed).toEqual([]);
  });

  it("drops a finding once it is no longer seen", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const iot = client.state.wifiBroadcasts.find((wifi) => wifi.name === "Home IoT")!;
    iot.multicastToUnicastConversionEnabled = false;
    await checkNow(auth);
    const state = await checkup(auth);
    expect(checks(state)).not.toContain("wifi_multicast");
    expect(state.passed).toContain("wifi_multicast");
  });

  it("answers 409 on Check now before UniFi is set up", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { connectionStatus: "unconfigured", unifiSiteId: null } });
    const auth = await signedIn();
    expect((await checkNow(auth)).status).toBe(409);
  });
});

describe("Block countries", () => {
  let client: MockUnifiClient;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    client = createFixtureUnifiClient({ friendlyNames: true });
    setReconcileClientForTests(client);
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("is a built-in rule, off, with the recommended countries, after quarantine and Lock DNS", async () => {
    const auth = await signedIn();
    const list = await rules(auth);
    expect(list.map((rule) => rule.id)).toEqual(["quarantine", "dns", "countries"]);
    const countries = list[2]!;
    expect(countries).toMatchObject({ builtIn: "countries", enabled: false, groupIds: [], countries: ["CN", "CU", "IR", "KP", "RU", "SY"] });
    expect(list[0]).not.toHaveProperty("countries");
  });

  it("covers every group when switched on, and blocks their devices by region through one policy", async () => {
    const auth = await signedIn();
    await runReconcileOnce();
    const groups = await prisma().group.findMany();
    expect(groups).toEqual([]);
    const kid = await prisma().group.create({ data: { kind: GroupKind.family, name: "Sam", familyRole: FamilyRole.child } });
    const things = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    const [phone, tv] = await prisma().device.findMany({ orderBy: { mac: "asc" }, take: 2 });
    await prisma().device.update({ where: { mac: phone!.mac }, data: { groupId: kid.id, assignment: "assigned" } });
    await prisma().device.update({ where: { mac: tv!.mac }, data: { groupId: things.id, assignment: "assigned" } });

    const on = await turnOnRule(request("/api/v1/rules/countries/on", { method: "POST", auth, headers: json, body: "{}" }), { params: Promise.resolve({ id: "countries" }) });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { rule: Rule }).rule.groupIds!.sort()).toEqual([kid.id, things.id].sort());

    await runReconcileOnce();
    const policies = client.state.policies.filter((policy) => policy.destination?.trafficFilter?.type === "REGION");
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.action.type).toBe("BLOCK");
      expect(policy.destination.trafficFilter).toEqual({ type: "REGION", regionFilter: { regions: ["CN", "CU", "IR", "KP", "RU", "SY"] } });
    }
    const macs = policies.flatMap((policy) => (policy.source.trafficFilter?.type === "MAC_ADDRESS" ? (policy.source.trafficFilter.macAddressFilter?.macAddresses ?? []) : []));
    expect(macs.sort()).toEqual([phone!.mac, tv!.mac].sort());

    // Its list changes in place; FamilyFi owns the policy by id.
    expect((await patchCountries(auth, { countries: ["kp", "IR"] })).status).toBe(200);
    await runReconcileOnce();
    const after = client.state.policies.filter((policy) => policy.destination?.trafficFilter?.type === "REGION");
    expect(after.map((policy) => policy.id).sort()).toEqual(policies.map((policy) => policy.id).sort());
    expect(after[0]!.destination.trafficFilter).toEqual({ type: "REGION", regionFilter: { regions: ["IR", "KP"] } });
  });

  it("takes only its switch, groups and countries, and is never deleted", async () => {
    const auth = await signedIn();
    expect((await patchCountries(auth, { name: "Mine" })).status).toBe(409);
    expect((await patchCountries(auth, { countries: ["ZZ"] })).status).toBe(400);
    expect((await patchCountries(auth, { countries: [] })).status).toBe(400);
    expect((await patchCountries(auth, { groupIds: [] })).status).toBe(400);
    expect((await deleteRule(request("/api/v1/rules/countries", { method: "DELETE", auth }), { params: Promise.resolve({ id: "countries" }) })).status).toBe(409);
    const quarantine = await patchRule(request("/api/v1/rules/quarantine", { method: "PATCH", auth, headers: json, body: JSON.stringify({ countries: ["KP"] }) }), {
      params: Promise.resolve({ id: "quarantine" }),
    });
    expect(quarantine.status).toBe(409);
  });

  it("takes in a new group while it covers every group, and not once it is narrowed", async () => {
    const auth = await signedIn();
    const first = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    const second = await prisma().group.create({ data: { kind: GroupKind.things, name: "Games" } });
    expect((await patchCountries(auth, { enabled: true })).status).toBe(200);
    const add = (name: string) =>
      createGroup(request("/api/v1/groups", { method: "POST", auth, headers: json, body: JSON.stringify({ kind: "things", name }) }));
    const joined = ((await (await add("Printers")).json()) as { group: { id: string } }).group.id;
    expect((await rules(auth)).find((rule) => rule.id === "countries")!.groupIds!.sort()).toEqual([first.id, second.id, joined].sort());

    expect((await patchCountries(auth, { groupIds: [first.id] })).status).toBe(200);
    await add("Cameras");
    expect((await rules(auth)).find((rule) => rule.id === "countries")!.groupIds).toEqual([first.id]);
  });

  it("takes in every group created at once while it covers every group", async () => {
    const auth = await signedIn();
    await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    expect((await patchCountries(auth, { enabled: true })).status).toBe(200);
    const add = (name: string) =>
      createGroup(request("/api/v1/groups", { method: "POST", auth, headers: json, body: JSON.stringify({ kind: "things", name }) }));
    await Promise.all(["Printers", "Cameras", "Speakers"].map(add));
    expect((await rules(auth)).find((rule) => rule.id === "countries")!.groupIds).toHaveLength(4);
  });

  it("switched on before there are groups, takes in the first one", async () => {
    const auth = await signedIn();
    expect((await patchCountries(auth, { enabled: true })).status).toBe(200);
    expect((await rules(auth)).find((rule) => rule.id === "countries")!.groupIds).toEqual([]);
    const created = await createGroup(request("/api/v1/groups", { method: "POST", auth, headers: json, body: JSON.stringify({ kind: "things", name: "TV" }) }));
    const id = ((await created.json()) as { group: { id: string } }).group.id;
    expect((await rules(auth)).find((rule) => rule.id === "countries")!.groupIds).toEqual([id]);
  });

  it("stays when the groups it covers are deleted, off while other groups are left", async () => {
    const auth = await signedIn();
    const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    const games = await prisma().group.create({ data: { kind: GroupKind.things, name: "Games" } });
    const remove = (id: string) => deleteGroup(request(`/api/v1/groups/${id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id }) });
    expect((await patchCountries(auth, { enabled: true, groupIds: [tv.id] })).status).toBe(200);
    await runReconcileOnce();
    expect((await remove(tv.id)).status).toBe(200);
    const countries = async () => (await rules(auth)).find((rule) => rule.id === "countries");
    expect(await countries()).toMatchObject({ enabled: false, groupIds: [] });
    await runReconcileOnce();
    expect(client.state.policies.filter((policy) => policy.destination?.trafficFilter?.type === "REGION")).toEqual([]);

    // Covering the last group, it stays on, which means every group, and takes in the next one.
    expect((await patchCountries(auth, { enabled: true, groupIds: [games.id] })).status).toBe(200);
    expect((await remove(games.id)).status).toBe(200);
    expect(await countries()).toMatchObject({ enabled: true, groupIds: [] });
  });

  it("never makes a group blocked, so an unblock leaves it alone", async () => {
    const auth = await signedIn();
    const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    expect((await patchCountries(auth, { enabled: true })).status).toBe(200);
    const unblock = (body: object) =>
      unblockGroup(request(`/api/v1/groups/${tv.id}/unblock`, { method: "POST", auth, headers: json, body: JSON.stringify(body) }), { params: Promise.resolve({ id: tv.id }) });
    expect((await unblock({})).status).toBe(409);
    // Even given a time, Block countries is not one of the rules an unblock allows.
    await unblock({ until: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: "countries", groupId: tv.id } } })).toMatchObject({ pauseActive: false });
  });
});
