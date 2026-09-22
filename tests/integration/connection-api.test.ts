import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as identity } from "@/app/api/v1/connection/identity/route";
import { POST as createEndpoint } from "@/app/api/v1/connection/endpoints/route";
import { POST as createPairing } from "@/app/api/v1/connection/pairings/route";
import { POST as claimPairing } from "@/app/api/v1/connection/pairings/[id]/claim/route";
import { DELETE as revokeDevice } from "@/app/api/v1/connection/devices/[id]/route";
import { GET as connection } from "@/app/api/v1/connection/route";
import { prisma } from "@/server/db";
import { authFromLogin, request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

async function adminAuth() {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
    }),
  );
  return authFromLogin(response);
}

describe("companion connection API", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("publishes a stable non-secret identity", async () => {
    const first = await identity();
    const second = await identity();
    const body = (await first.json()) as { instanceId: string; keyFingerprint: string; publicKey: unknown };
    expect(first.status).toBe(200);
    expect(body.instanceId).toMatch(/^ff_/);
    expect(body.keyFingerprint).toHaveLength(43);
    expect(JSON.stringify(body)).not.toMatch(/private|ciphertext|password|credential/i);
    expect((await second.json()) as { instanceId: string }).toMatchObject({ instanceId: body.instanceId });
  });

  it("requires an administrator, uses a pairing once, binds login, and revokes all phone sessions", async () => {
    const unauthenticated = await createEndpoint(
      request("/api/v1/connection/endpoints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://familyfi.local", transport: "lan", trustMode: "pinned", spkiSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      }),
    );
    expect(unauthenticated.status).toBe(401);

    const auth = await adminAuth();
    const endpointResponse = await createEndpoint(
      request("/api/v1/connection/endpoints", {
        method: "POST", auth, headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://familyfi.local", transport: "lan", trustMode: "pinned", spkiSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      }),
    );
    expect(endpointResponse.status).toBe(201);
    const endpoint = (await endpointResponse.json()) as { endpoint: { id: string } };

    const pairingResponse = await createPairing(
      request("/api/v1/connection/pairings", {
        method: "POST", auth, headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpointId: endpoint.endpoint.id, deviceName: "Kitchen iPhone" }),
      }),
    );
    expect(pairingResponse.status).toBe(201);
    const pairing = (await pairingResponse.json()) as { pairing: { id: string; qr: { token: string; instanceId: string; endpoint: { spkiSha256: string } } } };
    expect(pairing.pairing.qr.token).toBeTruthy();
    expect(pairing.pairing.qr.endpoint.spkiSha256).toHaveLength(43);

    const claim = await claimPairing(
      request(`/api/v1/connection/pairings/${pairing.pairing.id}/claim`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: pairing.pairing.qr.token, deviceName: "Nick's iPhone" }),
      }),
      { params: Promise.resolve({ id: pairing.pairing.id }) },
    );
    expect(claim.status).toBe(200);
    const claimed = (await claim.json()) as { device: { id: string }; deviceCredential: string; manifest: { signature: string } };
    expect(claimed.deviceCredential).toBeTruthy();
    expect(claimed.manifest.signature).toBeTruthy();

    const repeatClaim = await claimPairing(
      request(`/api/v1/connection/pairings/${pairing.pairing.id}/claim`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: pairing.pairing.qr.token, deviceName: "Another phone" }),
      }),
      { params: Promise.resolve({ id: pairing.pairing.id }) },
    );
    expect(repeatClaim.status).toBe(403);

    const nativeLogin = await login(
      request("/api/v1/auth/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: PASSWORD, client: "native", deviceId: claimed.device.id, deviceCredential: claimed.deviceCredential }),
      }),
    );
    const nativeBody = (await nativeLogin.json()) as { token: string };
    expect(nativeLogin.status).toBe(200);
    const bearer = { cookie: "", csrf: "", token: nativeBody.token };
    expect((await connection(request("/api/v1/connection", { auth: bearer }))).status).toBe(200);

    const revoked = await revokeDevice(request(`/api/v1/connection/devices/${claimed.device.id}`, { method: "DELETE", auth }), {
      params: Promise.resolve({ id: claimed.device.id }),
    });
    expect(revoked.status).toBe(200);
    expect((await connection(request("/api/v1/connection", { auth: bearer }))).status).toBe(401);
    expect(await prisma().session.count({ where: { deviceId: claimed.device.id, revokedAt: null } })).toBe(0);
  });
});
