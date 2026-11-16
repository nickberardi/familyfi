import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getGroupRoute, PUT as putGroup } from "@/app/api/v1/groups/[id]/route";
import { prisma } from "@/server/db";
import { getGroup, updateGroup } from "@/server/groups";
import { createRule, RuleCreateBody } from "@/server/rules";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { createFamilyGroup, resetDatabase, seedDevice } from "../helpers/db";
import { refusal } from "../helpers/refusal";

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

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (auth: SessionAuth | undefined, id: string, body: unknown) =>
  putGroup(
    request(`/api/v1/groups/${id}`, {
      method: "PUT",
      auth,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

describe("reading and updating a group", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reads one group with its device count, and refuses an unknown one", async () => {
    const group = await createFamilyGroup("Betsy");
    await seedDevice({ mac: "02:00:00:00:00:01", groupId: group.id });
    expect(await getGroup(group.id)).toMatchObject({ id: group.id, name: "Betsy", deviceCount: 1 });
    expect(await refusal(getGroup("missing"))).toEqual([404, "not_found"]);
  });

  it("renames a group, and queues the change for reconciliation", async () => {
    const group = await createFamilyGroup("Betsy");
    const updated = await updateGroup(group.id, { name: "Elizabeth", monogram: "EL", familyRole: "teen" });
    expect(updated.group).toMatchObject({ name: "Elizabeth" });
    expect(updated.change.changeId).toBeTruthy();

    const stored = await prisma().group.findUniqueOrThrow({ where: { id: group.id } });
    expect(stored).toMatchObject({ name: "Elizabeth", monogram: "EL", familyRole: "teen" });
    expect(await prisma().changeResult.findUnique({ where: { id: updated.change.changeId } })).toMatchObject({ scope: "group", status: "pending" });
  });

  it("leaves fields it was not sent alone, and can clear the monogram", async () => {
    const group = await createFamilyGroup("Betsy");
    await updateGroup(group.id, { monogram: "BB" });
    await updateGroup(group.id, { monogram: null });
    const stored = await prisma().group.findUniqueOrThrow({ where: { id: group.id } });
    expect(stored).toMatchObject({ name: "Betsy", monogram: null, familyRole: "child" });
  });

  it("refuses an unknown group", async () => {
    expect(await refusal(updateGroup("missing", { name: "Nobody" }))).toEqual([404, "not_found"]);
  });
});

/** What only the route decides: who may call it, and what a request may carry. */
describe("GET and PUT /api/v1/groups/{id}", () => {
  let auth: SessionAuth;

  beforeEach(async () => {
    await resetDatabase();
    auth = await signedIn();
  });

  it("needs a session to read, and answers 404 for an unknown group", async () => {
    const group = await createFamilyGroup("Betsy");
    expect((await getGroupRoute(request(`/api/v1/groups/${group.id}`), ctx(group.id))).status).toBe(401);
    const response = await getGroupRoute(request(`/api/v1/groups/${group.id}`, { auth }), ctx(group.id));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { group: { id: string } }).group.id).toBe(group.id);
    expect((await getGroupRoute(request("/api/v1/groups/missing", { auth }), ctx("missing"))).status).toBe(404);
  });

  it("ignores a field it no longer knows, and answers with the group and its change", async () => {
    const group = await createFamilyGroup("Betsy");
    // An older client may still send `protected`; groups are no longer protected, so it is ignored.
    const response = await put(auth, group.id, { name: "Elizabeth", protected: true });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { group: Record<string, unknown>; change: { changeId: string } };
    expect(body.group).toMatchObject({ name: "Elizabeth" });
    expect(body.group).not.toHaveProperty("protected");
    expect(body.change.changeId).toBeTruthy();
  });

  it("accepts every field a group update may carry, and both of the ones that can be cleared", async () => {
    const group = await createFamilyGroup("Betsy");
    const video = await createRule(RuleCreateBody.parse({ name: "Video", kind: "category", groupIds: [group.id], targetIds: [4], mode: "always" }));
    const set = await put(auth, group.id, { name: "Elizabeth", monogram: "EL", familyRole: "teen", blockButtonRuleId: video.rule.id });
    expect(set.status).toBe(200);
    expect(((await set.json()) as { group: { blockButtonRuleId?: string } }).group.blockButtonRuleId).toBe(video.rule.id);
    expect(await prisma().group.findUniqueOrThrow({ where: { id: group.id } })).toMatchObject({
      name: "Elizabeth",
      monogram: "EL",
      familyRole: "teen",
      blockButtonRuleId: video.rule.id,
    });

    expect((await put(auth, group.id, { monogram: null, blockButtonRuleId: null })).status).toBe(200);
    expect(await prisma().group.findUniqueOrThrow({ where: { id: group.id } })).toMatchObject({
      name: "Elizabeth",
      monogram: null,
      familyRole: "teen",
      blockButtonRuleId: null,
    });
  });

  it("refuses an invalid update, an unknown group, and a write without CSRF", async () => {
    const group = await createFamilyGroup("Betsy");
    expect((await put(auth, group.id, { name: "" })).status).toBe(400);
    expect((await put(auth, group.id, { familyRole: "grandparent" })).status).toBe(400);
    expect((await put(auth, "missing", { name: "Nobody" })).status).toBe(404);
    const withoutCsrf = await putGroup(
      request(`/api/v1/groups/${group.id}`, {
        method: "PUT",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Sneaky" }),
      }),
      ctx(group.id),
    );
    expect(withoutCsrf.status).toBe(403);
    expect((await prisma().group.findUniqueOrThrow({ where: { id: group.id } })).name).toBe("Betsy");
  });
});
