/**
 * The console's own load, and FamilyFi's share of it. `GET /health?gateway=true` asks the
 * console only when called, and only for a session; the plain `/health` never asks it; the routes every open page polls must not ask it at all once a
 * reconcile pass has read what they show.
 */
import { DeviceScope, PairedDeviceClient, SessionKind } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getHousehold } from "@/app/api/v1/settings/household/route";
import { GET as getHealth } from "@/app/api/v1/health/route";
import { GET as getUnifi } from "@/app/api/v1/settings/unifi/route";
import { createSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { runReconcileOnce } from "@/server/reconciliation";
import { saveManagedNetworks, saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_API_KEY, DEV_MOCK_BASE_URL, getSharedDevMockClient, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { forgetSiteNetworks } from "@/server/unifi/network-cache";
import type { GatewayHealth, UnifiSettings } from "@/lib/types";
import { resetDatabase } from "../helpers/db";
import { pairingAdmin } from "../helpers/pairing";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const GATEWAY_ID = "77777777-7777-4777-8777-777777777770";

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

async function health(auth: SessionAuth): Promise<GatewayHealth> {
  const response = await getHealth(request("/api/v1/health?gateway=true", { auth }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { status: string; gateway: GatewayHealth };
  expect(body.status).toBe("ok");
  return body.gateway;
}

describe("gateway health and the console's polled load", () => {
  const previous = process.env.FAMILYFI_MODE;
  let auth: SessionAuth;

  beforeEach(async () => {
    process.env.FAMILYFI_MODE = "dev";
    resetDevMockClientForTests();
    await resetDatabase();
    auth = await signedIn();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previous;
    resetDevMockClientForTests();
  });

  it("keeps the plain readiness check public, and never asks the console for it", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    const client = getSharedDevMockClient();
    const before = client.calls.length;
    const response = await getHealth(request("/api/v1/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("gateway");
    expect(client.calls.slice(before)).toEqual([]);
  });

  it("gives the gateway's readings only to a session, and to no Watch or agent", async () => {
    expect((await getHealth(request("/api/v1/health?gateway=true"))).status).toBe(401);
    // No device acts as the recovery admin, so these act as a personal administrator.
    const account = await pairingAdmin();
    for (const [client, scope] of [
      [PairedDeviceClient.watch, DeviceScope.rulesOnly],
      [PairedDeviceClient.agent, DeviceScope.full],
      [PairedDeviceClient.agent, DeviceScope.readOnly],
    ] as const) {
      const device = await prisma().pairedDevice.create({ data: { displayName: `${client} ${scope}`, client, scope, accountId: client === PairedDeviceClient.agent ? account.id : null } });
      const issued = await createSession({ accountId: account.id, username: account.username, kind: SessionKind.bearer, deviceId: device.id });
      const response = await getHealth(request("/api/v1/health?gateway=true", { auth: { cookie: "", csrf: "", token: issued.raw } }));
      expect(response.status, `${client}:${scope}`).toBe(403);
    }
  });

  it("asks for a console first when none is connected", async () => {
    const result = await health(auth);
    expect(result.devices).toBeNull();
    expect(result.devicesError).toMatch(/Connect a UniFi console/);
    expect(result.requests.windowSec).toBe(300);
  });

  it("reads each device's latest load, gateway first, and marks a device that would not report", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    // An offline or adopting device has no current statistics: the console answers 404 for it.
    const client = getSharedDevMockClient();
    client.state.deviceStatistics.delete("77777777-7777-4777-8777-777777777771");
    const result = await health(auth);
    expect(result.devicesError).toBeNull();
    expect(result.devices?.[0]).toMatchObject({
      id: GATEWAY_ID,
      name: "Dream Machine",
      gateway: true,
      reported: true,
      cpuUtilizationPct: 18.4,
      memoryUtilizationPct: 61.2,
      loadAverage1Min: 0.62,
      uptimeSec: 1_209_600,
    });
    expect(result.devices?.slice(1).map((device) => [device.name, device.reported, device.cpuUtilizationPct])).toEqual([
      ["Living Room AP", true, 5.2],
      // Listed, unreported, every reading unknown rather than zero.
      ["Upstairs AP", false, null],
    ]);
    expect(result.devices?.[2]).toMatchObject({ gateway: false, uptimeSec: null, loadAverage1Min: null });
  });

  it("says why when the console cannot be asked", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    getSharedDevMockClient().listSiteDevices = async () => {
      throw new Error("UniFi GET /v1/sites/site/devices failed: connect ECONNREFUSED");
    };
    const result = await health(auth);
    expect(result.devices).toBeNull();
    expect(result.devicesError).toMatch(/ECONNREFUSED/);
  });

  it("serves the polled settings without asking the console after a reconcile pass", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    const client = getSharedDevMockClient();
    const beforePass = client.calls.length;
    await runReconcileOnce();
    // A pass has no use for the console's version.
    expect(client.calls.slice(beforePass).some((call) => call.path === "/v1/info")).toBe(false);

    const before = client.calls.length;
    const unifi = await getUnifi(request("/api/v1/settings/unifi", { auth }));
    const household = await getHousehold(request("/api/v1/settings/household", { auth }));
    expect(unifi.status).toBe(200);
    expect(household.status).toBe(200);
    expect(((await unifi.json()) as { unifi: UnifiSettings }).unifi.networks.length).toBeGreaterThan(0);
    expect(client.calls.slice(before)).toEqual([]);
  });

  it("reads the networks from the console itself when no recent pass has", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    forgetSiteNetworks();
    const client = getSharedDevMockClient();
    const before = client.calls.length;
    const first = await getUnifi(request("/api/v1/settings/unifi", { auth }));
    expect(((await first.json()) as { unifi: UnifiSettings }).unifi.networks.length).toBeGreaterThan(0);
    const asked = client.calls.length - before;
    expect(asked).toBeGreaterThan(0);
    // The answer is kept for the next page refresh.
    await getUnifi(request("/api/v1/settings/unifi", { auth }));
    expect(client.calls.length - before).toBe(asked);
  });

  it("checks a network choice against the console itself, not the last pass's list", async () => {
    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    await runReconcileOnce();
    const client = getSharedDevMockClient();
    const before = client.calls.length;
    await saveManagedNetworks({ manageAllNetworks: true });
    expect(client.calls.slice(before).some((call) => call.path.endsWith("/networks"))).toBe(true);
  });
});
