import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { enqueueChange } from "@/server/changes";
import { prisma } from "@/server/db";
import { readBody, withAdmin, withMutation, withSession } from "@/server/guard";
import { loadHousehold } from "@/server/household";
import { request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";
import { bearer, issuedInvite, claimInvite, pairingAdmin, pairingAdminAuth, type Claim } from "../helpers/pairing";
import { POST as invite } from "@/app/api/v1/paired/invites/route";
import { TEST_ORIGIN } from "../helpers/test-env";

const GUARDS = { withSession, withMutation, withAdmin };
const PATH = "/api/v1/groups";

/** A browser's request that carries its session cookie and no CSRF header. */
function withoutCsrf(auth: SessionAuth, method: string, origin = TEST_ORIGIN): Request {
  return new Request(`${TEST_ORIGIN}${PATH}`, { method, headers: { origin, host: "familyfi.test", cookie: auth.cookie } });
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

/** Runs a guard and says whether it let the handler run. */
async function guarded(guard: keyof typeof GUARDS, incoming: Request) {
  let ran = false;
  const response = await GUARDS[guard](incoming, async () => {
    ran = true;
    return Response.json({ ok: true });
  });
  return { response, ran };
}

async function agent(): Promise<SessionAuth> {
  const created = await invite(
    request("/api/v1/paired/invites", { method: "POST", auth: await pairingAdminAuth(), headers: { "content-type": "application/json" }, body: JSON.stringify({ client: "agent", displayName: "Claude Code", scope: "full" }) }),
  );
  expect(created.status).toBe(201);
  const claimed = await claimInvite(await issuedInvite(created), "Claude Code on a MacBook");
  expect(claimed.status).toBe(200);
  return bearer(((await claimed.json()) as Claim).token);
}

describe("route guards", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.keys(GUARDS) as (keyof typeof GUARDS)[])("%s answers 401 without a session and never runs the handler", async (guard) => {
    const { response, ran } = await guarded(guard, request(PATH, { method: "POST" }));
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthenticated");
    expect(ran).toBe(false);
  });

  it("withSession asks for no CSRF token, even on a write", async () => {
    const { response, ran } = await guarded("withSession", withoutCsrf(await pairingAdminAuth(), "POST"));
    expect(response.status).toBe(200);
    expect(ran).toBe(true);
  });

  it("withMutation asks for the CSRF token on every method", async () => {
    const auth = await pairingAdminAuth();
    for (const method of ["GET", "POST"]) {
      const { response, ran } = await guarded("withMutation", withoutCsrf(auth, method));
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("csrf");
      expect(ran).toBe(false);
    }
    expect((await guarded("withMutation", request(PATH, { method: "POST", auth }))).ran).toBe(true);
  });

  it("withAdmin asks for the CSRF token on writes only", async () => {
    const auth = await pairingAdminAuth();
    for (const method of ["GET", "HEAD"]) {
      expect((await guarded("withAdmin", withoutCsrf(auth, method))).ran).toBe(true);
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const { response, ran } = await guarded("withAdmin", withoutCsrf(auth, method));
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("csrf");
      expect(ran).toBe(false);
    }
    expect((await guarded("withAdmin", request(PATH, { method: "POST", auth }))).ran).toBe(true);
  });

  it("only withAdmin refuses a device that is no administrator, and checks the origin first", async () => {
    const auth = await agent();
    expect((await guarded("withSession", request(PATH, { auth }))).ran).toBe(true);
    expect((await guarded("withMutation", request(PATH, { method: "POST", auth }))).ran).toBe(true);

    const refused = await guarded("withAdmin", request(PATH, { method: "POST", auth }));
    expect(refused.response.status).toBe(403);
    expect(await errorCode(refused.response)).toBe("administrator_required");
    expect(refused.ran).toBe(false);

    const elsewhere = new Request(`${TEST_ORIGIN}${PATH}`, { method: "POST", headers: { origin: "http://elsewhere.test", host: "familyfi.test", authorization: `Bearer ${auth.token}` } });
    expect(await errorCode((await guarded("withAdmin", elsewhere)).response)).toBe("forbidden_origin");
  });

  it.each(Object.keys(GUARDS) as (keyof typeof GUARDS)[])("%s hands the handler its session and records changes against its account", async (guard) => {
    const account = await pairingAdmin();
    const response = await GUARDS[guard](request(PATH, { method: "POST", auth: await pairingAdminAuth() }), async (session) => {
      await enqueueChange("guard-test");
      return Response.json({ username: session.username, accountId: session.accountId });
    });
    expect(await response.json()).toEqual({ username: account.username, accountId: account.id });
    expect((await prisma().changeResult.findFirstOrThrow({ where: { scope: "guard-test" } })).actorAccountId).toBe(account.id);
  });

  it.each(Object.keys(GUARDS) as (keyof typeof GUARDS)[])("%s answers 500 when the handler throws", async (guard) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GUARDS[guard](request(PATH, { method: "POST", auth: await pairingAdminAuth() }), async () => {
      throw new Error("boom");
    });
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("internal");
    expect(logged).toHaveBeenCalled();
  });
});

