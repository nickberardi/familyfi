import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptAlert } from "@/server/alerts/payload";
import { recordNewDevices } from "@/server/alerts/producers";
import { registerPush } from "@/server/alerts/registrations";
import { createAlertSender, GIVE_UP_AFTER_MS } from "@/server/alerts/sender";
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
    expect(send.body).toMatchObject({ installId: "install-1", platform: "ios", channel: "development", token: TOKEN });
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
