import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptAlert } from "@/server/alerts/payload";
import { recordNewDevices, recordSyncOutcome, SYNC_TROUBLE_AFTER_MS } from "@/server/alerts/producers";
import { registerPush } from "@/server/alerts/registrations";
import { ALERT_TTL_SECONDS, createAlertSender, GIVE_UP_AFTER_MS } from "@/server/alerts/sender";
import { prisma } from "@/server/db";
import { resetDatabase } from "../helpers/db";
import { pairingAdminAuth, pairPhone } from "../helpers/pairing";

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** A stand-in relay: answers installs with a fixed credential and each send with the next queued status. */
function fakeRelay() {
  const sent: Sent[] = [];
  const statuses: number[] = [];
  let installs = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const record = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    if (url.endsWith("/v1/installs")) {
      installs += 1;
      return Response.json({ installId: `install-${installs}`, secret: `secret-${installs}` });
    }
    sent.push(record);
    const status = statuses.shift() ?? 202;
    return new Response(status === 202 ? null : "{}", { status, headers: status === 429 ? { "retry-after": "120" } : {} });
  }) as typeof fetch;
  return { fetchImpl, sent, statuses, installs: () => installs };
}

const KEY = randomBytes(32);
const TOKEN = "push-token-abc";

async function registeredPhone() {
  const phone = await pairPhone(await pairingAdminAuth());
  const id = phone.device.id;
  await registerPush({ deviceId: id }, id, { platform: "ios", channel: "development", token: TOKEN, key: KEY.toString("base64"), format: 1, kinds: ["device.new", "sync.down", "sync.up"] });
  return id;
}

