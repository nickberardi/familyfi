/**
 * Recommended protection and the network checkup (#251): the checkup reads what sync read plus the
 * Wi-Fi networks, never writes to the gateway, keeps a dismissal while the finding is about the same
 * thing, and Block countries is a built-in rule enforced through UniFi's region filter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyRole, GroupKind } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { PATCH as patchRuleRoute } from "@/app/api/v1/rules/[id]/route";
import { checkupState, dismissFinding } from "@/server/checkup";
import { runCheckupNow } from "@/server/checkup-run";
import { unblockGroup as unblockGroupFn } from "@/server/group-unblock";
import { createGroup as createGroupFn, deleteGroup as deleteGroupFn } from "@/server/groups";
import { deleteRule as deleteRuleFn, switchRule, updateRule } from "@/server/rule-lifts";
import { listRules, RuleUpdateBody } from "@/server/rules";
import { syncStatus } from "@/server/sync-status";
import { checkupMessage, type CheckupState } from "@/lib/checkup";
import type { Rule } from "@/lib/rules";
import { APP_VERSION } from "@/lib/version";
import { prisma } from "@/server/db";
import { refreshUpdateCheck } from "@/server/update-check";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { createFixtureUnifiClient } from "@/server/unifi/dev-mock";
import type { MockUnifiClient } from "@/server/unifi/mock";
import { answered } from "../helpers/answered";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { adminSession } from "../helpers/session";
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

/** Who the cases act as: set for each test, once the database is reset. */
let session: Awaited<ReturnType<typeof adminSession>>;

