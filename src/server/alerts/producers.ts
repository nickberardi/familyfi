import type { Prisma } from "@prisma/client";
import type { AlertKind, NewDeviceData } from "@/lib/alert-kinds";
import { randomToken } from "../crypto";
import { prisma } from "../db";
import { wakeAlertSender } from "./sender";

/**
 * The code that sees a change writes its alerts here, as outbox rows the sender delivers. Alerts are
 * observation only: nothing here reads or writes UniFi. Each producer does nothing while the household's
 * relay switch is off, and never throws into the sync pass that calls it, the same contract as
 * `checkupAfterSync`.
 */

/** At most this many new-device alerts reach one phone an hour; the Unassigned list still shows the rest. */
export const NEW_DEVICE_ALERTS_PER_HOUR = 4;
/** How long sync must have failed, with no pass reaching the gateway, before phones are told. */
export const SYNC_TROUBLE_AFTER_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

/** The phones that take `kind` now: registered, still paired, understanding it and not muting it. */
async function recipients(kind: AlertKind): Promise<string[]> {
  const rows = await prisma().pushRegistration.findMany({
    where: { supportedKinds: { has: kind }, NOT: { mutedKinds: { has: kind } }, device: { revokedAt: null } },
    select: { deviceId: true },
  });
  return rows.map((row) => row.deviceId);
}

async function relayEnabled(): Promise<boolean> {
  const household = await prisma().household.findUnique({ where: { id: "default" }, select: { alertsRelayEnabled: true } });
  return household?.alertsRelayEnabled === true;
}

/** One event for each phone, sharing an id, so a phone that gets it twice shows it once. */
async function writeEvents(kind: AlertKind, deviceIds: string[], detail: Prisma.InputJsonObject, now: Date): Promise<number> {
  if (!deviceIds.length) return 0;
  const dedupeKey = randomToken(6);
  const written = await prisma().alertEvent.createMany({
    data: deviceIds.map((deviceId) => ({ kind, deviceId, detail, dedupeKey, createdAt: now, nextAttemptAt: now })),
    skipDuplicates: true,
  });
  if (written.count) wakeAlertSender();
  return written.count;
}

function warn(error: unknown) {
  console.warn("Phone alert could not be recorded:", error instanceof Error ? error.message : error);
}

/**
 * Devices a sync pass discovered on a managed network: one alert per phone for the whole pass, never
 * on the household's first pass (everything is new then), and at most `NEW_DEVICE_ALERTS_PER_HOUR`
 * an hour for each phone.
 */
export async function recordNewDevices(found: { hostname: string | null }[], options: { firstPass: boolean; now?: Date }): Promise<void> {
  if (!found.length || options.firstPass) return;
  const now = options.now ?? new Date();
  try {
    if (!(await relayEnabled())) return;
    const phones = await recipients("device.new");
    if (!phones.length) return;
    const recent = await prisma().alertEvent.groupBy({
      by: ["deviceId"],
      where: { kind: "device.new", deviceId: { in: phones }, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      _count: { _all: true },
    });
    const capped = new Set(recent.filter((row) => row._count._all >= NEW_DEVICE_ALERTS_PER_HOUR).map((row) => row.deviceId));
    const hostname = found.length === 1 ? found[0].hostname?.trim() : undefined;
    const detail: NewDeviceData = hostname ? { n: 1, h: hostname } : { n: found.length };
    await writeEvents("device.new", phones.filter((phone) => !capped.has(phone)), detail, now);
  } catch (error) {
    warn(error);
  }
}

/**
 * The outcome of a sync pass: `ok` when it reached the gateway (a partial pass did). After
 * `SYNC_TROUBLE_AFTER_MS` with no pass reaching it, phones are told once; the next pass that does
 * tells the same phones once that sync is back.
 */
export async function recordSyncOutcome(ok: boolean, now = new Date()): Promise<void> {
  try {
    const household = await prisma().household.findUnique({
      where: { id: "default" },
      select: { alertsRelayEnabled: true, syncFailingSince: true, syncTroubleAlertedAt: true },
    });
    if (!household) return;
    if (ok) {
      if (!household.syncFailingSince && !household.syncTroubleAlertedAt) return;
      // Cleared only by the pass that finds them set, so two passes cannot both say sync is back.
      const cleared = await prisma().household.updateMany({
        where: { id: "default", syncFailingSince: household.syncFailingSince, syncTroubleAlertedAt: household.syncTroubleAlertedAt },
        data: { syncFailingSince: null, syncTroubleAlertedAt: null },
      });
      if (!cleared.count || !household.syncTroubleAlertedAt || !household.alertsRelayEnabled) return;
      const told = await prisma().alertEvent.findMany({
        where: { kind: "sync.down", createdAt: { gte: household.syncTroubleAlertedAt } },
        select: { deviceId: true },
        distinct: ["deviceId"],
      });
      const phones = new Set(await recipients("sync.up"));
      await writeEvents("sync.up", told.map((row) => row.deviceId).filter((phone) => phones.has(phone)), {}, now);
      return;
    }
    if (!household.syncFailingSince) {
      await prisma().household.updateMany({ where: { id: "default", syncFailingSince: null }, data: { syncFailingSince: now } });
      return;
    }
    if (household.syncTroubleAlertedAt || !household.alertsRelayEnabled) return;
    if (now.getTime() - household.syncFailingSince.getTime() < SYNC_TROUBLE_AFTER_MS) return;
    // Claimed first, so one outage is told once however many passes fail at once.
    const claimed = await prisma().household.updateMany({
      where: { id: "default", syncTroubleAlertedAt: null },
      data: { syncTroubleAlertedAt: now },
    });
    if (!claimed.count) return;
    await writeEvents("sync.down", await recipients("sync.down"), {}, now);
  } catch (error) {
    warn(error);
  }
}
