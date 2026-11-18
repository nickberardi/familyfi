import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { recordMeProtectionLost, recordNewDevices, recordQuietMePhones, recordSyncOutcome, SYNC_TROUBLE_AFTER_MS } from "@/server/alerts/producers";
import { ME_QUIET_AFTER_MS } from "@/lib/me-protection";
import { registerPush, setAlertChoices } from "@/server/alerts/registrations";
import { updateHouseholdSettings } from "@/server/household";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import type { MockUnifiClient } from "@/server/unifi/mock";
import { configureConnectedHousehold, resetDatabase } from "../helpers/db";
import { pairingAdminAuth, pairPhone } from "../helpers/pairing";
import { fixtureUnifiClient } from "../helpers/unifi-world";

const KINDS = ["device.new", "sync.down", "sync.up", "me.protection", "me.quiet"];

async function registeredPhone(displayName = "iPhone") {
  const phone = await pairPhone(await pairingAdminAuth(), { displayName });
  const id = phone.device.id;
  await registerPush({ deviceId: id }, id, { platform: "ios", channel: "release", token: `token-${id}`, key: randomBytes(32).toString("base64"), format: 1, kinds: KINDS });
  return id;
}

let serial = 0x10;
/** A new client on the fixture's first network, as the gateway would list it. */
function joinNetwork(client: MockUnifiClient, name: string) {
  const template = client.state.clients[0]!;
  const suffix = (serial++).toString(16).padStart(2, "0");
  client.state.clients.push({ ...template, id: `aaaaaaaa-aaaa-4aaa-8aaa-0000000000${suffix}`, macAddress: `02:00:00:00:01:${suffix}`, name });
}

/** As the sender marks an alert the relay took. */
const markSent = () => prisma().alertEvent.updateMany({ where: { sentAt: null }, data: { sentAt: new Date() } });

const events = (kind?: string) => prisma().alertEvent.findMany({ where: kind ? { kind } : {}, orderBy: { createdAt: "asc" } });

