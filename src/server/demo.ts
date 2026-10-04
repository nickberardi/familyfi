import { ConnectionTransport, ConnectionTrustMode, RouteKind } from "@prisma/client";
import { nextClockOnDays } from "@/lib/clock";
import { assertEndpoint } from "./connection";
import { prisma } from "./db";
import { jsonError } from "./http";
import { demoModeEnabled } from "./env";

/**
 * Demo mode (`FAMILYFI_MODE=demo`, `demoModeEnabled` in `env.ts`): the household's side of the hosted
 * public demo. The database is in memory (`scripts/runtime/memory-database.mjs`), so a restart is the reset.
 */

/** The household-local time the demo restarts, so each day starts from the seed household. */
export const DEMO_RESET_TIME = "03:00";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export function nextDemoResetAt(now: Date, timezone: string): Date {
  // Every day has a 03:00 (DST moves 02:00), so this never misses; a full day out is only a guard.
  return nextClockOnDays(timezone, EVERY_DAY, DEMO_RESET_TIME, now) ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Exits at the next reset time. The container platform restarts the process, and the new one
 * starts on an empty database. Non-zero, so a restart policy of on-failure restarts it too.
 * `exit` is injectable for tests.
 */
export async function startDemoReset(now = new Date(), exit: () => void = () => process.exit(1)): Promise<Date> {
  const { timezone } = await prisma().household.findUniqueOrThrow({ where: { id: "default" }, select: { timezone: true } });
  const at = nextDemoResetAt(now, timezone);
  setTimeout(() => {
    console.log("demo mode: nightly reset; exiting so the platform restarts with a fresh household");
    exit();
  }, at.getTime() - now.getTime());
  return at;
}

export const DEMO_LOCKED = "Settings are locked in the demo. Groups, rules, devices and pairing work as they do at home.";

/**
 * Refuses a configuration write in demo mode, where every visitor shares one household: the gateway,
 * household settings, accounts, resolvers and how phones connect stay as the demo set them.
 */
export function demoLocked(): Response | null {
  return demoModeEnabled() ? jsonError(403, "demo_locked", DEMO_LOCKED) : null;
}

/**
 * Publishes `FAMILYFI_DEMO_URL` (the demo's public HTTPS origin) as the household's remote route, so
 * Pair Device issues phone pairing codes for it as it would at home. The hosted website itself is
 * the connection, a route the host runs in front of the web app like a household's reverse proxy,
 * with the phone's system trust. No tunnel, no Cloudflare Access. Without the setting nothing is published.
 */
export async function ensureDemoRoute(value = process.env.FAMILYFI_DEMO_URL?.trim()): Promise<void> {
  if (!value) return;
  const route = { transport: ConnectionTransport.lan, trustMode: ConnectionTrustMode.system };
  const url = assertEndpoint({ ...route, url: value });
  const endpoint = await prisma().connectionEndpoint.upsert({
    where: { url },
    update: {},
    create: { ...route, url, kind: RouteKind.own },
  });
  await prisma().household.update({ where: { id: "default" }, data: { remoteEndpointId: endpoint.id } });
}
