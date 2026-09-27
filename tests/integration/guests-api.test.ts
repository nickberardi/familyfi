import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as listGuests } from "@/app/api/v1/guests/route";
import { POST as createPass } from "@/app/api/v1/guest-passes/route";
import { DELETE as revokePass } from "@/app/api/v1/guest-passes/[id]/route";
import { POST as createVoucher } from "@/app/api/v1/guest-vouchers/route";
import { DELETE as revokeVoucher } from "@/app/api/v1/guest-vouchers/[id]/route";
import { prisma } from "@/server/db";
import { saveUnifiConnection } from "@/server/unifi-settings";
import {
  DEV_MOCK_API_KEY, DEV_MOCK_BASE_URL, DEV_MOCK_INTERNAL_NETWORK, DEV_MOCK_IOT_NETWORK,
  getSharedDevMockClient, resetDevMockClientForTests,
} from "@/server/unifi/dev-mock";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const GUEST_ZONE = "33333333-3333-4333-8333-333333333336";
const GUEST_NETWORK = "22222222-2222-4222-8222-222222222226";
const CLIENT = "44444444-4444-4444-8444-444444444446";
const MAC = "02:00:00:00:00:46";
const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

async function signedIn(): Promise<SessionAuth> {
  const response = await login(request("/api/v1/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
  }));
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

