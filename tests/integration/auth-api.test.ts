import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FamilyRole, GroupKind } from "@prisma/client";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as session } from "@/app/api/v1/auth/session/route";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/accounts/route";
import { DELETE as deleteAccount, PUT as updateAccount } from "@/app/api/v1/accounts/[id]/route";
import { PUT as setPassword } from "@/app/api/v1/accounts/[id]/password/route";
import { GET as getHealth } from "@/app/api/v1/health/route";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { publicAccount } from "@/server/accounts";
import { CSRF_HEADER } from "@/lib/constants";
import { authFromLogin, request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.DEFAULT_PASSWORD ?? "ci-recovery-password";

async function browserLogin(username = "admin", password = PASSWORD) {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, client: "browser" }),
    }),
  );
  return { response, auth: response.ok ? authFromLogin(response) : null };
}

async function nativeLogin(username = "admin", password = PASSWORD) {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, client: "native" }),
    }),
  );
  const body = (await response.clone().json()) as { token?: string };
  return { response, auth: response.ok && body.token ? authFromLogin(response, body.token) : null, token: body.token };
}

describe("auth and accounts API", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await prisma().loginAttempt.deleteMany();
  });

  it("serves non-secret health", async () => {
    const response = await getHealth();
    const body = (await response.json()) as { status: string; db: string };
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(JSON.stringify(body)).not.toMatch(/password|ciphertext|DEFAULT_PASSWORD/i);
  });

  it("signs in recovery admin with cookies and CSRF", async () => {
    const { response, auth } = await browserLogin();
    expect(response.status).toBe(200);
    const me = await session(request("/api/v1/auth/session", { auth: auth! }));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ session: { username: "admin", kind: "recovery" } });
  });

  it("rejects cookie mutations without CSRF and accepts bearer without it", async () => {
    const { auth } = await browserLogin();
    const noCsrf = await logout(
      request("/api/v1/auth/logout", {
        method: "POST",
        headers: { cookie: auth!.cookie, origin: "http://familyfi.test", host: "familyfi.test" },
      }),
    );
    expect(noCsrf.status).toBe(403);

    const { auth: native } = await nativeLogin();
    const listed = await listAccounts(request("/api/v1/accounts", { auth: native! }));
    expect(listed.status).toBe(200);
    const accounts = (await listed.json()) as { accounts: ReturnType<typeof publicAccount>[] };
    expect(accounts.accounts.some((row) => row.username === "admin" && row.recovery)).toBe(true);
    expect(JSON.stringify(accounts)).not.toContain("passwordHash");
  });

  it("issues a native bearer token and revokes it on logout", async () => {
    const { auth } = await nativeLogin();
    const out = await logout(request("/api/v1/auth/logout", { method: "POST", auth: auth! }));
    expect(out.status).toBe(200);
    const me = await session(request("/api/v1/auth/session", { auth: auth! }));
    expect(me.status).toBe(401);
  });

  it("refuses to create, edit, or delete the recovery admin", async () => {
    const { auth } = await browserLogin();
    const adult = await prisma().group.create({
      data: { kind: GroupKind.family, name: "Nick", familyRole: FamilyRole.adult },
    });
    const taken = await createAccount(
      request("/api/v1/accounts", {
        method: "POST",
        auth: auth!,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "admin",
          displayName: "Nope",
          password: "abcdefgh",
          groupId: adult.id,
        }),
      }),
    );
    expect(taken.status).toBe(400);

    const recovery = await prisma().account.findUniqueOrThrow({ where: { username: "admin" } });
    const edit = await updateAccount(
      request(`/api/v1/accounts/${recovery.id}`, {
        method: "PUT",
        auth: auth!,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Hack" }),
      }),
      { params: Promise.resolve({ id: recovery.id }) },
    );
    expect(edit.status).toBe(409);
    const removed = await deleteAccount(request(`/api/v1/accounts/${recovery.id}`, { method: "DELETE", auth: auth! }), {
      params: Promise.resolve({ id: recovery.id }),
    });
    expect(removed.status).toBe(409);
  });

  it("creates a personal adult, then revokes sessions when the password changes", async () => {
    const { auth: admin } = await browserLogin();
    const adult = await prisma().group.create({
      data: { kind: GroupKind.family, name: "Nick", familyRole: FamilyRole.adult },
    });
    const created = await createAccount(
      request("/api/v1/accounts", {
        method: "POST",
        auth: admin!,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "nick",
          displayName: "Nick",
          password: "personal-pass",
          groupId: adult.id,
        }),
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { account: { id: string }; change: { changeId: string } };
    expect(body.change.changeId).toBeTruthy();

    const { auth: personal } = await browserLogin("nick", "personal-pass");
    expect(personal).toBeTruthy();

    const rotated = await setPassword(
      request(`/api/v1/accounts/${body.account.id}/password`, {
        method: "PUT",
        auth: admin!,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "personal-pass-2" }),
      }),
      { params: Promise.resolve({ id: body.account.id }) },
    );
    expect(rotated.status).toBe(200);
    const stale = await session(request("/api/v1/auth/session", { auth: personal! }));
    expect(stale.status).toBe(401);

    const child = await prisma().group.create({
      data: { kind: GroupKind.family, name: "Betsy", familyRole: FamilyRole.child },
    });
    const childLogin = await createAccount(
      request("/api/v1/accounts", {
        method: "POST",
        auth: admin!,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "betsy",
          displayName: "Betsy",
          password: "abcdefgh",
          groupId: child.id,
        }),
      }),
    );
    expect(childLogin.status).toBe(400);
  });

  it("throttles repeated failed logins", async () => {
    for (let i = 0; i < 5; i += 1) {
      await login(
        request("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ username: "admin", password: "wrong-password-1", client: "browser" }),
        }),
      );
    }
    const blocked = await login(
      request("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
      }),
    );
    expect(blocked.status).toBe(429);
  });

  it("does not return hashes from a direct password update helper", async () => {
    await prisma().account.update({
      where: { username: "admin" },
      data: { passwordHash: await hashPassword("not-used-for-recovery") },
    });
    const listed = await listAccounts(
      request("/api/v1/accounts", { auth: (await browserLogin()).auth! }),
    );
    expect(JSON.stringify(await listed.json())).not.toContain("$argon");
    expect(listed.headers.get(CSRF_HEADER)).toBeNull();
  });
});
