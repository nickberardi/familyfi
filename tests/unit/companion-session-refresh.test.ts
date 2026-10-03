import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { asTransport, type TransportRequest } from "@/lib/companion-request";
import { createCompanionSession, type SecureStorage } from "@/lib/companion-session";
import type { ConnectionProfile, StoredSession } from "@/lib/companion-pairing";

const ROUTE = {
  id: "r1",
  url: "https://familyfi.home",
  kind: "own",
  transport: "lan",
  trustMode: "system",
  spkiSha256: null,
  priority: 0,
  enabled: true,
  edgeAuth: "none",
  edgeTokenVersion: null,
} as const;

const PROFILE: ConnectionProfile = {
  instanceId: "ff_test",
  householdName: "A household",
  keyFingerprint: "k",
  publicKeyX: "x",
  deviceId: "d1",
  deviceCredential: "c1",
  endpoints: [ROUTE],
};

const session = (token: string, refreshToken: string | null, expiresInMs: number): StoredSession => ({
  token,
  refreshToken,
  session: { username: "admin", displayName: "Recovery admin", kind: "recovery", expiresAt: new Date(Date.now() + expiresInMs).toISOString() },
});

function memory(initial: Record<string, string>): SecureStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}

/**
 * A household that accepts one bearer at a time and rotates refresh tokens: `refresh` answers each
 * POST /auth/refresh (a status and the next bearer), and every other request needs the current bearer.
 */
function household(refresh: (body: { refreshToken: string }) => { status: number; token?: string; refreshToken?: string; code?: string }) {
  const calls: { path: string; auth: string | null }[] = [];
  let bearer = "old";
  const transport = asTransport(async (request: TransportRequest) => {
    const path = request.url.replace(ROUTE.url, "");
    calls.push({ path, auth: request.headers.Authorization ?? null });
    if (path === "/api/v1/auth/refresh") {
      const answer = refresh(JSON.parse(request.body!) as { refreshToken: string });
      if (answer.status !== 200) return { status: answer.status, headers: {}, body: JSON.stringify({ error: { code: answer.code, message: "Refused." } }) };
      bearer = answer.token!;
      const next = session(answer.token!, answer.refreshToken!, 3_600_000);
      return { status: 200, headers: {}, body: JSON.stringify({ session: next.session, token: next.token, refreshToken: next.refreshToken }) };
    }
    if (request.headers.Authorization !== `Bearer ${bearer}`) return { status: 401, headers: {}, body: JSON.stringify({ error: { code: "unauthorized", message: "Sign in." } }) };
    return { status: 200, headers: {}, body: JSON.stringify({ groups: [] }) };
  });
  return { transport, calls, expire: () => void (bearer = "rotated-elsewhere") };
}

async function signedIn(stored: StoredSession, transport: ReturnType<typeof household>["transport"]) {
  const storage = memory({ connectionProfile: JSON.stringify(PROFILE), bearerSession: JSON.stringify(stored) });
  const phone = createCompanionSession({ transport, storage, deviceName: () => "A phone" });
  await phone.load();
  return { phone, storage };
}