describe("the demoLock option", () => {
  const mode = process.env.FAMILYFI_MODE;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    if (mode === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = mode;
  });

  it.each(Object.keys(GUARDS) as (keyof typeof GUARDS)[])("%s refuses a locked request in the demo only, and only once the caller is let in", async (guard) => {
    const auth = await pairingAdminAuth();
    const run = async (incoming: Request, options?: { demoLock: boolean }) => {
      let ran = false;
      const response = await GUARDS[guard](incoming, async () => {
        ran = true;
        return Response.json({ ok: true });
      }, options);
      return { response, ran };
    };
    expect((await run(request(PATH, { method: "POST", auth }), { demoLock: true })).ran).toBe(true);

    process.env.FAMILYFI_MODE = "demo";
    const locked = await run(request(PATH, { method: "POST", auth }), { demoLock: true });
    expect(locked.response.status).toBe(403);
    expect(await errorCode(locked.response)).toBe("demo_locked");
    expect(locked.ran).toBe(false);
    expect((await run(request(PATH, { method: "POST", auth }))).ran).toBe(true);
    expect((await run(request(PATH, { method: "POST" }), { demoLock: true })).response.status).toBe(401);
  });
});

describe("readBody", () => {
  const Body = z.object({ name: z.string().min(1) });
  const post = (body: string) => request(PATH, { method: "POST", headers: { "content-type": "application/json" }, body });

  it("answers 400 invalid_json when the body is not JSON", async () => {
    const read = await readBody(post("{"), Body, "A name is required.");
    if (read.ok) throw new Error("expected a refusal");
    expect(read.response.status).toBe(400);
    expect(await read.response.json()).toEqual({ error: { code: "invalid_json", message: "Request body must be JSON." } });
  });

  it("answers 400 invalid_request with the caller's message when the body does not fit", async () => {
    const read = await readBody(post(JSON.stringify({ name: "" })), Body, "A name is required.");
    if (read.ok) throw new Error("expected a refusal");
    expect(read.response.status).toBe(400);
    expect(await read.response.json()).toEqual({ error: { code: "invalid_request", message: "A name is required." } });
  });

  it("returns the parsed body, without fields the schema does not name", async () => {
    expect(await readBody(post(JSON.stringify({ name: "Kids", extra: true })), Body, "A name is required.")).toEqual({ ok: true, data: { name: "Kids" } });
  });
});

describe("loadHousehold", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // The last case removes the household; put it back for whichever file runs next.
  afterAll(async () => {
    await resetDatabase();
  });

  it("returns the deployment's one household", async () => {
    const household = await loadHousehold();
    expect(household.id).toBe("default");
    expect(household.timezone).toBe((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).timezone);
  });

  it("rejects when there is no household", async () => {
    await prisma().rule.deleteMany();
    await prisma().household.delete({ where: { id: "default" } });
    await expect(loadHousehold()).rejects.toThrow();
  });
});
