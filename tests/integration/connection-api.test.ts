import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as identity } from "@/app/api/v1/connection/identity/route";
import { GET as listEndpoints, POST as createEndpoint } from "@/app/api/v1/connection/endpoints/route";
import { DELETE as deleteEndpoint, PUT as updateEndpoint } from "@/app/api/v1/connection/endpoints/[id]/route";
import { POST as createPairing } from "@/app/api/v1/connection/pairings/route";
import { DELETE as cancelPairing, GET as pairingStatus } from "@/app/api/v1/connection/pairings/[id]/route";
import { DELETE as removeRevoked, GET as listDevices } from "@/app/api/v1/connection/devices/route";
import { POST as claimPairing } from "@/app/api/v1/connection/pairings/[id]/claim/route";
import { DELETE as revokeDevice } from "@/app/api/v1/connection/devices/[id]/route";
import { GET as connection } from "@/app/api/v1/connection/route";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountKind } from "@prisma/client";
import { POST as computePin } from "@/app/api/v1/connection/pins/route";
import { GET as tunnelState, PUT as setTunnel } from "@/app/api/v1/connection/tunnel/route";
import { TUNNEL_HEADER } from "@/lib/constants";
import { hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
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

function json(auth: SessionAuth, method: string, body?: unknown): RequestInit & { auth: SessionAuth } {
  return { method, auth, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function addRoute(auth: SessionAuth, url = "https://familyfi.home:8443") {
  const response = await createEndpoint(request("/api/v1/connection/endpoints", json(auth, "POST", { url, transport: "lan", trustMode: "system" })));
  return { response, body: (await response.json()) as { endpoint: { id: string }; error?: { code: string; message: string } } };
}

async function issuePairing(auth: SessionAuth, endpointId: string) {
  const response = await createPairing(request("/api/v1/connection/pairings", json(auth, "POST", { endpointId, deviceName: "Kitchen iPhone" })));
  return ((await response.json()) as { pairing: { id: string; qr: { token: string } } }).pairing;
}

async function claim(id: string, token: string) {
  return claimPairing(
    request(`/api/v1/connection/pairings/${id}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, deviceName: "Nick's iPhone" }) }),
    params(id),
  );
}

describe("companion admin surface", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("serves admin reads to a cookie session without a CSRF header, but still guards writes", async () => {
    const auth = await adminAuth();
    const noCsrf = { cookie: auth.cookie, csrf: "" };
    expect((await listEndpoints(request("/api/v1/connection/endpoints", { auth: noCsrf }))).status).toBe(200);
    expect((await listDevices(request("/api/v1/connection/devices", { auth: noCsrf }))).status).toBe(200);
    const write = await createEndpoint(request("/api/v1/connection/endpoints", json(noCsrf, "POST", { url: "https://a.home", transport: "lan", trustMode: "system" })));
    expect(write.status).toBe(403);
  });

  it("refuses a personal account that is not an admin", async () => {
    await prisma().account.create({ data: { username: "sam", displayName: "Sam", kind: AccountKind.personal, isAdmin: false, passwordHash: await hashPassword("sam-password-1") } });
    const response = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "sam", password: "sam-password-1", client: "browser" }) }));
    const sam = authFromLogin(response);
    const denied = await listEndpoints(request("/api/v1/connection/endpoints", { auth: sam }));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("administrator_required");
  });

  it("rejects a duplicate address with a clean 409", async () => {
    const auth = await adminAuth();
    expect((await addRoute(auth)).response.status).toBe(201);
    const duplicate = await addRoute(auth, "https://familyfi.home:8443/");
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.error).toEqual({ code: "endpoint_exists", message: "A route with this address already exists." });

    const other = await addRoute(auth, "https://vpn.example.com");
    const renamed = await updateEndpoint(request(`/api/v1/connection/endpoints/${other.body.endpoint.id}`, json(auth, "PUT", { url: "https://familyfi.home:8443" })), params(other.body.endpoint.id));
    expect(renamed.status).toBe(409);
  });

  it("reports pairing status, cancels a pending code, and only then lets its route go", async () => {
    const auth = await adminAuth();
    const route = (await addRoute(auth)).body.endpoint.id;
    const pairing = await issuePairing(auth, route);

    const status = await pairingStatus(request(`/api/v1/connection/pairings/${pairing.id}`, { auth }), params(pairing.id));
    expect(((await status.json()) as { pairing: { status: string } }).pairing.status).toBe("pending");

    const blocked = await deleteEndpoint(request(`/api/v1/connection/endpoints/${route}`, json(auth, "DELETE")), params(route));
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("endpoint_in_use");

    expect((await cancelPairing(request(`/api/v1/connection/pairings/${pairing.id}`, json(auth, "DELETE")), params(pairing.id))).status).toBe(200);
    expect((await cancelPairing(request(`/api/v1/connection/pairings/${pairing.id}`, json(auth, "DELETE")), params(pairing.id))).status).toBe(404);
    expect((await claim(pairing.id, pairing.qr.token)).status).toBe(403);

    expect((await deleteEndpoint(request(`/api/v1/connection/endpoints/${route}`, json(auth, "DELETE")), params(route))).status).toBe(200);
    expect((await deleteEndpoint(request(`/api/v1/connection/endpoints/${route}`, json(auth, "DELETE")), params(route))).status).toBe(404);
  });

  it("shows the route a phone paired through, and survives that route being deleted", async () => {
    const auth = await adminAuth();
    const route = (await addRoute(auth)).body.endpoint.id;
    const pairing = await issuePairing(auth, route);
    expect((await claim(pairing.id, pairing.qr.token)).status).toBe(200);

    const status = await pairingStatus(request(`/api/v1/connection/pairings/${pairing.id}`, { auth }), params(pairing.id));
    expect(((await status.json()) as { pairing: { status: string; device: { displayName: string } } }).pairing).toMatchObject({ status: "claimed", device: { displayName: "Nick's iPhone" } });

    type Devices = { devices: { pairedVia: { endpointId: string; url: string; transport: string } | null }[] };
    const before = (await (await listDevices(request("/api/v1/connection/devices", { auth }))).json()) as Devices;
    expect(before.devices[0].pairedVia).toEqual({ endpointId: route, url: "https://familyfi.home:8443", transport: "lan" });

    expect((await deleteEndpoint(request(`/api/v1/connection/endpoints/${route}`, json(auth, "DELETE")), params(route))).status).toBe(200);
    const after = (await (await listDevices(request("/api/v1/connection/devices", { auth }))).json()) as Devices;
    expect(after.devices[0].pairedVia).toBeNull();
  });
});

describe("certificate pins", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("computes a pin from a pasted certificate for an admin only, and pairs a route pinned with it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "familyfi-pin-"));
    try {
      execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=familyfi.home", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem")], { stdio: "ignore" });
      const certificate = readFileSync(path.join(dir, "c.pem"), "utf8");

      expect((await computePin(request("/api/v1/connection/pins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ certificate }) }))).status).toBe(401);

      const auth = await adminAuth();
      const response = await computePin(request("/api/v1/connection/pins", json(auth, "POST", { certificate })));
      expect(response.status).toBe(200);
      const { pin } = (await response.json()) as { pin: { spkiSha256: string; source: string; systemTrusted: null } };
      expect(pin).toMatchObject({ source: "certificate", systemTrusted: null });

      const route = await createEndpoint(request("/api/v1/connection/endpoints", json(auth, "POST", { url: "https://familyfi.home:8443", transport: "lan", trustMode: "pinned", spkiSha256: pin.spkiSha256 })));
      expect(route.status).toBe(201);
      const created = (await route.json()) as { endpoint: { id: string } };
      const pairing = await issuePairing(auth, created.endpoint.id);
      const claimed = await claim(pairing.id, pairing.qr.token);
      const body = (await claimed.json()) as { endpoint: { spkiSha256: string } };
      expect(body.endpoint.spkiSha256).toBe(pin.spkiSha256);

      const bad = await computePin(request("/api/v1/connection/pins", json(auth, "POST", { certificate: "nope" })));
      expect(bad.status).toBe(422);
      const both = await computePin(request("/api/v1/connection/pins", json(auth, "POST", { certificate, url: "https://x.home" })));
      expect(both.status).toBe(400);
      const plain = await computePin(request("/api/v1/connection/pins", json(auth, "POST", { url: "http://x.home" })));
      expect(plain.status).toBe(400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("remote access", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  function tunnelLogin(body: Record<string, unknown>) {
    return login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", [TUNNEL_HEADER]: "tunnel" }, body: JSON.stringify({ username: "admin", password: PASSWORD, ...body }) }));
  }

  it("keeps browser sign-in off the tunnel and checks the phone before the password", async () => {
    const browser = await tunnelLogin({ client: "browser" });
    expect(browser.status).toBe(403);
    expect(((await browser.json()) as { error: { code: string } }).error.code).toBe("remote_browser_login");

    const unpaired = await tunnelLogin({ client: "native", password: "wrong-guess", deviceId: "nope", deviceCredential: "nope" });
    expect(unpaired.status).toBe(403);
    expect(((await unpaired.json()) as { error: { code: string } }).error.code).toBe("device_not_paired");
    // The password was never checked, so the internet learns nothing and burns no attempt.
    expect(await prisma().loginAttempt.count()).toBe(0);

    const auth = await adminAuth();
    const route = (await addRoute(auth)).body.endpoint.id;
    const pairing = await issuePairing(auth, route);
    const claimed = (await (await claim(pairing.id, pairing.qr.token)).json()) as { device: { id: string }; deviceCredential: string };
    const phone = await tunnelLogin({ client: "native", deviceId: claimed.device.id, deviceCredential: claimed.deviceCredential });
    expect(phone.status).toBe(200);
    expect(((await phone.json()) as { tokenType: string }).tokenType).toBe("Bearer");
  });

  it("reports and switches remote access for an admin, and says when cloudflared is missing", async () => {
    expect((await tunnelState(request("/api/v1/connection/tunnel"))).status).toBe(401);
    const auth = await adminAuth();
    const initial = (await (await tunnelState(request("/api/v1/connection/tunnel", { auth }))).json()) as { tunnel: { mode: string; status: string } };
    expect(initial.tunnel).toMatchObject({ mode: "off", status: "off" });

    expect((await setTunnel(request("/api/v1/connection/tunnel", json(auth, "PUT", { mode: "named" })))).status).toBe(400);

    const off = (await (await setTunnel(request("/api/v1/connection/tunnel", json(auth, "PUT", { mode: "off" })))).json()) as { tunnel: { mode: string; status: string } };
    expect(off.tunnel).toMatchObject({ mode: "off", status: "off" });
  });
});

describe("removing and re-pairing phones", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function pairPhone(auth: SessionAuth, route: string, body: Record<string, unknown> = {}) {
    const response = await createPairing(request("/api/v1/connection/pairings", json(auth, "POST", { endpointId: route, deviceName: "Kitchen iPhone", ...body })));
    const pairing = ((await response.json()) as { pairing: { id: string; qr: { token: string } } }).pairing;
    const claimed = (await (await claim(pairing.id, pairing.qr.token)).json()) as { device: { id: string }; deviceCredential: string };
    const native = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "native", deviceId: claimed.device.id, deviceCredential: claimed.deviceCredential }) }));
    const { token } = (await native.json()) as { token: string };
    return { id: claimed.device.id, bearer: { cookie: "", csrf: "", token } };
  }

  const revoke = (auth: SessionAuth, id: string, query = "") =>
    revokeDevice(request(`/api/v1/connection/devices/${id}${query}`, { method: "DELETE", auth }), { params: Promise.resolve({ id }) });

  it("removes one phone for good, signing it out even if it was still active", async () => {
    const auth = await adminAuth();
    const route = (await addRoute(auth)).body.endpoint.id;
    const phone = await pairPhone(auth, route);
    expect((await connection(request("/api/v1/connection", { auth: phone.bearer }))).status).toBe(200);

    expect((await revoke(auth, phone.id, "?remove=true")).status).toBe(200);
    expect(await prisma().pairedDevice.findUnique({ where: { id: phone.id } })).toBeNull();
    expect((await connection(request("/api/v1/connection", { auth: phone.bearer }))).status).toBe(401);
    expect((await revoke(auth, phone.id, "?remove=true")).status).toBe(404);
  });

  it("removes every revoked phone at once and leaves active ones alone", async () => {
    const auth = await adminAuth();
    const route = (await addRoute(auth)).body.endpoint.id;
    const [a, b, keep] = [await pairPhone(auth, route), await pairPhone(auth, route), await pairPhone(auth, route)];
    await revoke(auth, a.id);
    await revoke(auth, b.id);

    expect((await removeRevoked(request("/api/v1/connection/devices", { method: "DELETE", auth }))).status).toBe(400);
    const removed = await removeRevoked(request("/api/v1/connection/devices?revoked=true", { method: "DELETE", auth }));
    expect(await removed.json()).toEqual({ removed: 2 });
    expect((await prisma().pairedDevice.findMany()).map((device) => device.id)).toEqual([keep.id]);
    expect((await connection(request("/api/v1/connection", { auth: keep.bearer }))).status).toBe(200);
  });

  it("re-pairs a revoked phone and drops its old entry once the new pairing is claimed", async () => {
    const auth = await adminAuth();
    const route = (await addRoute(auth)).body.endpoint.id;
    const old = await pairPhone(auth, route);
    await revoke(auth, old.id);

    const unknown = await createPairing(request("/api/v1/connection/pairings", json(auth, "POST", { endpointId: route, deviceName: "x", replacesDeviceId: "missing" })));
    expect(unknown.status).toBe(404);

    const fresh = await pairPhone(auth, route, { replacesDeviceId: old.id });
    const devices = await prisma().pairedDevice.findMany();
    expect(devices.map((device) => device.id)).toEqual([fresh.id]);
    expect((await connection(request("/api/v1/connection", { auth: fresh.bearer }))).status).toBe(200);
  });
});