describe("a paired phone's session refresh", () => {
  it("renews a bearer about to expire before sending, and keeps the new tokens", async () => {
    const home = household(({ refreshToken }) => (refreshToken === "r1" ? { status: 200, token: "new", refreshToken: "r2" } : { status: 403, code: "refresh_invalid" }));
    const { phone, storage } = await signedIn(session("old", "r1", 30_000), home.transport);
    await phone.request("/api/v1/groups");
    expect(home.calls.map((call) => call.path)).toEqual(["/api/v1/auth/refresh", "/api/v1/groups"]);
    expect(home.calls[0]!.auth).toBeNull();
    expect(home.calls[1]!.auth).toBe("Bearer new");
    expect(phone.getState().session).toMatchObject({ token: "new", refreshToken: "r2" });
    expect(JSON.parse(storage.values.get("bearerSession")!)).toMatchObject({ token: "new", refreshToken: "r2" });
  });

  it("renews once and resends a request the server refused as unauthenticated", async () => {
    const home = household(() => ({ status: 200, token: "new", refreshToken: "r2" }));
    const { phone } = await signedIn(session("old", "r1", 3_600_000), home.transport);
    home.expire();
    await phone.request("/api/v1/groups");
    expect(home.calls.map((call) => call.path)).toEqual(["/api/v1/groups", "/api/v1/auth/refresh", "/api/v1/groups"]);
  });

  it("spends a refresh token once when several requests find the bearer expiring together", async () => {
    let refreshes = 0;
    const home = household(() => {
      refreshes += 1;
      return { status: 200, token: "new", refreshToken: "r2" };
    });
    const { phone } = await signedIn(session("old", "r1", 1_000), home.transport);
    await Promise.all([phone.request("/api/v1/groups"), phone.request("/api/v1/rules"), phone.request("/api/v1/devices")]);
    expect(refreshes).toBe(1);
  });

  it.each([
    [403, "refresh_reused"],
    [403, "invalid_refresh"],
    [401, "unauthorized"],
    [400, "invalid_request"],
  ])("signs the phone out when the server refuses its refresh token (%i %s)", async (status, code) => {
    const home = household(() => ({ status, code }));
    const { phone, storage } = await signedIn(session("old", "r1", 3_600_000), home.transport);
    home.expire();
    const error = await phone.request("/api/v1/groups").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(phone.getState().status).toBe("signedOut");
    expect(storage.values.has("bearerSession")).toBe(false);
    expect(storage.values.has("connectionProfile")).toBe(true);
  });

  it("keeps the session when the refresh cannot reach the household", async () => {
    let reachable = false;
    const inner = household(() => ({ status: 200, token: "new", refreshToken: "r2" }));
    const transport = asTransport(async (request) => {
      if (!reachable) throw new Error("offline");
      return inner.transport(request);
    });
    const { phone } = await signedIn(session("old", "r1", 30_000), transport);
    await expect(phone.request("/api/v1/groups")).rejects.toThrow();
    expect(phone.getState().status).toBe("signedIn");
    reachable = true;
    await phone.request("/api/v1/groups");
    expect(phone.getState().session?.token).toBe("new");
  });

  it("keeps a renewed bearer when storing it fails", async () => {
    const home = household(() => ({ status: 200, token: "new", refreshToken: "r2" }));
    const { phone, storage } = await signedIn(session("old", "r1", 30_000), home.transport);
    const set = storage.set;
    storage.set = async (key, value) => {
      if (key === "bearerSession") throw new Error("keychain unavailable");
      return set(key, value);
    };
    await phone.request("/api/v1/groups");
    expect(phone.getState().session).toMatchObject({ token: "new", refreshToken: "r2" });
    expect(home.calls.at(-1)!.auth).toBe("Bearer new");
  });

  it.each([500, 502, 503, 429])("keeps the session when the server answers the refresh with %i", async (status) => {
    let failing = true;
    const home = household(() => (failing ? { status, code: "unavailable" } : { status: 200, token: "new", refreshToken: "r2" }));
    const { phone, storage } = await signedIn(session("old", "r1", 3_600_000), home.transport);
    home.expire();
    await expect(phone.request("/api/v1/groups")).rejects.toMatchObject({ status });
    expect(phone.getState().status).toBe("signedIn");
    expect(storage.values.has("bearerSession")).toBe(true);
    failing = false;
    await phone.request("/api/v1/groups");
    expect(phone.getState().session?.token).toBe("new");
  });

  it("keeps the session and sends anyway when the server fails to answer a renewal ahead of expiry", async () => {
    const home = household(() => ({ status: 502, code: "bad_gateway" }));
    const { phone } = await signedIn(session("old", "r1", 30_000), home.transport);
    await phone.request("/api/v1/groups");
    expect(home.calls.map((call) => call.path)).toEqual(["/api/v1/auth/refresh", "/api/v1/groups"]);
    expect(phone.getState().status).toBe("signedIn");
  });

  it("never renews after a refused sign-in", async () => {
    const home = household(() => ({ status: 200, token: "new", refreshToken: "r2" }));
    const { phone } = await signedIn(session("old", "r1", 3_600_000), home.transport);
    home.expire();
    await expect(phone.request("/api/v1/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({ status: 401 });
    expect(home.calls.map((call) => call.path)).toEqual(["/api/v1/auth/login"]);
  });

  it("resends with the new bearer, without renewing again, a request refused after another request renewed", async () => {
    let refreshes = 0;
    const home = household(() => {
      refreshes += 1;
      return { status: 200, token: `new${refreshes}`, refreshToken: `r${refreshes + 1}` };
    });
    // The first groups request is answered only once the rules request has renewed and been answered.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const transport = asTransport(async (request) => {
      if (first && request.url.endsWith("/api/v1/groups")) {
        first = false;
        await held;
      }
      return home.transport(request);
    });
    const { phone } = await signedIn(session("old", "r1", 3_600_000), transport);
    home.expire();
    const slow = phone.request("/api/v1/groups");
    await phone.request("/api/v1/rules");
    release();
    await slow;
    expect(refreshes).toBe(1);
    expect(home.calls.filter((call) => call.path === "/api/v1/groups").map((call) => call.auth)).toEqual(["Bearer old", "Bearer new1"]);
  });

  it("leaves a session with no refresh token to end with its bearer", async () => {
    const home = household(() => ({ status: 200, token: "new", refreshToken: "r2" }));
    const { phone } = await signedIn(session("old", null, 3_600_000), home.transport);
    home.expire();
    await expect(phone.request("/api/v1/groups")).rejects.toMatchObject({ status: 401 });
    expect(home.calls.map((call) => call.path)).toEqual(["/api/v1/groups"]);
  });
});
