import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getGroup, PUT as putGroup } from "@/app/api/v1/groups/[id]/route";
import { prisma } from "@/server/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { invalidRequest } from "../helpers/openapi-responses";
import { createFamilyGroup, resetDatabase, seedDevice } from "../helpers/db";

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
const putRequest = (auth: SessionAuth | undefined, id: string, body: unknown) =>
  request(`/api/v1/groups/${id}`, {
    method: "PUT",
    auth,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const put = (auth: SessionAuth | undefined, id: string, body: unknown) => putGroup(putRequest(auth, id, body), ctx(id));

describe("GET and PUT /api/v1/groups/{id}", () => {
  let auth: SessionAuth;

  beforeEach(async () => {
    await resetDatabase();
    auth = await signedIn();
  });

  it("reads one group with its device count, and 404s for an unknown one", async () => {
    const group = await createFamilyGroup("Betsy");
    await seedDevice({ mac: "02:00:00:00:00:01", groupId: group.id });
    expect((await getGroup(request(`/api/v1/groups/${group.id}`), ctx(group.id))).status).toBe(401);

    const response = await getGroup(request(`/api/v1/groups/${group.id}`, { auth }), ctx(group.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { group: { id: string; name: string; deviceCount: number } };
    expect(body.group).toMatchObject({ id: group.id, name: "Betsy", deviceCount: 1 });

    expect((await getGroup(request("/api/v1/groups/missing", { auth }), ctx("missing"))).status).toBe(404);
  });

  it("renames and protects a group, and queues the change for reconciliation", async () => {
    const group = await createFamilyGroup("Betsy");
    const response = await put(auth, group.id, { name: "Elizabeth", monogram: "EL", familyRole: "teen", protected: true });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { group: { name: string; protected: boolean }; change: { changeId: string; revision: number } };
    expect(body.group).toMatchObject({ name: "Elizabeth", protected: true });
    expect(body.change.changeId).toBeTruthy();

    const stored = await prisma().group.findUniqueOrThrow({ where: { id: group.id } });
    expect(stored).toMatchObject({ name: "Elizabeth", monogram: "EL", familyRole: "teen", protected: true });
    expect(await prisma().changeResult.findUnique({ where: { id: body.change.changeId } })).toMatchObject({ scope: "group", status: "pending" });
  });

  it("leaves fields it was not sent alone, and can clear the monogram", async () => {
    const group = await createFamilyGroup("Betsy");
    await put(auth, group.id, { monogram: "BB" });
    const response = await put(auth, group.id, { monogram: null });
    expect(response.status).toBe(200);
    const stored = await prisma().group.findUniqueOrThrow({ where: { id: group.id } });
    expect(stored).toMatchObject({ name: "Betsy", monogram: null, protected: false, familyRole: "child" });
  });

  it("refuses an invalid update, an unknown group, and a write without CSRF", async () => {
    const group = await createFamilyGroup("Betsy");
    expect((await put(auth, group.id, { name: "" })).status).toBe(400);
    expect((await putGroup(invalidRequest(putRequest(auth, group.id, { familyRole: "grandparent" })), ctx(group.id))).status).toBe(400);
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