describe("guest access API", () => {
  const previous = process.env.UNIFI_MOCK;
  let auth: SessionAuth;

  beforeEach(async () => {
    process.env.UNIFI_MOCK = "1";
    resetDevMockClientForTests();
    await resetDatabase();
    const mock = getSharedDevMockClient();
    mock.state.zones.push({ id: GUEST_ZONE, name: "Hotspot", networkIds: [GUEST_NETWORK] });
    mock.state.networks.push({
      id: GUEST_NETWORK, name: "Visitor Wi-Fi", default: false, enabled: true,
      management: "GATEWAY", vlanId: 30, zoneId: GUEST_ZONE,
      ipv4Configuration: { hostIpAddress: "192.0.2.1", prefixLength: 24 },
    });
    mock.state.clients.push({
      id: CLIENT, name: "Visitor iPad", type: "WIRELESS", macAddress: MAC,
      ipAddress: "192.0.2.46", access: { type: "GUEST", authorized: false },
    });
    mock.state.networkClientIds.set(GUEST_NETWORK, new Set([CLIENT]));
    mock.state.wifiBroadcasts.push({
      id: "77777777-7777-4777-8777-777777777777", enabled: true, type: "STANDARD",
      network: { type: "SPECIFIC", networkId: GUEST_NETWORK }, hotspotConfiguration: { type: "CAPTIVE_PORTAL" },
    });
    await saveUnifiConnection({
      apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL,
      manageAllNetworks: false, managedNetworkIds: [DEV_MOCK_INTERNAL_NETWORK, DEV_MOCK_IOT_NETWORK],
    });
    auth = await signedIn();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.UNIFI_MOCK;
    else process.env.UNIFI_MOCK = previous;
    resetDevMockClientForTests();
  });

  function postPass(body: unknown, signed = auth) {
    return createPass(request("/api/v1/guest-passes", {
      method: "POST", auth: signed, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  }

  function postVoucher(body: unknown, signed = auth) {
    return createVoucher(request("/api/v1/guest-vouchers", {
      method: "POST", auth: signed,
      headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  }

  it("authorizes an eligible visitor and revokes only its matching pass without changing quarantine", async () => {
    const before = await prisma().appPolicy.count();
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 120 });
    expect(created.status).toBe(201);
    const { pass } = (await created.json()) as { pass: { id: string; status: string; expiresAt: string } };
    expect(pass.status).toBe("active");
    expect(new Date(pass.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const list = await listGuests(request("/api/v1/guests", { auth }));
    expect(list.status).toBe(200);
    expect((await list.json()) as { passes: unknown[] }).toMatchObject({ passes: [{ id: pass.id, status: "active" }] });
    const revoked = await revokePass(request(`/api/v1/guest-passes/${pass.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: pass.id }) });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()) as { pass: { status: string } }).toMatchObject({ pass: { status: "revoked" } });
    expect(await prisma().device.count({ where: { mac: MAC } })).toBe(0);
    expect(await prisma().appPolicy.count()).toBe(before);
  });

  it("rejects managed, known, unknown-network, and non-guest clients", async () => {
    const mock = getSharedDevMockClient();
    const candidate = mock.state.clients.find((item) => item.id === CLIENT)!;
    await prisma().household.update({ where: { id: "default" }, data: { unifiManageAllNetworks: true } });
    expect((await postPass({ clientId: CLIENT, timeLimitMinutes: 120 })).status).toBe(409);
    await prisma().household.update({ where: { id: "default" }, data: { unifiManageAllNetworks: false } });
    await prisma().device.create({ data: { mac: MAC, assignment: "assigned", groupId: null } });
    expect((await postPass({ clientId: CLIENT, timeLimitMinutes: 120 })).status).toBe(409);
    await prisma().device.delete({ where: { mac: MAC } });
    mock.state.networkClientIds.set(GUEST_NETWORK, new Set());
    candidate.ipAddress = undefined;
    expect((await postPass({ clientId: CLIENT, timeLimitMinutes: 120 })).status).toBe(409);
    mock.state.networkClientIds.set(GUEST_NETWORK, new Set([CLIENT]));
    candidate.access = { type: "DEFAULT" };
    expect((await postPass({ clientId: CLIENT, timeLimitMinutes: 120 })).status).toBe(409);
    candidate.access = { type: "GUEST" };
    expect((await postPass({ clientId: CLIENT, timeLimitMinutes: 120 })).status).toBe(409);
  });

  it("creates one owned voucher and refuses a site-wide voucher when the portal overlaps managed scope", async () => {
    getSharedDevMockClient().state.vouchers.push({
      id: "88888888-8888-4888-8888-888888888888", code: "9999999999",
      createdAt: new Date().toISOString(), timeLimitMinutes: 60,
      authorizedGuestCount: 0, expired: false,
    });
    const created = await postVoucher({ timeLimitMinutes: 120 });
    expect(created.status).toBe(201);
    const { voucher } = (await created.json()) as { voucher: { id: string; code: string; status: string } };
    expect(voucher.code).toMatch(/^\d{10}$/);
    expect(voucher.status).toBe("unused");
    expect(getSharedDevMockClient().state.vouchers).toHaveLength(2);
    const listing = await listGuests(request("/api/v1/guests", { auth }));
    expect((await listing.json()) as { vouchers: unknown[] }).toMatchObject({ vouchers: [{ id: voucher.id }] });
    const unknown = await revokeVoucher(request("/api/v1/guest-vouchers/unknown", { method: "DELETE", auth }), { params: Promise.resolve({ id: "unknown" }) });
    expect(unknown.status).toBe(404);
    await prisma().household.update({ where: { id: "default" }, data: { unifiManageAllNetworks: true } });
    expect((await postVoucher({ timeLimitMinutes: 120 })).status).toBe(409);
    const revoked = await revokeVoucher(request(`/api/v1/guest-vouchers/${voucher.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: voucher.id }) });
    expect(revoked.status).toBe(200);
    expect(getSharedDevMockClient().state.vouchers.map((item) => item.code)).toEqual(["9999999999"]);
  });

  it("disables site-wide vouchers for a disabled managed hotspot", async () => {
    getSharedDevMockClient().state.wifiBroadcasts.push({
      id: "77777777-7777-4777-8777-777777777778", enabled: false, type: "STANDARD",
      network: { type: "SPECIFIC", networkId: DEV_MOCK_INTERNAL_NETWORK },
      hotspotConfiguration: { type: "CAPTIVE_PORTAL" },
    });
    expect((await postVoucher({ timeLimitMinutes: 60 })).status).toBe(409);
  });

  it("requires a session, CSRF, and valid duration", async () => {
    const anonymous = await createPass(request("/api/v1/guest-passes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT, timeLimitMinutes: 120 }),
    }));
    expect(anonymous.status).toBe(401);
    expect((await postVoucher({ timeLimitMinutes: 0 })).status).toBe(400);
    const noCsrf = await createPass(request("/api/v1/guest-passes", {
      method: "POST", headers: { cookie: auth.cookie, "content-type": "application/json" },
      body: JSON.stringify({ clientId: CLIENT, timeLimitMinutes: 120 }),
    }));
    expect(noCsrf.status).toBe(403);
  });

  it("records an uncertain result instead of claiming an unconfirmed authorization", async () => {
    const mock = getSharedDevMockClient();
    mock.authorizeGuest = async () => { throw new Error("connection lost"); };
    const response = await postPass({ clientId: CLIENT, timeLimitMinutes: 120 });
    expect(response.status).toBe(502);
    const list = await listGuests(request("/api/v1/guests", { auth }));
    expect((await list.json()) as { passes: unknown[] }).toMatchObject({ passes: [{ status: "unknown" }] });
  });

  it("reads authorization detail and marks an elapsed pass expired", async () => {
    const mock = getSharedDevMockClient();
    const originalList = mock.listClients.bind(mock);
    mock.listClients = async (siteId) => (await originalList(siteId)).map((client) => ({
      ...client, access: client.access ? { type: client.access.type, authorized: client.access.authorized } : undefined,
    }));
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 120 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    const active = await listGuests(request("/api/v1/guests", { auth }));
    expect((await active.json()) as { passes: unknown[] }).toMatchObject({ passes: [{ id: pass.id, status: "active" }] });
    await prisma().guestPass.update({ where: { id: pass.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    mock.state.clients.find((client) => client.id === CLIENT)!.access = { type: "GUEST", authorized: false };
    const expired = await listGuests(request("/api/v1/guests", { auth }));
    expect((await expired.json()) as { passes: unknown[] }).toMatchObject({ passes: [{ id: pass.id, status: "expired" }] });
  });

  it("keeps a confirmed live pass active when its stored expiry disagrees", async () => {
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 120 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    await prisma().guestPass.update({ where: { id: pass.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const listing = await listGuests(request("/api/v1/guests", { auth }));
    expect((await listing.json()) as { passes: unknown[] }).toMatchObject({ passes: [{ id: pass.id, status: "active" }] });
  });

  it("serializes simultaneous pass claims for one visitor", async () => {
    const mock = getSharedDevMockClient();
    const originalList = mock.listClients.bind(mock);
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    mock.listClients = async (siteId) => {
      const clients = (await originalList(siteId)).map((client) => ({
        ...client, access: client.access ? { ...client.access } : undefined,
      }));
      reads += 1;
      if (reads === 2) release();
      await bothRead;
      return clients;
    };
    const [a, b] = await Promise.all([
      postPass({ clientId: CLIENT, timeLimitMinutes: 60 }),
      postPass({ clientId: CLIENT, timeLimitMinutes: 60 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await prisma().guestPass.count()).toBe(1);
    expect(getSharedDevMockClient().calls.filter((call) => call.path.endsWith(`/clients/${CLIENT}/actions`) && call.method === "POST")).toHaveLength(1);
  });

  it("reflects live voucher redemption and expiry", async () => {
    const created = await postVoucher({ timeLimitMinutes: 60 });
    expect(created.status).toBe(201);
    const live = getSharedDevMockClient().state.vouchers[0]!;
    live.activatedAt = new Date().toISOString();
    live.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    live.authorizedGuestCount = 1;
    const active = await listGuests(request("/api/v1/guests", { auth }));
    expect((await active.json()) as { vouchers: unknown[] }).toMatchObject({ vouchers: [{ status: "active" }] });
    live.expired = true;
    live.expiresAt = new Date(Date.now() - 60_000).toISOString();
    const expired = await listGuests(request("/api/v1/guests", { auth }));
    expect((await expired.json()) as { vouchers: unknown[] }).toMatchObject({ vouchers: [{ status: "expired" }] });
  });

  it("keeps failed voucher creation and pass revocation visibly uncertain", async () => {
    const mock = getSharedDevMockClient();
    mock.createVoucher = async () => { throw new Error("connection lost"); };
    expect((await postVoucher({ timeLimitMinutes: 60 })).status).toBe(502);
    const voucherList = await listGuests(request("/api/v1/guests", { auth }));
    expect((await voucherList.json()) as { vouchers: unknown[] }).toMatchObject({ vouchers: [{ status: "unknown" }] });

    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 120 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    mock.unauthorizeGuest = async () => { throw new Error("connection lost"); };
    const failed = await revokePass(request(`/api/v1/guest-passes/${pass.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: pass.id }) });
    expect(failed.status).toBe(502);
    const passList = await listGuests(request("/api/v1/guests", { auth }));
    expect((await passList.json()) as { passes: unknown[] }).toMatchObject({ passes: [{ id: pass.id, status: "unknown" }] });
  });

  it("accepts a live guest and captive portal in a custom-named zone", async () => {
    getSharedDevMockClient().state.zones.find((zone) => zone.id === GUEST_ZONE)!.name = "Visitors";
    const pass = await postPass({ clientId: CLIENT, timeLimitMinutes: 60 });
    expect(pass.status).toBe(201);
    const voucher = await postVoucher({ timeLimitMinutes: 60 });
    expect(voucher.status).toBe(201);
  });

  it("shows elapsed access as unknown while live UniFi state is unavailable", async () => {
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 60 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    await prisma().guestPass.update({ where: { id: pass.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    getSharedDevMockClient().listNetworks = async () => { throw new Error("offline"); };
    const listing = await listGuests(request("/api/v1/guests", { auth }));
    expect((await listing.json()) as { status: string; passes: unknown[] }).toMatchObject({
      status: "unavailable", passes: [{ id: pass.id, status: "unknown" }],
    });
  });

  it("revokes an owned voucher when inventory reads are unavailable", async () => {
    const created = await postVoucher({ timeLimitMinutes: 60 });
    const { voucher } = (await created.json()) as { voucher: { id: string } };
    const mock = getSharedDevMockClient();
    mock.listNetworks = async () => { throw new Error("offline"); };
    const revoked = await revokeVoucher(request(`/api/v1/guest-vouchers/${voucher.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: voucher.id }) });
    expect(revoked.status).toBe(200);
  });

  it("does not confirm pass revocation without matching UniFi evidence", async () => {
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 60 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    getSharedDevMockClient().unauthorizeGuest = async () => ({ action: "UNAUTHORIZE_GUEST_ACCESS" });
    const response = await revokePass(request(`/api/v1/guest-passes/${pass.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: pass.id }) });
    expect(response.status).toBe(502);
    expect(await prisma().guestPass.findUniqueOrThrow({ where: { id: pass.id } })).toMatchObject({ status: "uncertain", revokedAt: null });
  });

  it("does not claim revocation when UniFi deletes zero vouchers", async () => {
    const created = await postVoucher({ timeLimitMinutes: 60 });
    const { voucher } = (await created.json()) as { voucher: { id: string } };
    getSharedDevMockClient().deleteVoucher = async () => 0;
    const response = await revokeVoucher(request(`/api/v1/guest-vouchers/${voucher.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: voucher.id }) });
    expect(response.status).toBe(502);
    expect(await prisma().guestVoucher.findUniqueOrThrow({ where: { id: voucher.id } })).toMatchObject({ status: "uncertain" });
  });

  it("serializes duplicate pass revocations", async () => {
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 60 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    const mock = getSharedDevMockClient();
    const original = mock.unauthorizeGuest.bind(mock);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const called = new Promise<void>((resolve) => { entered = resolve; });
    mock.unauthorizeGuest = async (siteId, clientId) => { entered(); await held; return original(siteId, clientId); };
    const first = revokePass(request(`/api/v1/guest-passes/${pass.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: pass.id }) });
    await called;
    const duplicate = await revokePass(request(`/api/v1/guest-passes/${pass.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: pass.id }) });
    expect(duplicate.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(await prisma().guestPass.findUniqueOrThrow({ where: { id: pass.id } })).toMatchObject({ status: "revoked" });
  });

  it("serializes duplicate voucher revocations", async () => {
    const created = await postVoucher({ timeLimitMinutes: 60 });
    const { voucher } = (await created.json()) as { voucher: { id: string } };
    const mock = getSharedDevMockClient();
    const original = mock.deleteVoucher.bind(mock);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const called = new Promise<void>((resolve) => { entered = resolve; });
    mock.deleteVoucher = async (siteId, voucherId) => { entered(); await held; return original(siteId, voucherId); };
    const first = revokeVoucher(request(`/api/v1/guest-vouchers/${voucher.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: voucher.id }) });
    await called;
    const duplicate = await revokeVoucher(request(`/api/v1/guest-vouchers/${voucher.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: voucher.id }) });
    expect(duplicate.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(await prisma().guestVoucher.findUniqueOrThrow({ where: { id: voucher.id } })).toMatchObject({ status: "revoked" });
  });

  it("preserves an active pass when UniFi detail cannot be read before revocation", async () => {
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 60 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    const mock = getSharedDevMockClient();
    mock.getClient = async () => { throw new Error("offline"); };
    const failed = await revokePass(request(`/api/v1/guest-passes/${pass.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: pass.id }) });
    expect(failed.status).toBe(502);
    expect(await prisma().guestPass.findUniqueOrThrow({ where: { id: pass.id } })).toMatchObject({ status: "active" });
  });

  it("does not revoke an offline client whose current network cannot be verified", async () => {
    const created = await postPass({ clientId: CLIENT, timeLimitMinutes: 60 });
    const { pass } = (await created.json()) as { pass: { id: string } };
    const mock = getSharedDevMockClient();
    mock.state.clients = mock.state.clients.filter((client) => client.id !== CLIENT);
    mock.state.networkClientIds.set(GUEST_NETWORK, new Set());
    const response = await revokePass(request(`/api/v1/guest-passes/${pass.id}`, { method: "DELETE", auth }), { params: Promise.resolve({ id: pass.id }) });
    expect(response.status).toBe(502);
    expect(mock.calls.filter((call) => call.method === "POST" && call.path.endsWith(`/clients/${CLIENT}/actions`))).toHaveLength(1);
  });

  it("keeps owned records visible as unknown when the UniFi key is removed", async () => {
    const passResponse = await postPass({ clientId: CLIENT, timeLimitMinutes: 60 });
    const voucherResponse = await postVoucher({ timeLimitMinutes: 60 });
    expect(passResponse.status).toBe(201);
    expect(voucherResponse.status).toBe(201);
    await prisma().household.update({ where: { id: "default" }, data: { unifiKeyLastFour: null } });
    const listing = await listGuests(request("/api/v1/guests", { auth }));
    expect((await listing.json()) as { status: string; passes: unknown[]; vouchers: unknown[] }).toMatchObject({
      status: "unconfigured", passes: [{ status: "unknown" }], vouchers: [{ status: "unknown" }],
    });
  });
});