describe("alert sender", () => {
  const previousMode = process.env.FAMILYFI_MODE;
  let now: Date;
  let relay: ReturnType<typeof fakeRelay>;
  let sender: ReturnType<typeof createAlertSender>;

  beforeEach(async () => {
    await resetDatabase();
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: true } });
    now = new Date();
    relay = fakeRelay();
    sender = createAlertSender({ fetchImpl: relay.fetchImpl, now: () => now, relayUrl: () => "https://relay.test" });
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previousMode;
  });

  it("sends each alert encrypted for its phone, with no household detail in clear", async () => {
    const phone = await registeredPhone();
    await prisma().device.create({ data: { mac: "02:00:00:00:09:01", hostname: "Kids-iPad", ip: "192.0.2.44" } });
    await recordNewDevices([{ hostname: "Kids-iPad" }], { firstPass: false, now });
    await sender.flush();

    expect(relay.installs()).toBe(1);
    expect(relay.sent).toHaveLength(1);
    const [send] = relay.sent;
    expect(send.url).toBe("https://relay.test/v1/send");
    expect(send.headers.authorization).toBe("Bearer secret-1");
    expect(Object.keys(send.body).sort()).toEqual(["channel", "ciphertext", "collapse", "installId", "platform", "token", "ttl"]);
    expect(send.body).toMatchObject({ installId: "install-1", platform: "ios", channel: "development", token: TOKEN, ttl: ALERT_TTL_SECONDS });
    const clear = JSON.stringify({ ...send.body, ciphertext: undefined });
    for (const detail of ["Kids-iPad", "02:00:00:00:09:01", "192.0.2.44", "device.new"]) expect(clear).not.toContain(detail);

    const envelope = decryptAlert(KEY, String(send.body.ciphertext));
    expect(envelope).toMatchObject({ v: 1, k: "device.new", d: { n: 1, h: "Kids-iPad" } });
    expect(envelope.i).toBe(send.body.collapse);
    const event = await prisma().alertEvent.findFirstOrThrow({ where: { deviceId: phone } });
    expect(event.sentAt).not.toBeNull();

    // Sent once; the install is asked for once.
    await sender.flush();
    expect(relay.sent).toHaveLength(1);
    await recordNewDevices([{ hostname: "Other" }], { firstPass: false, now });
    await sender.flush();
    expect(relay.sent).toHaveLength(2);
    expect(relay.installs()).toBe(1);
    const stored = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(stored.alertsInstallId).toBe("install-1");
    expect(Buffer.from(stored.alertsInstallSecretCiphertext!).toString("latin1")).not.toContain("secret-1");
  });

  it("backs off on 429 and 5xx, and gives up after a day", async () => {
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    relay.statuses.push(503);
    await sender.flush();
    let event = await prisma().alertEvent.findFirstOrThrow();
    expect(event).toMatchObject({ sentAt: null, attempts: 1 });
    expect(event.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

    // Not due yet: nothing is sent.
    await sender.flush();
    expect(relay.sent).toHaveLength(1);

    now = new Date(event.nextAttemptAt.getTime());
    relay.statuses.push(429);
    await sender.flush();
    event = await prisma().alertEvent.findFirstOrThrow();
    expect(event.attempts).toBe(2);
    expect(event.nextAttemptAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(120_000);

    now = new Date(event.createdAt.getTime() + GIVE_UP_AFTER_MS + 1);
    await sender.flush();
    expect(await prisma().alertEvent.count()).toBe(0);
    expect(relay.sent).toHaveLength(2);
  });

  it("drops the registration when Apple or Google say the token is gone", async () => {
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    relay.statuses.push(410);
    await sender.flush();
    expect(await prisma().pushRegistration.count()).toBe(0);
    expect(await prisma().alertEvent.count()).toBe(0);
  });

  it("keeps a registration the phone replaced while its old token was being refused", async () => {
    const id = await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    const replacing = createAlertSender({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/v1/send")) {
          // The phone registers a new token while the old one's send is on its way.
          await registerPush({ deviceId: id }, id, { platform: "ios", channel: "development", token: "push-token-new", key: KEY.toString("base64"), format: 1, kinds: ["device.new", "sync.down", "sync.up"] });
          await recordNewDevices([{ hostname: "tablet" }], { firstPass: false, now });
          relay.statuses.push(410);
        }
        return relay.fetchImpl(input, init);
      }) as typeof fetch,
      now: () => now,
      relayUrl: () => "https://relay.test",
    });
    await replacing.flush();
    expect(await prisma().pushRegistration.count({ where: { deviceId: id } })).toBe(1);
    expect(await prisma().alertEvent.count({ where: { deviceId: id, sentAt: null } })).toBe(1);
  });

  it("drops a queued alert of a kind the phone no longer takes", async () => {
    const id = await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    await registerPush({ deviceId: id }, id, { platform: "ios", channel: "development", token: TOKEN, key: KEY.toString("base64"), format: 1, kinds: ["sync.down", "sync.up"] });
    await sender.flush();
    expect(relay.sent).toHaveLength(0);
    expect(await prisma().alertEvent.count()).toBe(0);
  });

  it("asks for a new install when the relay no longer knows this one", async () => {
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    relay.statuses.push(401);
    await sender.flush();
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).alertsInstallId).toBeNull();
    now = new Date((await prisma().alertEvent.findFirstOrThrow()).nextAttemptAt.getTime());
    await sender.flush();
    expect(relay.installs()).toBe(2);
    expect(relay.sent.at(-1)?.headers.authorization).toBe("Bearer secret-2");
    expect(await prisma().alertEvent.count({ where: { sentAt: { not: null } } })).toBe(1);
  });

  it("drops an alert the relay will never take", async () => {
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    relay.statuses.push(400);
    await sender.flush();
    expect(await prisma().alertEvent.count()).toBe(0);
    expect(await prisma().pushRegistration.count()).toBe(1);
  });

  it("retries when the relay cannot be reached, and never throws", async () => {
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    const failing = createAlertSender({
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      now: () => now,
      relayUrl: () => "https://relay.test",
    });
    await expect(failing.flush()).resolves.toBeUndefined();
    expect(await prisma().alertEvent.findFirstOrThrow()).toMatchObject({ sentAt: null, attempts: 1 });
  });

  it("says sync is back to a phone whose trouble alert reached the relay while the outage was being cleared", async () => {
    const phone = await registeredPhone();
    await recordSyncOutcome(false, now);
    now = new Date(now.getTime() + SYNC_TROUBLE_AFTER_MS);
    await recordSyncOutcome(false, now);
    // The pass that reaches the gateway clears the outage while the relay is taking the trouble alert.
    const racing = createAlertSender({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/v1/send")) await recordSyncOutcome(true, now);
        return relay.fetchImpl(input, init);
      }) as typeof fetch,
      now: () => now,
      relayUrl: () => "https://relay.test",
    });
    await racing.flush();
    expect((await prisma().alertEvent.findMany()).map((event) => [event.kind, event.deviceId, event.sentAt === null])).toEqual([["sync.up", phone, true]]);
  });

  it("sends nothing to a phone whose sign-in has ended, though it was never revoked", async () => {
    const phone = await registeredPhone();
    await recordNewDevices([{ hostname: "Kids-iPad" }], { firstPass: false, now });
    // A password change or sign-out ends every session and leaves the device paired.
    await prisma().session.updateMany({ where: { deviceId: phone }, data: { revokedAt: now } });
    await sender.flush();
    expect(relay.sent).toHaveLength(0);
    expect(await prisma().alertEvent.count()).toBe(0);
    await recordNewDevices([{ hostname: "Other" }], { firstPass: false, now });
    expect(await prisma().alertEvent.count()).toBe(0);
  });

  it("asks once more for an install when an id was kept without its secret", async () => {
    await registeredPhone();
    await prisma().household.update({ where: { id: "default" }, data: { alertsInstallId: "half-install" } });
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    await sender.flush();
    expect(relay.installs()).toBe(1);
    expect(relay.sent).toHaveLength(1);
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).alertsInstallId).toBe("install-1");
  });

  it("gives every kind the same lifetime, so nothing in clear says which kind an alert is", async () => {
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    await recordSyncOutcome(false, now);
    now = new Date(now.getTime() + SYNC_TROUBLE_AFTER_MS);
    await recordSyncOutcome(false, now);
    await sender.flush();
    now = new Date(now.getTime() + 60_000);
    await recordSyncOutcome(true, now);
    await sender.flush();
    expect((await prisma().alertEvent.findMany({ orderBy: { createdAt: "asc" } })).map((event) => event.kind)).toEqual(["device.new", "sync.down", "sync.up"]);
    expect(relay.sent.map((send) => send.body.ttl)).toEqual([ALERT_TTL_SECONDS, ALERT_TTL_SECONDS, ALERT_TTL_SECONDS]);
  });

  it("checks each alert again just before it goes, so one dropped mid-batch is never sent", async () => {
    await registeredPhone();
    await registeredPhone();
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    // While the first alert is on its way, the phone whose alert goes last signs out.
    const order = await prisma().alertEvent.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const last = order.at(-1)!.deviceId;
    let sends = 0;
    const midBatch = createAlertSender({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/v1/send")) {
          sends += 1;
          if (sends === 1) await prisma().session.updateMany({ where: { deviceId: last }, data: { revokedAt: now } });
        }
        return relay.fetchImpl(input, init);
      }) as typeof fetch,
      now: () => now,
      relayUrl: () => "https://relay.test",
    });
    await midBatch.flush();
    // The other two went; the signed-out phone's was dropped unsent.
    expect(sends).toBe(2);
    expect(await prisma().alertEvent.count({ where: { deviceId: last } })).toBe(0);
    expect(await prisma().alertEvent.count({ where: { sentAt: { not: null } } })).toBe(2);
  });

  it("stops a batch when the switch goes off before the next alert", async () => {
    await registeredPhone();
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    let sends = 0;
    const midBatch = createAlertSender({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/v1/send")) {
          sends += 1;
          await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: false } });
        }
        return relay.fetchImpl(input, init);
      }) as typeof fetch,
      now: () => now,
      relayUrl: () => "https://relay.test",
    });
    await midBatch.flush();
    expect(sends).toBe(1);
    expect(await prisma().alertEvent.count({ where: { sentAt: null } })).toBe(1);
  });

  it("keeps an outage's delivered trouble alerts past a week, so its end is still told", async () => {
    const phone = await registeredPhone();
    await recordSyncOutcome(false, now);
    now = new Date(now.getTime() + SYNC_TROUBLE_AFTER_MS);
    await recordSyncOutcome(false, now);
    await sender.flush();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    await sender.flush();
    // Eight days on, the gateway is still out of reach: the new-device alert goes, the trouble alert stays.
    now = new Date(now.getTime() + 8 * 24 * 3600_000);
    await sender.flush();
    expect((await prisma().alertEvent.findMany()).map((event) => event.kind)).toEqual(["sync.down"]);
    await recordSyncOutcome(true, now);
    await sender.flush();
    expect((await prisma().alertEvent.findMany({ where: { kind: "sync.up" } })).map((event) => [event.deviceId, event.sentAt !== null])).toEqual([[phone, true]]);
  });

  it("sends nothing while the switch is off or in demo mode", async () => {
    await registeredPhone();
    await recordNewDevices([{ hostname: null }], { firstPass: false, now });
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: false } });
    await sender.flush();
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: true } });
    process.env.FAMILYFI_MODE = "demo";
    await sender.flush();
    expect(relay.sent).toHaveLength(0);
    expect(relay.installs()).toBe(0);
  });
});
