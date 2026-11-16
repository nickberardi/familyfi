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
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { createRule, RuleCreateBody } from "@/server/rules";
import { createFamilyGroup, resetDatabase } from "../helpers/db";

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
});
