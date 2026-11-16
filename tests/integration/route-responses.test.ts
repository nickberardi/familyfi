/**
 * One call per route and method whose logic is tested on its `src/server` function instead of
 * through the handler. Every response an integration test gets from a handler is checked against
 * `openapi/familyfi.v1.yaml` (tests/openapi-responses-plugin.ts), so these calls are what keeps
 * each route's success response matched to the contract. They assert the status and nothing else:
 * what the route does is asserted where its function is tested.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listGroups, POST as createGroup } from "@/app/api/v1/groups/route";
import { DELETE as deleteGroup, GET as getGroup, PUT as updateGroup } from "@/app/api/v1/groups/[id]/route";
import { DELETE as clearResolver, GET as getResolver, PUT as setResolver } from "@/app/api/v1/groups/[id]/resolver/route";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
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
    expect((await getResolver(send(`${path}/resolver`), id(group.id))).status).toBe(200);
    expect((await setResolver(send(`${path}/resolver`, "PUT", { url: "https://dns.example.com/dns-query" }), id(group.id))).status).toBe(200);
    expect((await clearResolver(send(`${path}/resolver`, "DELETE"), id(group.id))).status).toBe(200);
    expect((await deleteGroup(send(path, "DELETE"), id(group.id))).status).toBe(200);
  });
});