describe("alert producers", () => {
  let client: MockUnifiClient;

  beforeEach(async () => {
    await resetDatabase();
    await configureConnectedHousehold();
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: true } });
    client = fixtureUnifiClient();
    setReconcileClientForTests(client);
  });

  afterEach(() => {
    setReconcileClientForTests(undefined);
  });

  it("tells parents once when a child's phone goes quiet, and again only after it is heard from", async () => {
    const phone = await registeredPhone();
    const now = new Date();
    const group = await prisma().group.create({ data: { kind: "family", name: "Cassie" } });
    const quiet = await prisma().pairedDevice.create({
      data: { displayName: "Cassie's iPad", clientType: "me", scope: "me:askOnly", groupId: group.id, lastSeenAt: new Date(now.getTime() - ME_QUIET_AFTER_MS - 60_000) },
    });
    // Heard from within the day, or revoked: not quiet.
    await prisma().pairedDevice.create({ data: { displayName: "Recent", clientType: "me", scope: "me:askOnly", groupId: group.id, lastSeenAt: new Date(now.getTime() - 60_000) } });
    await prisma().pairedDevice.create({ data: { displayName: "Gone", clientType: "me", scope: "me:askOnly", groupId: group.id, lastSeenAt: new Date(0), revokedAt: now } });

    await recordQuietMePhones(now);
    await recordQuietMePhones(now);
    const told = await events("me.quiet");
    expect(told.map((event) => [event.deviceId, event.detail])).toEqual([[phone, { p: "Cassie's iPad", g: group.id, n: "Cassie" }]]);

    // Heard from, then quiet again: told again.
    await prisma().pairedDevice.update({ where: { id: quiet.id }, data: { quietAlertedAt: null } });
    await recordQuietMePhones(now);
    expect(await events("me.quiet")).toHaveLength(2);
  });

  it("marks a quiet phone while the switch is off, so turning it on never tells an old quiet spell", async () => {
    await registeredPhone();
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: false } });
    const quiet = await prisma().pairedDevice.create({ data: { displayName: "Cassie's iPad", clientType: "me", scope: "me:askOnly", lastSeenAt: new Date(0) } });
    await recordQuietMePhones();
    await prisma().household.update({ where: { id: "default" }, data: { alertsRelayEnabled: true } });
    await recordQuietMePhones();
    expect(await events("me.quiet")).toEqual([]);
    expect((await prisma().pairedDevice.findUniqueOrThrow({ where: { id: quiet.id } })).quietAlertedAt).not.toBeNull();
  });

  it("tells parents when a child's phone loses its Screen Time permission", async () => {
    const phone = await registeredPhone();
    await recordMeProtectionLost({ phone: "Cassie's iPad", group: { id: "g-cassie", name: "Cassie" } });
    expect((await events("me.protection")).map((event) => [event.deviceId, event.detail])).toEqual([[phone, { p: "Cassie's iPad", g: "g-cassie", n: "Cassie" }]]);
  });

  it("tells each phone once about the devices a pass found, but not on the household's first pass", async () => {
    const [phone, tablet] = [await registeredPhone(), await registeredPhone("iPad")];
    await runReconcileOnce();
    expect(await prisma().device.count()).toBeGreaterThan(0);
    expect(await events()).toEqual([]);

    joinNetwork(client, "Kids-iPad");
    await runReconcileOnce();
    const one = await events("device.new");
    expect(one.map((event) => event.deviceId).sort()).toEqual([phone, tablet].sort());
    expect(one.map((event) => event.detail)).toEqual([{ n: 1, h: "Kids-iPad" }, { n: 1, h: "Kids-iPad" }]);
    // One event, shared by both phones.
    expect(new Set(one.map((event) => event.dedupeKey)).size).toBe(1);

    joinNetwork(client, "a");
    joinNetwork(client, "b");
    joinNetwork(client, "c");
    await runReconcileOnce();
    expect((await events("device.new")).slice(2).map((event) => event.detail)).toEqual([{ n: 3 }, { n: 3 }]);

    // Nothing new, nothing sent.
    await runReconcileOnce();
    expect(await prisma().alertEvent.count()).toBe(4);
  });

  it("sends at most four new-device alerts an hour to a phone", async () => {
    const phone = await registeredPhone();
    const now = new Date("2026-11-16T12:00:00Z");
    for (let minute = 0; minute < 6; minute += 1) {
      await recordNewDevices([{ hostname: `d${minute}` }], { firstPass: false, now: new Date(now.getTime() + minute * 60_000) });
    }
    expect(await prisma().alertEvent.count({ where: { deviceId: phone } })).toBe(4);
    await recordNewDevices([{ hostname: "later" }], { firstPass: false, now: new Date(now.getTime() + 61 * 60_000) });
    expect(await prisma().alertEvent.count({ where: { deviceId: phone } })).toBe(5);
  });

  it("skips a phone that muted the kind or does not understand it, a revoked phone, and everything while the switch is off", async () => {
    const muted = await registeredPhone();
    await setAlertChoices({ deviceId: muted }, muted, { "device.new": false });
    const older = await pairPhone(await pairingAdminAuth(), { displayName: "Old app" });
    await registerPush({ deviceId: older.device.id }, older.device.id, { platform: "android", channel: "release", token: "t", key: randomBytes(32).toString("base64"), format: 1, kinds: ["sync.down"] });
    const revoked = await registeredPhone("Gone");
    await prisma().pairedDevice.update({ where: { id: revoked }, data: { revokedAt: new Date() } });
    const listening = await registeredPhone("Listening");

    await recordNewDevices([{ hostname: null }], { firstPass: false });
    expect((await events()).map((event) => [event.deviceId, event.detail])).toEqual([[listening, { n: 1 }]]);

    await updateHouseholdSettings({ alertsRelay: false });
    // Turning the switch off drops what was waiting.
    expect(await prisma().alertEvent.count()).toBe(0);
    await recordNewDevices([{ hostname: "x" }], { firstPass: false });
    expect(await prisma().alertEvent.count()).toBe(0);
  });

  it("says sync is in trouble after ten minutes without reaching the gateway, once, and that it is back, once", async () => {
    const phone = await registeredPhone();
    const start = new Date("2026-11-16T12:00:00Z");
    const at = (ms: number) => new Date(start.getTime() + ms);

    await recordSyncOutcome(false, start);
    await recordSyncOutcome(false, at(SYNC_TROUBLE_AFTER_MS - 1));
    expect(await events()).toEqual([]);
    await recordSyncOutcome(false, at(SYNC_TROUBLE_AFTER_MS));
    await recordSyncOutcome(false, at(SYNC_TROUBLE_AFTER_MS + 60_000));
    expect((await events()).map((event) => [event.kind, event.deviceId])).toEqual([["sync.down", phone]]);
    await markSent();

    // A phone that registers mid-outage hears neither.
    const late = await registeredPhone("Late");
    await recordSyncOutcome(true, at(SYNC_TROUBLE_AFTER_MS + 120_000));
    await recordSyncOutcome(true, at(SYNC_TROUBLE_AFTER_MS + 150_000));
    expect((await events()).map((event) => [event.kind, event.deviceId])).toEqual([["sync.down", phone], ["sync.up", phone]]);
    expect(await prisma().alertEvent.count({ where: { deviceId: late } })).toBe(0);
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({ syncFailingSince: null, syncTroubleAlertedAt: null });
  });

  it("tells a phone the trouble alert never reached neither that sync was down nor that it is back", async () => {
    const [reached, missed] = [await registeredPhone(), await registeredPhone("iPad")];
    const start = new Date("2026-11-16T12:00:00Z");
    await recordSyncOutcome(false, start);
    await recordSyncOutcome(false, new Date(start.getTime() + SYNC_TROUBLE_AFTER_MS));
    // The relay took one phone's alert; the other's was still waiting when the gateway came back.
    await prisma().alertEvent.updateMany({ where: { deviceId: reached }, data: { sentAt: new Date() } });
    await recordSyncOutcome(true, new Date(start.getTime() + SYNC_TROUBLE_AFTER_MS + 60_000));
    expect((await events()).map((event) => [event.kind, event.deviceId])).toEqual([["sync.down", reached], ["sync.up", reached]]);
    expect(await prisma().alertEvent.count({ where: { deviceId: missed } })).toBe(0);
  });

  it("never fails a sync pass when an alert cannot be recorded", async () => {
    await registeredPhone();
    await runReconcileOnce();
    joinNetwork(client, "Kids-iPad");
    const createMany = vi.spyOn(prisma().alertEvent, "createMany").mockRejectedValue(new Error("database restarting"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await runReconcileOnce();
      expect(createMany).toHaveBeenCalled();
      expect(await prisma().device.count({ where: { hostname: "Kids-iPad" } })).toBe(1);
      expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).connectionStatus).toBe("ok");
    } finally {
      createMany.mockRestore();
      warn.mockRestore();
    }
  });

  it("leaves an outage unclaimed when its trouble alerts cannot be recorded, so the next pass tells it", async () => {
    const phone = await registeredPhone();
    const start = new Date("2026-11-16T12:00:00Z");
    await recordSyncOutcome(false, start);
    // The claim and its alerts are one transaction: an alert write that fails takes the claim with it.
    const db = prisma();
    const realTransaction = db.$transaction.bind(db) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    const failing = vi.spyOn(db, "$transaction").mockImplementation(((fn: (tx: unknown) => Promise<unknown>) =>
      realTransaction((tx) =>
        fn(new Proxy(tx as object, {
          get: (target, key) => {
            const value = Reflect.get(target, key);
            if (key !== "alertEvent") return value;
            return new Proxy(value as object, { get: (events, name) => (name === "createMany" ? () => Promise.reject(new Error("database restarting")) : Reflect.get(events, name)) });
          },
        })),
      )) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordSyncOutcome(false, new Date(start.getTime() + SYNC_TROUBLE_AFTER_MS));
    } finally {
      failing.mockRestore();
      warn.mockRestore();
    }
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).syncTroubleAlertedAt).toBeNull();
    expect(await events()).toEqual([]);

    await recordSyncOutcome(false, new Date(start.getTime() + SYNC_TROUBLE_AFTER_MS + 60_000));
    expect((await events()).map((event) => [event.kind, event.deviceId])).toEqual([["sync.down", phone]]);
  });

  it("does not say sync is back when it never said it was in trouble", async () => {
    await registeredPhone();
    const start = new Date("2026-11-16T12:00:00Z");
    await recordSyncOutcome(false, start);
    await recordSyncOutcome(true, new Date(start.getTime() + 60_000));
    expect(await events()).toEqual([]);
    expect((await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).syncFailingSince).toBeNull();
  });

  it("records sync trouble from failed passes, and its end from a pass that reaches the gateway", async () => {
    const phone = await registeredPhone();
    await runReconcileOnce();
    const listClients = client.listClients.bind(client);
    client.listClients = async () => {
      throw new Error("gateway unreachable");
    };
    await runReconcileOnce();
    const failing = (await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).syncFailingSince;
    expect(failing).not.toBeNull();
    await prisma().household.update({ where: { id: "default" }, data: { syncFailingSince: new Date(failing!.getTime() - SYNC_TROUBLE_AFTER_MS) } });
    await runReconcileOnce();
    expect((await events()).map((event) => [event.kind, event.deviceId])).toEqual([["sync.down", phone]]);
    await markSent();

    client.listClients = listClients;
    await runReconcileOnce();
    expect((await events()).map((event) => event.kind)).toEqual(["sync.down", "sync.up"]);
  });
});
