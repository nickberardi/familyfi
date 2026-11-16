/**
 * One call per response variant of each route whose logic is tested on its `src/server` function instead of
 * through the handler. Every response an integration test gets from a handler is checked against
 * `openapi/familyfi.v1.yaml` (tests/openapi-responses-plugin.ts), so these calls are what keeps
 * each route's success response matched to the contract: with its optional fields present and
 * absent, and each alternative its schema allows. They assert the status and nothing else: what
 * the route does is asserted where its function is tested.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listGroups, POST as createGroup } from "@/app/api/v1/groups/route";
import { DELETE as deleteGroup, GET as getGroup, PUT as updateGroup } from "@/app/api/v1/groups/[id]/route";
import { DELETE as clearResolver, GET as getResolver, PUT as setResolver } from "@/app/api/v1/groups/[id]/resolver/route";
import { POST as groupRuleAllow } from "@/app/api/v1/groups/[id]/rules/[ruleId]/allow/route";
import { POST as groupRuleDisallow } from "@/app/api/v1/groups/[id]/rules/[ruleId]/disallow/route";
import { POST as groupRuleExtend } from "@/app/api/v1/groups/[id]/rules/[ruleId]/extend/route";
import { POST as groupRulePause } from "@/app/api/v1/groups/[id]/rules/[ruleId]/pause/route";
import { POST as groupRuleResume } from "@/app/api/v1/groups/[id]/rules/[ruleId]/resume/route";
import { POST as unblock } from "@/app/api/v1/groups/[id]/unblock/route";
import { POST as unblockEnd } from "@/app/api/v1/groups/[id]/unblock/end/route";
import { POST as unblockExtend } from "@/app/api/v1/groups/[id]/unblock/extend/route";
import { GET as listRulesRoute, POST as createRuleRoute } from "@/app/api/v1/rules/route";
import { DELETE as deleteRuleRoute, GET as getRuleRoute, PATCH as patchRuleRoute } from "@/app/api/v1/rules/[id]/route";
import { POST as ruleAllow } from "@/app/api/v1/rules/[id]/allow/route";
import { POST as ruleDisallow } from "@/app/api/v1/rules/[id]/disallow/route";
import { POST as ruleExtend } from "@/app/api/v1/rules/[id]/extend/route";
import { POST as ruleOff } from "@/app/api/v1/rules/[id]/off/route";
import { POST as ruleOn } from "@/app/api/v1/rules/[id]/on/route";
import { POST as rulePause } from "@/app/api/v1/rules/[id]/pause/route";
import { POST as ruleResume } from "@/app/api/v1/rules/[id]/resume/route";
import { GET as listCategoriesRoute, POST as createCategoryRoute } from "@/app/api/v1/upstream/categories/route";
import { DELETE as deleteCategoryRoute, GET as getCategoryRoute, PATCH as patchCategoryRoute } from "@/app/api/v1/upstream/categories/[id]/route";
import { POST as checkCategoryRoute } from "@/app/api/v1/upstream/categories/[id]/check/route";
import { GET as listChecksRoute } from "@/app/api/v1/upstream/checks/route";
import { POST as runChecksRoute } from "@/app/api/v1/upstream/checks/run/route";
import { DELETE as clearHouseholdResolver, GET as getHouseholdResolver, PUT as setHouseholdResolver } from "@/app/api/v1/upstream/resolver/route";
import { GET as getCheckupRoute } from "@/app/api/v1/checkup/route";
import { POST as removeLeftoversRoute } from "@/app/api/v1/checkup/leftover-policies/remove/route";
import { GET as listEndpointsRoute, POST as createEndpointRoute } from "@/app/api/v1/connection/endpoints/route";
import { DELETE as deleteEndpointRoute, PUT as updateEndpointRoute } from "@/app/api/v1/connection/endpoints/[id]/route";
import { POST as checkEndpointRoute } from "@/app/api/v1/connection/endpoints/[id]/check/route";
import { PATCH as patchFindingRoute } from "@/app/api/v1/checkup/findings/[id]/route";
import { POST as runCheckupRoute } from "@/app/api/v1/checkup/run/route";
import { GET as tunnelStateRoute, PUT as setTunnelRoute } from "@/app/api/v1/connection/tunnel/route";
import { GET as getSyncRoute } from "@/app/api/v1/sync/route";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { createFixtureUnifiClient } from "@/server/unifi/dev-mock";
import { GET as getHouseholdRoute, PUT as putHouseholdRoute } from "@/app/api/v1/settings/household/route";
import { GET as getUpdateRoute } from "@/app/api/v1/settings/update/route";
import { PUT as putScheduleRoute } from "@/app/api/v1/settings/update/schedule/route";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { prisma } from "@/server/db";
import { createRule, RuleCreateBody } from "@/server/rules";
import { configureConnectedHousehold, createFamilyGroup, resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const json = { "content-type": "application/json" };

describe("route responses match the contract", () => {
  let auth: SessionAuth;

  const send = (path: string, method = "GET", body?: unknown) =>
    request(path, { method, auth, headers: json, body: body === undefined ? undefined : JSON.stringify(body) });
  const id = (value: string) => ({ params: Promise.resolve({ id: value }) });

  beforeEach(async () => {
    await resetDatabase();
    const response = await login(
      request("/api/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) }),
    );
    auth = authFromLogin(response);
  });

  it("groups", async () => {
    const group = await createFamilyGroup("Betsy");
    const path = `/api/v1/groups/${group.id}`;
    expect((await listGroups(send("/api/v1/groups"))).status).toBe(200);
    expect((await createGroup(send("/api/v1/groups", "POST", { kind: "things", name: "TV" }))).status).toBe(201);
    expect((await getGroup(send(path), id(group.id))).status).toBe(200);
    expect((await updateGroup(send(path, "PUT", { name: "Elizabeth" }), id(group.id))).status).toBe(200);
    // With its Block button default set, the group carries the optional `blockButtonRuleId`.
    const video = await createRule(RuleCreateBody.parse({ name: "Video", kind: "category", groupIds: [group.id], targetIds: [4], mode: "always" }));
    expect((await updateGroup(send(path, "PUT", { blockButtonRuleId: video.rule.id }), id(group.id))).status).toBe(200);
    expect((await getGroup(send(path), id(group.id))).status).toBe(200);
    expect((await listGroups(send("/api/v1/groups"))).status).toBe(200);
    expect((await deleteGroup(send(path, "DELETE"), id(group.id))).status).toBe(200);
  });

  it("a group's resolver, on the household's and on its own", async () => {
    const group = await createFamilyGroup("Betsy");
    const path = `/api/v1/groups/${group.id}/resolver`;
    expect((await getResolver(send(path), id(group.id))).status).toBe(200);
    expect((await setResolver(send(path, "PUT", { url: "https://dns.example.com/dns-query" }), id(group.id))).status).toBe(200);
    expect((await getResolver(send(path), id(group.id))).status).toBe(200);
    expect((await clearResolver(send(path, "DELETE"), id(group.id))).status).toBe(200);
  });

  it("rules, their switch and their verbs, for everyone and for one group", async () => {
    const group = await createFamilyGroup("Betsy");
    const soon = () => new Date(Date.now() + 60 * 60_000).toISOString();
    const created = await createRuleRoute(send("/api/v1/rules", "POST", { name: "Downtime", kind: "internet", groupIds: [group.id], mode: "always" }));
    expect(created.status).toBe(201);
    const ruleId = ((await created.json()) as { rule: { id: string } }).rule.id;
    const path = `/api/v1/rules/${ruleId}`;
    const rule = id(ruleId);
    expect((await listRulesRoute(send("/api/v1/rules"))).status).toBe(200);
    expect((await listRulesRoute(send(`/api/v1/rules?groupId=${group.id}`))).status).toBe(200);
    expect((await getRuleRoute(send(path), rule)).status).toBe(200);
    expect((await patchRuleRoute(send(path, "PATCH", { name: "Quiet time" }), rule)).status).toBe(200);
    expect((await ruleOff(send(`${path}/off`, "POST"), rule)).status).toBe(200);
    expect((await ruleOn(send(`${path}/on`, "POST"), rule)).status).toBe(200);
    // A timed pause, so the rule answers with an expiry and can be extended.
    expect((await rulePause(send(`${path}/pause`, "POST", { until: soon() }), rule)).status).toBe(200);
    expect((await ruleExtend(send(`${path}/extend`, "POST", { minutes: 15 }), rule)).status).toBe(200);
    expect((await ruleResume(send(`${path}/resume`, "POST"), rule)).status).toBe(200);
    expect((await ruleAllow(send(`${path}/allow`, "POST", { until: soon() }), rule)).status).toBe(200);
    expect((await ruleDisallow(send(`${path}/disallow`, "POST"), rule)).status).toBe(200);

    for (const ruleRef of [ruleId, "internet"]) {
      const groupPath = `/api/v1/groups/${group.id}/rules/${ruleRef}`;
      const target = { params: Promise.resolve({ id: group.id, ruleId: ruleRef }) };
      expect((await groupRulePause(send(`${groupPath}/pause`, "POST", { until: soon() }), target)).status).toBe(200);
      expect((await groupRuleExtend(send(`${groupPath}/extend`, "POST", { minutes: 15 }), target)).status).toBe(200);
      expect((await groupRuleResume(send(`${groupPath}/resume`, "POST"), target)).status).toBe(200);
      expect((await groupRuleAllow(send(`${groupPath}/allow`, "POST", { until: soon() }), target)).status).toBe(200);
      expect((await groupRuleDisallow(send(`${groupPath}/disallow`, "POST"), target)).status).toBe(200);
    }

    const unblockPath = `/api/v1/groups/${group.id}/unblock`;
    expect((await unblock(send(unblockPath, "POST", { until: soon() }), id(group.id))).status).toBe(200);
    expect((await unblockExtend(send(`${unblockPath}/extend`, "POST", { minutes: 15 }), id(group.id))).status).toBe(200);
    expect((await unblockEnd(send(`${unblockPath}/end`, "POST"), id(group.id))).status).toBe(200);
    expect((await deleteRuleRoute(send(path, "DELETE"), rule)).status).toBe(200);
  });

  // Scope and networks go through these routes in the network rule cases, which still call them;
  // a built-in rule's own fields are sent in the case after this one.
  it("a rule's create and update carry their fields through to what is stored", async () => {
    const group = await createFamilyGroup("Betsy");
    const created = await createRuleRoute(
      send("/api/v1/rules", "POST", {
        name: "Video evenings",
        kind: "category",
        scope: "group",
        groupIds: [group.id],
        networkIds: [],
        targetIds: [4],
        domains: [],
        enabled: false,
        mode: "scheduled",
        windows: [{ name: "Evenings", days: [1, 2, 3], start: "18:00", end: "20:00" }],
        useGeneratedName: false,
      }),
    );
    expect(created.status).toBe(201);
    const ruleId = ((await created.json()) as { rule: { id: string } }).rule.id;
    const stored = () => prisma().rule.findUniqueOrThrow({ where: { id: ruleId }, include: { windows: true, groups: true } });
    expect(await stored()).toMatchObject({
      name: "Video evenings",
      kind: "category",
      scope: "group",
      targetIds: [4],
      enabled: false,
      mode: "scheduled",
      useGeneratedName: false,
      groups: [{ groupId: group.id }],
      windows: [{ name: "Evenings", days: [1, 2, 3], start: "18:00", end: "20:00" }],
    });

    const other = await createFamilyGroup("Abby");
    const window = (await stored()).windows[0];
    const patched = await patchRuleRoute(
      send(`/api/v1/rules/${ruleId}`, "PATCH", {
        name: "Video nights",
        groupIds: [group.id, other.id],
        targetIds: [4, 24],
        enabled: true,
        mode: "scheduled",
        windows: [{ id: window.id, name: "Nights", days: [0, 6], start: "21:00", end: "23:00" }],
        useGeneratedName: false,
      }),
      id(ruleId),
    );
    expect(patched.status).toBe(200);
    const after = await stored();
    expect(after).toMatchObject({
      name: "Video nights",
      targetIds: [4, 24],
      enabled: true,
      windows: [{ id: window.id, name: "Nights", days: [0, 6], start: "21:00", end: "23:00" }],
    });
    expect(after.groups.map((link) => link.groupId).sort()).toEqual([group.id, other.id].sort());
  });

  it("a built-in rule's update carries its own fields through to what is stored", async () => {
    const group = await createFamilyGroup("Betsy");
    const countries = await patchRuleRoute(send("/api/v1/rules/countries", "PATCH", { enabled: true, groupIds: [group.id], countries: ["KP", "RU"] }), id("countries"));
    expect(countries.status).toBe(200);
    expect(((await countries.json()) as { rule: { countries: string[]; groupIds: string[] } }).rule).toMatchObject({ countries: ["KP", "RU"], groupIds: [group.id] });
    const dns = await patchRuleRoute(send("/api/v1/rules/dns", "PATCH", { enabled: true, groupIds: [group.id], blockPrivateRelay: true }), id("dns"));
    expect(dns.status).toBe(200);
    expect(((await dns.json()) as { rule: { blockPrivateRelay: boolean } }).rule.blockPrivateRelay).toBe(true);
    expect((await getRuleRoute(send("/api/v1/rules/dns"), id("dns"))).status).toBe(200);
  });

  it("DNS categories, their checks and the household resolver", async () => {
    // A run on record a day ahead, so saving the resolver starts no sweep of its own.
    await prisma().household.update({ where: { id: "default" }, data: { dohProbeLastRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
    const created = await createCategoryRoute(
      send("/api/v1/upstream/categories", "POST", { label: "Homework", monogram: "HW", domains: ["chegg.com"], enabled: false }),
    );
    expect(created.status).toBe(201);
    const categoryId = ((await created.json()) as { category: { id: string } }).category.id;
    // Checking off is not the default, so a create that dropped `enabled` would show here.
    expect(await prisma().upstreamCategory.findUniqueOrThrow({ where: { id: categoryId }, include: { domains: true } })).toMatchObject({
      label: "Homework",
      monogram: "HW",
      enabled: false,
      domains: [{ domain: "chegg.com" }],
    });
    const path = `/api/v1/upstream/categories/${categoryId}`;
    expect((await listCategoriesRoute(send("/api/v1/upstream/categories"))).status).toBe(200);
    expect((await getCategoryRoute(send(path), id(categoryId))).status).toBe(200);
    const patched = await patchCategoryRoute(send(path, "PATCH", { label: "Study", monogram: "ST", enabled: true, domains: ["quizlet.com"] }), id(categoryId));
    expect(patched.status).toBe(200);
    expect(await prisma().upstreamCategory.findUniqueOrThrow({ where: { id: categoryId }, include: { domains: true } })).toMatchObject({
      label: "Study",
      monogram: "ST",
      enabled: true,
      domains: [{ domain: "quizlet.com" }],
    });
    // With no resolver set the check answers unknown: a result to show, never an error.
    expect((await checkCategoryRoute(send(`${path}/check`, "POST"), id(categoryId))).status).toBe(200);
    expect((await runChecksRoute(send("/api/v1/upstream/checks/run", "POST"))).status).toBe(200);
    expect((await listChecksRoute(send("/api/v1/upstream/checks"))).status).toBe(200);
    expect((await deleteCategoryRoute(send(path, "DELETE"), id(categoryId))).status).toBe(200);

    const resolver = "/api/v1/upstream/resolver";
    expect((await getHouseholdResolver(send(resolver))).status).toBe(200);
    const saved = await setHouseholdResolver(
      send(resolver, "PUT", { url: "https://dns.example.com/dns-query", probeEnabled: false, probeTime: "09:30", probeDays: [1, 3], timeoutMs: 2000 }),
    );
    expect(saved.status).toBe(200);
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({
      dohUrl: "https://dns.example.com/dns-query",
      dohProbeEnabled: false,
      dohProbeTime: "09:30",
      dohProbeDays: [1, 3],
      dohProbeTimeoutMs: 2000,
    });
    expect((await getHouseholdResolver(send(resolver))).status).toBe(200);
    expect((await clearHouseholdResolver(send(resolver, "DELETE"))).status).toBe(200);
  });

  it("the checkup, a finding dismissed and shown again, and the sync summary", async () => {
    await configureConnectedHousehold();
    setReconcileClientForTests(createFixtureUnifiClient({ friendlyNames: true }));
    try {
      expect((await getCheckupRoute(send("/api/v1/checkup"))).status).toBe(200);
      // After a sync against the fixture gateway, the checkup has findings to dismiss.
      await runReconcileOnce();
      expect((await runCheckupRoute(send("/api/v1/checkup/run", "POST", {}))).status).toBe(200);
      const finding = { params: Promise.resolve({ id: "private_addresses" }) };
      for (const dismissed of [true, false]) {
        expect((await patchFindingRoute(send("/api/v1/checkup/findings/private_addresses", "PATCH", { dismissed }), finding)).status).toBe(200);
        expect((await prisma().checkupFinding.findFirstOrThrow({ where: { key: "private_addresses" } })).dismissedAt === null).toBe(!dismissed);
      }
      expect((await getCheckupRoute(send("/api/v1/checkup"))).status).toBe(200);
      expect((await getSyncRoute(send("/api/v1/sync"))).status).toBe(200);
      // A policy that is not on the gateway is skipped, never an error.
      const removal = await removeLeftoversRoute(send("/api/v1/checkup/leftover-policies/remove", "POST", { policyIds: ["no-such-policy"] }));
      expect(removal.status).toBe(200);
      expect(JSON.stringify(await removal.json())).toContain("no-such-policy");
    } finally {
      setReconcileClientForTests(undefined);
    }
  });

  it("remote access, read and switched off", async () => {
    expect((await tunnelStateRoute(send("/api/v1/connection/tunnel"))).status).toBe(200);
    expect((await setTunnelRoute(send("/api/v1/connection/tunnel", "PUT", { mode: "off", forget: true }))).status).toBe(200);
  });

  it("the household's own routes: listed, created, changed, checked and deleted", async () => {
    const created = await createEndpointRoute(
      send("/api/v1/connection/endpoints", "POST", { url: "https://127.0.0.1:9", transport: "lan", trustMode: "system", priority: 5, enabled: false }),
    );
    expect(created.status).toBe(201);
    const endpointId = ((await created.json()) as { endpoint: { id: string } }).endpoint.id;
    const path = `/api/v1/connection/endpoints/${endpointId}`;
    expect(await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).toMatchObject({
      url: "https://127.0.0.1:9",
      transport: "lan",
      trustMode: "system",
      priority: 5,
      enabled: false,
    });
    expect((await listEndpointsRoute(send("/api/v1/connection/endpoints"))).status).toBe(200);
    expect((await updateEndpointRoute(send(path, "PUT", { url: "https://127.0.0.1:10", transport: "tailscale", trustMode: "system", priority: 7, enabled: true }), id(endpointId))).status).toBe(200);
    expect(await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).toMatchObject({
      url: "https://127.0.0.1:10",
      transport: "tailscale",
      priority: 7,
      enabled: true,
    });
    // A LAN route pinned to a certificate, then back to the system's trust with the pin cleared.
    const pin = "A".repeat(43);
    expect((await updateEndpointRoute(send(path, "PUT", { transport: "lan", trustMode: "pinned", spkiSha256: pin }), id(endpointId))).status).toBe(200);
    expect(await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).toMatchObject({ transport: "lan", trustMode: "pinned", spkiSha256: pin });
    expect((await updateEndpointRoute(send(path, "PUT", { trustMode: "system", spkiSha256: null }), id(endpointId))).status).toBe(200);
    expect(await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: endpointId } })).toMatchObject({ trustMode: "system", spkiSha256: null });
    // Nothing listens there: the check answers with what it found, a failure to show.
    expect((await checkEndpointRoute(send(`${path}/check`, "POST"), id(endpointId))).status).toBe(200);
    expect((await deleteEndpointRoute(send(path, "DELETE"), id(endpointId))).status).toBe(200);
  });

  it("household settings and the update schedule", async () => {
    expect((await getHouseholdRoute(send("/api/v1/settings/household"))).status).toBe(200);
    const saved = await putHouseholdRoute(send("/api/v1/settings/household", "PUT", { timezone: "Europe/London", displayName: "The Testers", quarantineEnforced: true, alertsRelay: true }));
    expect(saved.status).toBe(200);
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({
      timezone: "Europe/London",
      displayName: "The Testers",
      quarantineEnforced: true,
      alertsRelayEnabled: true,
    });

    expect((await getUpdateRoute(send("/api/v1/settings/update"))).status).toBe(200);
    expect((await putScheduleRoute(send("/api/v1/settings/update/schedule", "PUT", { enabled: true, days: [1, 3], time: "02:30" }))).status).toBe(200);
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({ updateScheduleEnabled: true, updateSchedule: "30 2 * * 1,3" });
  });
});
