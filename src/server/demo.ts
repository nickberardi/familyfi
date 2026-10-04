import { ConnectionTransport, ConnectionTrustMode, RouteKind } from "@prisma/client";
import { nextClockOnDays } from "@/lib/clock";
import { assertEndpoint } from "./connection";
import { prisma } from "./db";
import { demoModeEnabled } from "./env";

/**
 * Demo mode (`FAMILYFI_DEMO`, `demoModeEnabled` in `env.ts`): the household's side of the hosted
 * public demo. The database is in memory (`scripts/runtime/demo.mjs`), so a restart is the reset.
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
 * starts on an empty database. `exit` is injectable for tests.
 */
export async function startDemoReset(now = new Date(), exit: () => void = () => process.exit(0)): Promise<Date> {
  const { timezone } = await prisma().household.findUniqueOrThrow({ where: { id: "default" }, select: { timezone: true } });
  const at = nextDemoResetAt(now, timezone);
  setTimeout(() => {
    console.log("demo mode: nightly reset; exiting so the platform restarts with a fresh household");
    exit();
  }, at.getTime() - now.getTime());
  return at;
}

/** Why a visitor cannot change how phones reach the demo: one visitor would cut off the others until the reset. */
export const DEMO_ROUTE_FIXED = "Remote access is fixed in the demo, so every visitor's phone can pair.";

/** The route `ensureDemoRoute` publishes, while demo mode is on. Remote access and route edits leave it alone. */
export function isDemoRoute(endpoint: { url: string }, value = process.env.FAMILYFI_DEMO_URL?.trim()): boolean {
  if (!demoModeEnabled() || !value) return false;
  return URL.canParse(value) && new URL(value).origin === endpoint.url;
}

/**
 * Publishes `FAMILYFI_DEMO_URL` (the demo's public HTTPS origin) as the household's remote route, so
 * Pair Device issues phone pairing codes for it as it would at home. It is a route the host runs,
 * in front of the web app like a household's reverse proxy, with the phone's system trust and no
 * Cloudflare Access. Without the setting nothing is published.
 */
export async function ensureDemoRoute(value = process.env.FAMILYFI_DEMO_URL?.trim()): Promise<void> {
  if (!value) return;
  const route = { transport: ConnectionTransport.cloudflare, trustMode: ConnectionTrustMode.system };
  const url = assertEndpoint({ ...route, url: value });
  const endpoint = await prisma().connectionEndpoint.upsert({
    where: { url },
    update: {},
    create: { ...route, url, kind: RouteKind.own },
  });
  await prisma().household.update({ where: { id: "default" }, data: { remoteEndpointId: endpoint.id } });
}
