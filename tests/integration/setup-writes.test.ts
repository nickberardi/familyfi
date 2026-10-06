import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as createGroup } from "@/app/api/v1/groups/route";
import { PUT as updateGroup } from "@/app/api/v1/groups/[id]/route";
import { POST as createRule } from "@/app/api/v1/rules/route";
import { PATCH as patchRule } from "@/app/api/v1/rules/[id]/route";
import type { ApiRequest } from "@/lib/api-client";
import { SCHEDULE_SUGGESTIONS, saveMembers, saveSchedules, type SetupMember } from "@/lib/setup";
import { prisma } from "@/server/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

/**
 * First-time setup's writes, sent through the real group and rule routes: the methods and bodies
 * setup sends are the ones those routes take, and a retry after someone joins updates the rule.
 */
const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const ROUTES: { pattern: RegExp; method: string; handler: Handler }[] = [
  { pattern: /^\/api\/v1\/groups$/, method: "POST", handler: createGroup as Handler },
  { pattern: /^\/api\/v1\/groups\/([^/]+)$/, method: "PUT", handler: updateGroup },
  { pattern: /^\/api\/v1\/rules$/, method: "POST", handler: createRule as Handler },
  { pattern: /^\/api\/v1\/rules\/([^/]+)$/, method: "PATCH", handler: patchRule },
];

/** `ApiRequest` over the route handlers, as the browser's `request` sends it. */
function routeRequest(auth: SessionAuth): ApiRequest {
  return (async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const method = init.method ?? "GET";
    const route = ROUTES.find((entry) => entry.method === method && entry.pattern.test(path));
    if (!route) throw new Error(`No ${method} route for ${path}.`);
    const id = route.pattern.exec(path)?.[1] ?? "";
    const response = await route.handler(
      request(path, { method, auth, headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
      { params: Promise.resolve({ id }) },
    );
    const json = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) throw new Error(json.error?.message ?? `${method} ${path} answered ${response.status}.`);
    return json;
  }) as ApiRequest;
}

const bedtime = SCHEDULE_SUGGESTIONS.find((item) => item.id === "bedtime")!;
const homework = SCHEDULE_SUGGESTIONS.find((item) => item.id === "homework")!;

describe("setup writes", () => {
  let api: ApiRequest;

  beforeEach(async () => {
    await resetDatabase();
    const response = await login(
      request("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
      }),
    );
    api = routeRequest(authFromLogin(response));
  });

  it("adds the household and its suggested schedules", async () => {
    const saved = await saveMembers(api, [
      { name: "Sam", role: "adult" },
      { name: "Ava", role: "teen" },
      { name: "Leo", role: "child" },
    ]);
    expect(saved.error).toBeNull();
    const groups = await prisma().group.findMany({ orderBy: { createdAt: "asc" } });
    expect(groups.map((group) => [group.name, group.kind, group.familyRole])).toEqual([
      ["Sam", "family", "adult"],
      ["Ava", "family", "teen"],
      ["Leo", "family", "child"],
    ]);

    const result = await saveSchedules(api, [bedtime, homework], saved.members, {});
    expect(result.error).toBeNull();
    const rules = await prisma().rule.findMany({ where: { id: { not: "quarantine" } }, include: { groups: true, windows: true }, orderBy: { name: "asc" } });
    const byId = new Map(groups.map((group) => [group.id, group.name]));
    expect(
      rules.map((rule) => ({
        name: rule.name,
        kind: rule.kind,
        mode: rule.mode,
        targetIds: [...rule.targetIds].sort((a, b) => a - b),
        groups: rule.groups.map((link) => byId.get(link.groupId)).sort(),
        windows: rule.windows.map(({ days, start, end }) => ({ days, start, end })),
      })),
    ).toEqual([
      { name: "Children’s bedtime", kind: "internet", mode: "scheduled", targetIds: [], groups: ["Leo"], windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "20:30", end: "07:00" }] },
      { name: "Homework", kind: "category", mode: "scheduled", targetIds: [4, 8, 24], groups: ["Ava", "Leo"], windows: [{ days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00" }] },
      { name: "Teens’ bedtime", kind: "internet", mode: "scheduled", targetIds: [], groups: ["Ava"], windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:30" }] },
    ]);
  });

  it("changes a saved role, and adds someone who joins before a retry to the rule already made", async () => {
    const first = await saveMembers(api, [{ name: "Leo", role: "child" }]);
    const made = await saveSchedules(api, [bedtime], first.members, {});
    expect(Object.keys(made.created)).toEqual(["Children’s bedtime"]);

    const joined: SetupMember[] = [...first.members, { name: "Mia", role: "teen" }];
    const second = await saveMembers(api, joined.map((member) => (member.name === "Mia" ? { ...member, role: "child" } : member)));
    expect(second.error).toBeNull();
    const retried = await saveSchedules(api, [bedtime], second.members, made.created);
    expect(retried.error).toBeNull();

    const rules = await prisma().rule.findMany({ where: { id: { not: "quarantine" } }, include: { groups: { include: { group: true } } } });
    expect(rules.map((rule) => [rule.name, rule.groups.map((link) => link.group.name).sort()])).toEqual([["Children’s bedtime", ["Leo", "Mia"]]]);

    const leo = second.members.find((member) => member.name === "Leo")!;
    const roleChange = await saveMembers(api, [{ ...leo, role: "teen" }]);
    expect(roleChange.error).toBeNull();
    expect((await prisma().group.findUniqueOrThrow({ where: { id: leo.id } })).familyRole).toBe("teen");
  });
});
