import { createPublicKey, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as identity } from "@/app/api/v1/connection/identity/route";
import { GET as listEndpoints, POST as createEndpoint } from "@/app/api/v1/connection/endpoints/route";
import { PUT as updateEndpoint } from "@/app/api/v1/connection/endpoints/[id]/route";
import { POST as createPairing } from "@/app/api/v1/connection/pairings/route";
import { POST as claimPairing } from "@/app/api/v1/connection/pairings/[id]/claim/route";
import { GET as connection } from "@/app/api/v1/connection/route";
import { PUT as setTunnel } from "@/app/api/v1/connection/tunnel/route";
import { prisma } from "@/server/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const TOKEN = { clientId: "0123456789abcdef0123456789abcdef.access", clientSecret: "s3cr3t-0123456789abcdef0123456789abcdef0123456789abcdef" };
const ROTATED = { clientId: TOKEN.clientId, clientSecret: "r0tated-fedcba9876543210fedcba9876543210fedcba9876543210" };

type Manifest = { instanceId: string; signedPayload: string; signature: string; endpoints: unknown[] };
type Payload = { instanceId: string; endpoints: { id: string; edgeAuth: string }[]; edgeCredentials?: { endpointId: string; version: number; clientId: string; clientSecret: string }[] };
type EdgeAccess = { endpointId: string; version: number; clientIdHint: string | null; rotatedAt: string | null; devices: { total: number; current: number; behind: { displayName: string }[] } };

function json(auth: SessionAuth, method: string, body?: unknown): RequestInit & { auth: SessionAuth } {
  return { method, auth, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function adminAuth() {
  const response = await login(
    request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) }),
  );
  return authFromLogin(response);
}

async function addRoute(auth: SessionAuth, body: Record<string, unknown>) {
  const response = await createEndpoint(request("/api/v1/connection/endpoints", json(auth, "POST", { trustMode: "system", ...body })));
  return { response, body: (await response.json()) as { endpoint: { id: string }; error?: { code: string } } };
}

async function update(auth: SessionAuth, id: string, body: Record<string, unknown>) {
  return updateEndpoint(request(`/api/v1/connection/endpoints/${id}`, json(auth, "PUT", body)), params(id));
}

/** A protected Cloudflare route, published the way the Pair Device page does it. */
async function protectedRoute(auth: SessionAuth) {
  const created = await addRoute(auth, { url: "https://familyfi.example.com", transport: "cloudflare", enabled: false, serviceToken: TOKEN });
  expect(created.response.status).toBe(201);
  const id = created.body.endpoint.id;
  expect((await setTunnel(request("/api/v1/connection/tunnel", json(auth, "PUT", { mode: "named", endpointId: id })))).status).toBe(200);
  return id;
}

