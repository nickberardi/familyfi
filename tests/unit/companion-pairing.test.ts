/**
 * Pairing and the companion transport against a fake household: identity, claim, sign-in and the
 * route list, over a transport that records every request. The household's key is made and used the
 * way the server makes and uses it (`src/server/connection.ts`), and the code the way it encodes one.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { TransportError } from "@/lib/api-client";
import { claimHousehold, refreshRoutes, signInPaired, verifyHousehold } from "@/lib/companion-pairing";
import { createCompanionRequest, type Transport, type TransportRequest, type TransportResponse } from "@/lib/companion-request";
import { createCompanionSession, type SecureStorage } from "@/lib/companion-session";
import { IDENTITY_MISMATCH, MANIFEST_MISSING_ENDPOINT, MANIFEST_SIGNATURE_INVALID, type EndpointCredential } from "@/lib/companion-trust";
import { PAIRING_CODE_INCOMPLETE } from "@/lib/pairing-code";
import type { ConnectionRoute } from "@/lib/types";
import { instanceFingerprint } from "@/server/connection";
import { encodePairingCode } from "@/server/pairing-code";
import { describe, expect, it } from "vitest";

const LAN: ConnectionRoute = {
  id: "r-lan",
  url: "https://familyfi.home",
  kind: "own",
  transport: "lan",
  trustMode: "pinned",
  spkiSha256: "p".repeat(43),
  priority: 0,
  enabled: true,
  edgeAuth: "none",
  edgeTokenVersion: null,
};
const EDGE: ConnectionRoute = {
  ...LAN,
  id: "r-edge",
  url: "https://familyfi.example.com",
  transport: "cloudflare",
  trustMode: "system",
  spkiSha256: null,
  priority: 1,
  edgeAuth: "serviceToken",
  edgeTokenVersion: 1,
};
const CREDENTIAL: EndpointCredential = {
  endpointId: "r-edge",
  version: 1,
  clientId: "id.access",
  clientSecret: "secret",
};

function household({ manifestEndpoints = [LAN, EDGE], otherSigner = false } = {}) {
  const keys = generateKeyPairSync("ed25519");
  const signer = otherSigner ? generateKeyPairSync("ed25519") : keys;
  const x = (keys.publicKey.export({ format: "jwk" }) as { x: string }).x;
  const fingerprint = instanceFingerprint(JSON.stringify({ x }));
  const manifest = (body: unknown) => {
    const bytes = Buffer.from(JSON.stringify(body));
    return {
      signedPayload: bytes.toString("base64url"),
      signature: sign(null, bytes, signer.privateKey).toString("base64url"),
    };
  };
  const calls: TransportRequest[] = [];
  const routes: Record<string, (request: TransportRequest) => TransportResponse> = {
    "GET /api/v1/connection/identity": () =>
      json(200, {
        protocolVersion: 1,
        householdName: "A household",
        instanceId: "ff_home",
        publicKey: { kty: "OKP", crv: "Ed25519", x },
        keyFingerprint: fingerprint,
      }),
    "POST /api/v1/connection/pairings/cm1/claim": () =>
      json(200, {
        device: { id: "dev-1", displayName: "A phone" },
        deviceCredential: "device-secret",
        manifest: manifest({
          instanceId: "ff_home",
          endpoints: manifestEndpoints,
          edgeCredentials: manifestEndpoints.includes(EDGE) ? [CREDENTIAL] : [],
        }),
      }),
    "POST /api/v1/auth/login": (request) => {
      const body = JSON.parse(request.body ?? "{}");
      return body.client === "native" && body.deviceCredential === "device-secret" && body.password === "right"
        ? json(200, {
            session: {
              username: "admin",
              displayName: "An adult",
              kind: "recovery",
              expiresAt: "2030-01-01T00:00:00Z",
            },
            token: "bearer-1",
            tokenType: "Bearer",
          })
        : json(401, { error: { code: "invalid_credentials", message: "Invalid username or password." } });
    },
    "GET /api/v1/connection": () =>
      json(200, {
        endpointManifest: manifest({
          instanceId: "ff_home",
          endpoints: [LAN, { ...EDGE, edgeTokenVersion: 2 }],
          edgeCredentials: [{ ...CREDENTIAL, version: 2, clientSecret: "rotated" }],
        }),
      }),
  };
  const transport: Transport = async (request) => {
    calls.push(request);
    const url = new URL(request.url);
    const handler = routes[`${request.method} ${url.pathname}`];
    return handler ? handler(request) : json(404, { error: { code: "not_found", message: "No route" } });
  };
  const code = encodePairingCode({ version: 1, url: LAN.url, code: "cm1.token-1", fingerprint, pin: LAN.spkiSha256! });
  return { transport, calls, code, fingerprint };
}

const json = (status: number, body: unknown): TransportResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("pairing a phone", () => {
  it("verifies the household, claims only when asked, and signs in with the device credential", async () => {
    const home = household();
    const pending = await verifyHousehold(home.transport, home.code);
    expect(pending.identity.householdName).toBe("A household");
    // Verifying sends one unauthenticated read, pinned to the code's certificate, and spends nothing.
    expect(home.calls.map((call) => [call.method, new URL(call.url).pathname, call.trustMode, call.pin])).toEqual([
      ["GET", "/api/v1/connection/identity", "pinned", LAN.spkiSha256],
    ]);

    const { profile, edgeCredentials } = await claimHousehold(home.transport, pending, "A phone");
    expect(profile).toMatchObject({
      instanceId: "ff_home",
      deviceId: "dev-1",
      deviceCredential: "device-secret",
      keyFingerprint: home.fingerprint,
    });
    expect(profile.endpoints.map((route) => route.id)).toEqual(["r-lan", "r-edge"]);
    expect(edgeCredentials).toEqual([CREDENTIAL]);
    expect(JSON.parse(home.calls[1]!.body!)).toEqual({ token: "token-1", deviceName: "A phone" });

    const request = createCompanionRequest(home.transport, {
      routes: () => profile.endpoints,
      edgeCredentials: () => edgeCredentials,
    });
    await expect(signInPaired(request, profile, "admin", "wrong")).rejects.toMatchObject({
      status: 401,
      message: "Invalid username or password.",
    });
    await expect(signInPaired(request, profile, "admin", "right")).resolves.toMatchObject({ token: "bearer-1" });
  });

  it("never reaches the network for a malformed code, and never claims for a household the code did not name", async () => {
    const home = household();
    await expect(
      verifyHousehold(
        home.transport,
        Buffer.from(JSON.stringify({ version: 1, url: "http://x", code: "a.b", fingerprint: "f" })).toString(
          "base64url",
        ),
      ),
    ).rejects.toThrow(PAIRING_CODE_INCOMPLETE);
    expect(home.calls).toEqual([]);

    const impostor = household();
    await expect(verifyHousehold(impostor.transport, home.code)).rejects.toThrow(IDENTITY_MISMATCH);
    expect(impostor.calls.map((call) => call.method)).toEqual(["GET"]); // the code was never spent
  });

  it("refuses a claim whose manifest another key signed, or that leaves out the route it paired over", async () => {
    const forged = household({ otherSigner: true });
    await expect(
      claimHousehold(forged.transport, await verifyHousehold(forged.transport, forged.code), "A phone"),
    ).rejects.toThrow(MANIFEST_SIGNATURE_INVALID);

    const moved = household({ manifestEndpoints: [EDGE] });
    await expect(
      claimHousehold(moved.transport, await verifyHousehold(moved.transport, moved.code), "A phone"),
    ).rejects.toThrow(MANIFEST_MISSING_ENDPOINT);
  });

  it("refreshes routes only from a manifest the trusted key signed, and moves Access tokens up", async () => {
    const home = household();
    const { profile, edgeCredentials } = await claimHousehold(
      home.transport,
      await verifyHousehold(home.transport, home.code),
      "A phone",
    );
    const request = createCompanionRequest(home.transport, {
      routes: () => profile.endpoints,
      edgeCredentials: () => edgeCredentials,
      token: () => "bearer-1",
    });
    const refreshed = await refreshRoutes(request, profile, edgeCredentials);
    expect(refreshed.edgeCredentials).toEqual([{ ...CREDENTIAL, version: 2, clientSecret: "rotated" }]);
  });
});

describe("companion requests", () => {
  const routes = [LAN, EDGE];
  const unreachable = async () => Promise.reject(new TransportError(new Error("unreachable")));

  it("moves a read to the next route when one is unreachable, and sends Access headers only there", async () => {
    const calls: TransportRequest[] = [];
    const transport: Transport = async (request) => {
      calls.push(request);
      return request.url.startsWith(LAN.url) ? unreachable() : json(200, { ok: true });
    };
    const request = createCompanionRequest(transport, {
      routes: () => routes,
      edgeCredentials: () => [CREDENTIAL],
      token: () => "bearer-1",
    });
    await expect(request("/api/v1/groups")).resolves.toEqual({ ok: true });
    expect(calls.map((call) => new URL(call.url).origin)).toEqual([LAN.url, EDGE.url]);
    expect(calls[0]!.headers["CF-Access-Client-Id"]).toBeUndefined();
    expect(calls[1]!.headers).toMatchObject({
      "CF-Access-Client-Id": "id.access",
      "CF-Access-Client-Secret": "secret",
      Authorization: "Bearer bearer-1",
    });
  });

  it("never retries a household write on another route", async () => {
    const calls: TransportRequest[] = [];
    const transport: Transport = async (request) => {
      calls.push(request);
      return unreachable();
    };
    const request = createCompanionRequest(transport, { routes: () => routes, edgeCredentials: () => [CREDENTIAL] });
    await expect(request("/api/v1/groups/g/rules/internet/pause", { method: "POST", body: {} })).rejects.toBeInstanceOf(
      TransportError,
    );
    expect(calls).toHaveLength(1);
  });

  it("sends a write to the route that last answered, after a read has failed over", async () => {
    const calls: TransportRequest[] = [];
    let active: string | null = null;
    const transport: Transport = async (request) => {
      calls.push(request);
      return request.url.startsWith(LAN.url) ? unreachable() : json(200, { ok: true });
    };
    const request = createCompanionRequest(transport, {
      routes: () => routes,
      edgeCredentials: () => [CREDENTIAL],
      activeRouteId: () => active,
      onRoute: (route) => void (active = route.id),
    });
    await request("/api/v1/groups");
    calls.length = 0;
    await expect(request("/api/v1/groups/g/rules/internet/pause", { method: "POST", body: {} })).resolves.toEqual({ ok: true });
    expect(calls.map((call) => new URL(call.url).origin)).toEqual([EDGE.url]);
  });

  it("moves a sign-in to the next route when one is unreachable", async () => {
    const calls: TransportRequest[] = [];
    const transport: Transport = async (request) => {
      calls.push(request);
      return request.url.startsWith(LAN.url) ? unreachable() : json(200, { ok: true });
    };
    const request = createCompanionRequest(transport, { routes: () => routes, edgeCredentials: () => [CREDENTIAL] });
    await expect(request("/api/v1/auth/login", { method: "POST", body: {} })).resolves.toEqual({ ok: true });
    expect(calls.map((call) => new URL(call.url).origin)).toEqual([LAN.url, EDGE.url]);
  });

  it("treats a Cloudflare Access wall as the route being unavailable, not as signed out", async () => {
    const transport: Transport = async (request) =>
      request.url.startsWith(LAN.url)
        ? { status: 302, headers: { Location: "https://team.cloudflareaccess.com/login" }, body: "" }
        : json(200, { ok: true });
    const request = createCompanionRequest(transport, { routes: () => routes, edgeCredentials: () => [CREDENTIAL] });
    await expect(request("/api/v1/groups")).resolves.toEqual({ ok: true });
  });

  it("refuses any path outside /api/v1", async () => {
    const request = createCompanionRequest(household().transport, { routes: () => routes, edgeCredentials: () => [] });
    await expect(request("/openapi")).rejects.toThrow("Not an /api/v1 path");
  });
});

describe("a companion session", () => {
  const memory = (): SecureStorage & { keys: () => string[] } => {
    const values = new Map<string, string>();
    return {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => void values.set(key, value),
      delete: async (key) => void values.delete(key),
      keys: () => [...values.keys()].sort(),
    };
  };

  it("pairs, signs in, signs out keeping the pairing, and lands the next launch on sign-in", async () => {
    const home = household();
    const storage = memory();
    const session = createCompanionSession({ transport: home.transport, storage, deviceName: () => "A phone" });
    await session.load();
    expect(session.getState().status).toBe("unpaired");

    await session.verify(home.code);
    expect(session.getState().pending?.identity.householdName).toBe("A household");
    expect(storage.keys()).toEqual([]); // nothing kept before the person trusts it
    await session.trust();
    expect(session.getState()).toMatchObject({ status: "signedOut", pending: null });
    expect(storage.keys()).toEqual(["connectionProfile", "edgeCredentials"]);

    expect(await session.signIn("admin", "wrong")).toBe("Invalid username or password.");
    expect(await session.signIn("admin", "right")).toBeNull();
    expect(session.getState().status).toBe("signedIn");
    expect(session.getState().activeRouteId).toBe("r-lan");

    await session.signOut();
    expect(session.getState().status).toBe("signedOut");
    const relaunch = createCompanionSession({ transport: home.transport, storage, deviceName: () => "A phone" });
    await relaunch.load();
    expect(relaunch.getState()).toMatchObject({ status: "signedOut", profile: { deviceId: "dev-1" } });

    await relaunch.forget();
    expect(storage.keys()).toEqual([]);
    expect(relaunch.getState().status).toBe("unpaired");
  });

  it("drops a household the person rejects without spending its code", async () => {
    const home = household();
    const session = createCompanionSession({ transport: home.transport, storage: memory(), deviceName: () => "A phone" });
    await session.load();
    await session.verify(home.code);
    session.reject();
    expect(session.getState().pending).toBeNull();
    expect(home.calls.map((call) => call.method)).toEqual(["GET"]);
  });
});