async function checkup(): Promise<CheckupState> {
  const response = await answered("GET /api/v1/checkup", async () => ({ checkup: await checkupState() }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { checkup: CheckupState }).checkup;
}

const checkNow = () => answered("POST /api/v1/checkup/run", async () => ({ checkup: await runCheckupNow() }));

const dismiss = (id: string, dismissed: boolean) =>
  answered("PATCH /api/v1/checkup/findings/{id}", async () => ({ checkup: await dismissFinding(id, dismissed) }));

async function problems(): Promise<number> {
  return ((await (await answered("GET /api/v1/sync", () => syncStatus())).json()) as { checkupProblems: number }).checkupProblems;
}

async function rules(): Promise<Rule[]> {
  return ((await (await answered("GET /api/v1/rules", async () => ({ rules: await listRules() }))).json()) as { rules: Rule[] }).rules;
}

/** Changes a rule. A body the request schema refuses goes through the route, whose refusal that is. */
async function patchRule(id: string, body: object): Promise<Response> {
  const parsed = RuleUpdateBody.safeParse(body);
  if (parsed.success) return answered("PATCH /api/v1/rules/{id}", () => updateRule(session, id, parsed.data));
  return patchRuleRoute(request(`/api/v1/rules/${id}`, { method: "PATCH", auth: await signedIn(), headers: json, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

const patchCountries = (body: object) => patchRule("countries", body);
const createGroup = (name: string) =>
  answered("POST /api/v1/groups", () => createGroupFn({ kind: GroupKind.things, name }), 201);

const checks = (state: CheckupState) => state.findings.map((finding) => finding.check);

describe("network checkup", () => {
  let client: MockUnifiClient;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    session = await adminSession();
    // The mock household's gateway: Sonos wired and on Wi-Fi, two private addresses, mDNS off on IoT.
    client = createFixtureUnifiClient({ friendlyNames: true });
    setReconcileClientForTests(client);
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
    vi.restoreAllMocks();
  });

  it("runs after a sync, from what it read and the Wi-Fi networks, and writes nothing to the gateway", async () => {
    expect((await checkup()).ranAt).toBeNull();
    await runReconcileOnce();
    const state = await checkup();
    expect(state.ranAt).not.toBeNull();
    expect(state.error).toBeNull();
    expect(checks(state)).toEqual(["leftover_policies", "private_addresses", "wifi_multicast", "sonos_mdns", "sonos_mixed", "casting_mdns", "dns_override"]);
    // Nothing is in a Things group yet, so no Wi-Fi carries smart-home devices.
    expect(state.passed).toEqual(["gateway_drift", "smart_home_wifi", "unmanaged_networks", "update_tag"]);
    const privates = state.findings.find((finding) => finding.check === "private_addresses")!;
    expect(privates.details.devices?.map((device) => device.name)).toEqual(["Galaxy S24", "Melinda's iPhone"]);
    // Every finding carries its words, for an app too old to know its check.
    expect(privates.message).toEqual(checkupMessage(privates));
    expect(privates.message.key).toBe("checkup.private_addresses");
    // Sonos wired and on Wi-Fi, DNS and casting are notes, which the badge never counts. The fixture
    // gateway carries one policy named like FamilyFi's that no record claims: a leftover.
    expect(await problems()).toBe(4);
    // The checkup's reads are GETs; every write of the pass is a firewall policy.
    expect(client.calls.filter((call) => call.method !== "GET").every((call) => call.path.includes("/firewall/policies"))).toBe(true);
    expect(client.calls.some((call) => call.path.endsWith("/wifi/broadcasts"))).toBe(true);
  });

  it("runs at most once an interval from sync, and at once on Check now", async () => {
    await runReconcileOnce();
    const first = (await checkup()).ranAt;
    await runReconcileOnce();
    expect((await checkup()).ranAt).toBe(first);
    const response = await checkNow();
    expect(response.status).toBe(200);
    expect(((await response.json()) as { checkup: CheckupState }).checkup.ranAt).not.toBe(first);
  });

  it("keeps a dismissal while the finding is about the same devices, and brings it back when they change", async () => {
    await runReconcileOnce();
    const response = await dismiss("private_addresses", true);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { checkup: CheckupState }).checkup.findings.find((finding) => finding.id === "private_addresses")?.dismissed).toBe(true);
    expect(await problems()).toBe(3);

    await checkNow();
    expect((await checkup()).findings.find((finding) => finding.id === "private_addresses")?.dismissed).toBe(true);

    // A new phone with a private address: the finding is about something new, so it shows again.
    client.state.clients.push({ id: "44444444-4444-4444-8444-000000000999", name: "New Pixel", type: "WIRELESS", macAddress: "0a:00:00:00:0f:01", ipAddress: "192.0.2.199" });
    await runReconcileOnce();
    await checkNow();
    const again = (await checkup()).findings.find((finding) => finding.id === "private_addresses");
    expect(again?.dismissed).toBe(false);
    expect(again?.details.devices?.map((device) => device.name)).toContain("New Pixel");

    // The phone goes again: the finding is back to what was dismissed, but it changed since, so it stays shown.
    client.state.clients.pop();
    await prisma().device.delete({ where: { mac: "0a:00:00:00:0f:01" } });
    await checkNow();
    expect((await checkup()).findings.find((finding) => finding.id === "private_addresses")?.dismissed).toBe(false);

    expect((await dismiss("private_addresses", false)).status).toBe(200);
    expect((await dismiss("missing", true)).status).toBe(404);
  });

  it("keeps the Wi-Fi findings, and passes neither, when Wi-Fi cannot be read", async () => {
    await runReconcileOnce();
    client.listWifiBroadcasts = async () => {
      throw new Error("Wi-Fi unavailable");
    };
    await checkNow();
    const state = await checkup();
    expect(checks(state)).toContain("wifi_multicast");
    expect(state.passed).not.toContain("wifi_multicast");
    expect(state.passed).not.toContain("smart_home_wifi");
  });

  it("keeps the last findings and passes nothing when the network cannot be read", async () => {
    await runReconcileOnce();
    const before = checks(await checkup());
    client.listClients = async () => {
      throw new Error("Gateway unavailable");
    };
    await checkNow();
    const state = await checkup();
    expect(state.error).toBe("Gateway unavailable");
    expect(checks(state)).toEqual(before);
    expect(state.passed).toEqual([]);
  });

  it("drops a finding once it is no longer seen", async () => {
    await runReconcileOnce();
    const iot = client.state.wifiBroadcasts.find((wifi) => wifi.name === "Home IoT")!;
    iot.multicastToUnicastConversionEnabled = false;
    await checkNow();
    const state = await checkup();
    expect(checks(state)).not.toContain("wifi_multicast");
    expect(state.passed).toContain("wifi_multicast");
  });

  it("notes a FamilyFi policy changed in UniFi after the next sync, and whether it was changed back", async () => {
    await runReconcileOnce();
    const [recorded] = await prisma().appPolicy.findMany();
    const onGateway = () => client.state.policies.find((policy) => policy.id === recorded!.unifiPolicyId)!;
    const enabled = onGateway().enabled;
    onGateway().enabled = !enabled;
    vi.spyOn(client, "updatePolicy").mockRejectedValueOnce(new Error("gateway busy"));

    // Within the checkup's interval: sync records the note on its own.
    await runReconcileOnce();
    let note = (await checkup()).findings.find((finding) => finding.check === "gateway_drift")!;
    expect(note).toMatchObject({ id: "gateway_drift:quarantine", kind: "note", message: { key: "checkup.gateway_drift", text: "Quarantine was changed in UniFi" } });
    expect(note.details.drift).toMatchObject({ rule: { id: "quarantine", name: "Quarantine" }, changes: [{ field: "switch", familyfi: enabled, gateway: !enabled }], putBack: false });
    expect(await problems()).toBe(4);

    await runReconcileOnce();
    note = (await checkup()).findings.find((finding) => finding.check === "gateway_drift")!;
    expect(note.details.drift?.putBack).toBe(true);
    expect(onGateway().enabled).toBe(enabled);
    // A full checkup keeps it too.
    await checkNow();
    expect(checks(await checkup())).toContain("gateway_drift");

    // Dismissed, it stays dismissed until UniFi changes it again.
    expect((await dismiss(note.id, true)).status).toBe(200);
    await runReconcileOnce();
    expect((await checkup()).findings.find((finding) => finding.id === note.id)?.dismissed).toBe(true);
    onGateway().name = "Renamed in UniFi";
    await runReconcileOnce();
    const again = (await checkup()).findings.find((finding) => finding.id === note.id)!;
    expect(again.dismissed).toBe(false);
    expect(again.details.drift?.changes).toEqual([{ field: "name", familyfi: expect.any(String), gateway: "Renamed in UniFi" }]);

    // FamilyFi changing the policy itself ends the note.
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    await prisma().household.update({ where: { id: "default" }, data: { quarantineEnforced: !household.quarantineEnforced } });
    await runReconcileOnce();
    expect(checks(await checkup())).not.toContain("gateway_drift");
  });

  it("shows a newer release as a problem until it is installed, and a dismissal until the next one", async () => {
    const offering = (tag: string) => refreshUpdateCheck({ fetchImpl: async () => new Response(JSON.stringify([{ tag_name: `v${tag}` }]), { status: 200 }) });
    const failing = () => refreshUpdateCheck({ fetchImpl: async () => new Response("", { status: 503 }) });
    const [major, minor] = APP_VERSION.split(".").map(Number);
    const newer = `${major}.${minor! + 1}.0`;
    const newest = `${major}.${minor! + 2}.0`;
    try {
      await runReconcileOnce();
      const before = await problems();
      await offering(newer);
      let found = (await checkup()).findings.find((finding) => finding.check === "update_available");
      expect(found).toMatchObject({ id: "update_available", kind: "problem", details: { currentVersion: APP_VERSION, latestVersion: newer }, dismissed: false });
      expect(found!.message).toEqual({ key: "checkup.update_available", text: `FamilyFi v${newer} is ready` });
      expect(await problems()).toBe(before + 1);
      // Reads write only when the check's answer changed.
      const seen = async () => (await prisma().checkupFinding.findUniqueOrThrow({ where: { key: "update_available" } })).lastSeenAt.getTime();
      const first = await seen();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await checkup();
      await problems();
      expect(await seen()).toBe(first);
      // A checkup run leaves it to the update check.
      expect((await checkNow()).status).toBe(200);
      expect(checks(await checkup())).toContain("update_available");

      expect((await dismiss("update_available", true)).status).toBe(200);
      expect(await problems()).toBe(before);
      // A check that could not answer changes nothing.
      await failing();
      expect((await checkup()).findings.find((finding) => finding.check === "update_available")?.dismissed).toBe(true);
      await offering(newest);
      found = (await checkup()).findings.find((finding) => finding.check === "update_available");
      expect(found).toMatchObject({ details: { latestVersion: newest }, dismissed: false });

      // Once FamilyFi runs another release, a row from before goes while the check has no answer.
      await failing();
      await prisma().checkupFinding.update({ where: { key: "update_available" }, data: { details: { currentVersion: "0.0.1", latestVersion: newest } } });
      expect(checks(await checkup())).not.toContain("update_available");
      expect(await problems()).toBe(before);

      await offering(newest);
      expect(checks(await checkup())).toContain("update_available");
      await offering(APP_VERSION);
      const state = await checkup();
      expect(checks(state)).not.toContain("update_available");
      expect(state.passed).toContain("update_available");
      expect(await problems()).toBe(before);
    } finally {
      await failing();
    }
  });

  it("answers 409 on Check now before UniFi is set up", async () => {
    await prisma().household.update({ where: { id: "default" }, data: { connectionStatus: "unconfigured", unifiSiteId: null } });
    expect((await checkNow()).status).toBe(409);
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
    const list = await rules();
    expect(list.map((rule) => rule.id)).toEqual(["quarantine", "dns", "countries"]);
    const countries = list[2]!;
    expect(countries).toMatchObject({ builtIn: "countries", enabled: false, groupIds: [], countries: ["CN", "CU", "IR", "KP", "RU", "SY"] });
    expect(list[0]).not.toHaveProperty("countries");
  });

  it("covers every group when switched on, and blocks their devices by region through one policy", async () => {
    await runReconcileOnce();
    const groups = await prisma().group.findMany();
    expect(groups).toEqual([]);
    const kid = await prisma().group.create({ data: { kind: GroupKind.family, name: "Sam", familyRole: FamilyRole.child } });
    const things = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    const [phone, tv] = await prisma().device.findMany({ orderBy: { mac: "asc" }, take: 2 });
    await prisma().device.update({ where: { mac: phone!.mac }, data: { groupId: kid.id, assignment: "assigned" } });
    await prisma().device.update({ where: { mac: tv!.mac }, data: { groupId: things.id, assignment: "assigned" } });

    const on = await answered("POST /api/v1/rules/{id}/on", () => switchRule(session, "countries", true));
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
    expect((await patchCountries({ countries: ["kp", "IR"] })).status).toBe(200);
    await runReconcileOnce();
    const after = client.state.policies.filter((policy) => policy.destination?.trafficFilter?.type === "REGION");
    expect(after.map((policy) => policy.id).sort()).toEqual(policies.map((policy) => policy.id).sort());
    expect(after[0]!.destination.trafficFilter).toEqual({ type: "REGION", regionFilter: { regions: ["IR", "KP"] } });
  });

  it("takes only its switch, groups and countries, and is never deleted", async () => {
    expect((await patchCountries({ name: "Mine" })).status).toBe(409);
    expect((await patchCountries({ countries: ["ZZ"] })).status).toBe(400);
    expect((await patchCountries({ countries: [] })).status).toBe(400);
    expect((await patchCountries({ groupIds: [] })).status).toBe(400);
    expect((await answered("DELETE /api/v1/rules/{id}", () => deleteRuleFn("countries"))).status).toBe(409);
    const quarantine = await patchRule("quarantine", { countries: ["KP"] });
    expect(quarantine.status).toBe(409);
  });

  it("takes in a new group while it covers every group, and not once it is narrowed", async () => {
    const first = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    const second = await prisma().group.create({ data: { kind: GroupKind.things, name: "Games" } });
    expect((await patchCountries({ enabled: true })).status).toBe(200);
    const add = (name: string) =>
      createGroup(name);
    const joined = ((await (await add("Printers")).json()) as { group: { id: string } }).group.id;
    expect((await rules()).find((rule) => rule.id === "countries")!.groupIds!.sort()).toEqual([first.id, second.id, joined].sort());

    expect((await patchCountries({ groupIds: [first.id] })).status).toBe(200);
    await add("Cameras");
    expect((await rules()).find((rule) => rule.id === "countries")!.groupIds).toEqual([first.id]);
  });

  it("takes in every group created at once while it covers every group", async () => {
    await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    expect((await patchCountries({ enabled: true })).status).toBe(200);
    const add = (name: string) =>
      createGroup(name);
    await Promise.all(["Printers", "Cameras", "Speakers"].map(add));
    expect((await rules()).find((rule) => rule.id === "countries")!.groupIds).toHaveLength(4);
  });

  it("switched on before there are groups, takes in the first one", async () => {
    expect((await patchCountries({ enabled: true })).status).toBe(200);
    expect((await rules()).find((rule) => rule.id === "countries")!.groupIds).toEqual([]);
    const created = await createGroup("TV");
    const id = ((await created.json()) as { group: { id: string } }).group.id;
    expect((await rules()).find((rule) => rule.id === "countries")!.groupIds).toEqual([id]);
  });

  it("stays when the groups it covers are deleted, off while other groups are left", async () => {
    const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    const games = await prisma().group.create({ data: { kind: GroupKind.things, name: "Games" } });
    const remove = (id: string) => answered("DELETE /api/v1/groups/{id}", async () => ({ ok: true, ...(await deleteGroupFn(id)) }));
    expect((await patchCountries({ enabled: true, groupIds: [tv.id] })).status).toBe(200);
    await runReconcileOnce();
    expect((await remove(tv.id)).status).toBe(200);
    const countries = async () => (await rules()).find((rule) => rule.id === "countries");
    expect(await countries()).toMatchObject({ enabled: false, groupIds: [] });
    await runReconcileOnce();
    expect(client.state.policies.filter((policy) => policy.destination?.trafficFilter?.type === "REGION")).toEqual([]);

    // Covering the last group, it stays on, which means every group, and takes in the next one.
    expect((await patchCountries({ enabled: true, groupIds: [games.id] })).status).toBe(200);
    expect((await remove(games.id)).status).toBe(200);
    expect(await countries()).toMatchObject({ enabled: true, groupIds: [] });
  });

  it("never makes a group blocked, so an unblock leaves it alone", async () => {
    const tv = await prisma().group.create({ data: { kind: GroupKind.things, name: "TV" } });
    expect((await patchCountries({ enabled: true })).status).toBe(200);
    const unblock = (body: { until?: string }) =>
      answered("POST /api/v1/groups/{id}/unblock", () => unblockGroupFn(session, "unblock", tv.id, body));
    expect((await unblock({})).status).toBe(409);
    // Even given a time, Block countries is not one of the rules an unblock allows.
    await unblock({ until: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await prisma().ruleGroup.findUniqueOrThrow({ where: { ruleId_groupId: { ruleId: "countries", groupId: tv.id } } })).toMatchObject({ pauseActive: false });
  });
});