async function pairPhone(auth: SessionAuth, endpointId: string, name: string) {
  const issued = await createPairing(request("/api/v1/connection/pairings", json(auth, "POST", { endpointId, deviceName: name })));
  const pairing = ((await issued.json()) as { pairing: { id: string; qr: { token: string; edgeCredential?: { version: number; clientId: string; clientSecret: string } } } }).pairing;
  const claim = await claimPairing(
    request(`/api/v1/connection/pairings/${pairing.id}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: pairing.qr.token, deviceName: name }) }),
    params(pairing.id),
  );
  expect(claim.status).toBe(200);
  const claimed = (await claim.json()) as { device: { id: string }; deviceCredential: string; manifest: Manifest };
  const signIn = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "native", deviceId: claimed.device.id, deviceCredential: claimed.deviceCredential }),
    }),
  );
  const bearer: SessionAuth = { cookie: "", csrf: "", token: ((await signIn.json()) as { token: string }).token };
  return { qr: pairing.qr, claimed, bearer };
}

async function verifiedPayload(manifest: Manifest): Promise<Payload> {
  const { publicKey } = (await (await identity()).json()) as { publicKey: Record<string, string> };
  const bytes = Buffer.from(manifest.signedPayload, "base64url");
  expect(verify(null, bytes, createPublicKey({ key: publicKey, format: "jwk" }), Buffer.from(manifest.signature, "base64url"))).toBe(true);
  return JSON.parse(bytes.toString("utf8")) as Payload;
}

async function manifestFor(auth: SessionAuth) {
  const response = await connection(request("/api/v1/connection", { auth }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { endpointManifest: Manifest };
  return { raw: JSON.stringify(body), payload: await verifiedPayload(body.endpointManifest) };
}

async function edgeAccess(auth: SessionAuth) {
  const listed = (await (await listEndpoints(request("/api/v1/connection/endpoints", { auth }))).json()) as { edgeAccess: EdgeAccess[] };
  return { raw: JSON.stringify(listed), access: listed.edgeAccess };
}

describe("Cloudflare Access service tokens", () => {
  let logged: string[];

  beforeEach(async () => {
    await resetDatabase();
    logged = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      });
    }
  });

  afterEach(() => {
    // Nothing FamilyFi logs may carry the secret, whatever path it took.
    expect(logged.join("\n")).not.toContain(TOKEN.clientSecret);
    expect(logged.join("\n")).not.toContain(ROTATED.clientSecret);
    vi.restoreAllMocks();
  });

  it("stores the token encrypted and never echoes it to an administrator", async () => {
    const auth = await adminAuth();
    const created = await addRoute(auth, { url: "https://familyfi.example.com", transport: "cloudflare", serviceToken: TOKEN });
    expect(created.response.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(TOKEN.clientSecret);
    expect(JSON.stringify(created.body)).not.toContain(TOKEN.clientId);

    const row = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: created.body.endpoint.id } });
    expect(row).toMatchObject({ edgeAuth: "serviceToken", edgeTokenVersion: 1, edgeTokenRotatedAt: null });
    expect(Buffer.from(row.edgeTokenCiphertext!).toString("utf8")).not.toContain(TOKEN.clientSecret);

    const { raw, access } = await edgeAccess(auth);
    expect(raw).not.toContain(TOKEN.clientSecret);
    expect(raw).not.toContain(TOKEN.clientId);
    expect(access).toEqual([{ endpointId: row.id, version: 1, clientIdHint: "…abcdef.access", rotatedAt: null, devices: { total: 0, current: 0, behind: [] } }]);

    const publicIdentity = JSON.stringify(await (await identity()).json());
    expect(publicIdentity).not.toContain(TOKEN.clientSecret);
  });

  it("puts only a household-run Cloudflare Tunnel behind Access", async () => {
    const auth = await adminAuth();
    for (const transport of ["lan", "tailscale"]) {
      const refused = await addRoute(auth, { url: `https://${transport}.example.com`, transport, serviceToken: TOKEN });
      expect(refused.response.status).toBe(409);
      expect(refused.body.error?.code).toBe("access_unsupported");
    }
    const managed = await prisma().connectionEndpoint.create({ data: { url: "https://demo.trycloudflare.com", kind: "quick", transport: "cloudflare", trustMode: "system", enabled: false } });
    expect(((await (await update(auth, managed.id, { serviceToken: TOKEN })).json()) as { error: { code: string } }).error.code).toBe("managed_route");

    // A protected route can't quietly become another transport with the token still on it.
    const id = (await addRoute(auth, { url: "https://familyfi.example.com", transport: "cloudflare", serviceToken: TOKEN })).body.endpoint.id;
    const moved = await update(auth, id, { transport: "tailscale" });
    expect(moved.status).toBe(409);

    // Nor can Access be asked for without a token, or with a token that can't be a header.
    expect((await addRoute(auth, { url: "https://bare.example.com", transport: "cloudflare", edgeAuth: "serviceToken" })).response.status).toBe(400);
    expect((await addRoute(auth, { url: "https://spaced.example.com", transport: "cloudflare", serviceToken: { clientId: "a b", clientSecret: "c" } })).response.status).toBe(400);
    expect((await addRoute(auth, { url: "https://split.example.com", transport: "cloudflare", serviceToken: { clientId: "a", clientSecret: "c\r\nx-evil: 1" } })).response.status).toBe(400);
    expect((await addRoute(auth, { url: "https://both.example.com", transport: "cloudflare", edgeAuth: "none", serviceToken: TOKEN })).response.status).toBe(400);
  });

  it("hands the token to a pairing phone in the QR and the claim, and to a paired device's manifest only", async () => {
    const auth = await adminAuth();
    const id = await protectedRoute(auth);
    const { qr, claimed, bearer } = await pairPhone(auth, id, "Kitchen iPhone");

    expect(qr.edgeCredential).toEqual({ version: 1, ...TOKEN });

    // The strictly decoded copies stay the plain route shape; the token rides inside the signed payload.
    expect(JSON.stringify(claimed.manifest.endpoints)).not.toContain("edgeAuth");
    const fromClaim = await verifiedPayload(claimed.manifest);
    expect(fromClaim.endpoints).toEqual([expect.objectContaining({ id, edgeAuth: "serviceToken" })]);
    expect(fromClaim.edgeCredentials).toEqual([{ endpointId: id, version: 1, ...TOKEN }]);

    const phone = await manifestFor(bearer);
    expect(phone.payload.edgeCredentials).toEqual([{ endpointId: id, version: 1, ...TOKEN }]);

    // A browser session — even an administrator's — never gets it.
    const browser = await manifestFor(auth);
    expect(browser.payload.edgeCredentials).toBeUndefined();
    expect(browser.payload.endpoints).toEqual([expect.objectContaining({ id, edgeAuth: "serviceToken" })]);
    expect(browser.raw).not.toContain(TOKEN.clientSecret);
    expect(Buffer.from(JSON.parse(browser.raw).endpointManifest.signedPayload, "base64url").toString()).not.toContain(TOKEN.clientSecret);
  });

  it("tracks a rotation until every active phone has the new token", async () => {
    const auth = await adminAuth();
    const id = await protectedRoute(auth);
    const kitchen = await pairPhone(auth, id, "Kitchen iPhone");
    const bedroom = await pairPhone(auth, id, "Bedroom iPhone");
    expect((await edgeAccess(auth)).access[0].devices).toEqual({ total: 2, current: 2, behind: [] });

    // Saving the same token again is not a rotation.
    expect((await update(auth, id, { serviceToken: TOKEN })).status).toBe(200);
    expect((await edgeAccess(auth)).access[0].version).toBe(1);

    expect((await update(auth, id, { serviceToken: ROTATED })).status).toBe(200);
    let access = (await edgeAccess(auth)).access[0];
    expect(access.version).toBe(2);
    expect(access.rotatedAt).not.toBeNull();
    expect(access.devices).toMatchObject({ total: 2, current: 0 });

    const picked = await manifestFor(kitchen.bearer);
    expect(picked.payload.edgeCredentials).toEqual([{ endpointId: id, version: 2, ...ROTATED }]);
    access = (await edgeAccess(auth)).access[0];
    expect(access.devices).toEqual({ total: 2, current: 1, behind: [expect.objectContaining({ displayName: "Bedroom iPhone" })] });

    // A phone not seen for longer than any grace period, or revoked, is no longer waited for.
    await prisma().pairedDevice.update({ where: { id: bedroom.claimed.device.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } });
    expect((await edgeAccess(auth)).access[0].devices).toEqual({ total: 1, current: 1, behind: [] });
    await prisma().pairedDevice.update({ where: { id: bedroom.claimed.device.id }, data: { lastSeenAt: new Date(), revokedAt: new Date() } });
    expect((await edgeAccess(auth)).access[0].devices).toEqual({ total: 1, current: 1, behind: [] });
  });

  it("keeps the token when an edit leaves it out, and forgets it when Access is turned off", async () => {
    const auth = await adminAuth();
    const id = await protectedRoute(auth);
    await pairPhone(auth, id, "Kitchen iPhone");

    expect((await update(auth, id, { url: "https://home.example.com", edgeAuth: "serviceToken" })).status).toBe(200);
    expect((await edgeAccess(auth)).access).toEqual([expect.objectContaining({ endpointId: id, version: 1 })]);

    expect((await update(auth, id, { edgeAuth: "none" })).status).toBe(200);
    const row = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ edgeAuth: "none", edgeTokenCiphertext: null, edgeTokenIv: null, edgeTokenAuthTag: null });
    expect(await prisma().deviceEdgeToken.count({ where: { endpointId: id } })).toBe(0);
    expect((await edgeAccess(auth)).access).toEqual([]);

    // Turning it back on never reuses a version a phone already saw.
    expect((await update(auth, id, { serviceToken: ROTATED })).status).toBe(200);
    expect((await edgeAccess(auth)).access[0].version).toBe(2);
  });

  it("leaves an unprotected Cloudflare Tunnel route exactly as before", async () => {
    const auth = await adminAuth();
    const created = await addRoute(auth, { url: "https://familyfi.example.com", transport: "cloudflare", enabled: false });
    const id = created.body.endpoint.id;
    expect((await setTunnel(request("/api/v1/connection/tunnel", json(auth, "PUT", { mode: "named", endpointId: id })))).status).toBe(200);
    const { qr, claimed, bearer } = await pairPhone(auth, id, "Kitchen iPhone");
    expect(qr.edgeCredential).toBeUndefined();
    expect((await verifiedPayload(claimed.manifest)).edgeCredentials).toEqual([]);
    const phone = await manifestFor(bearer);
    expect(phone.payload.endpoints).toEqual([expect.objectContaining({ id, edgeAuth: "none" })]);
    expect(await prisma().deviceEdgeToken.count()).toBe(0);
  });
});
