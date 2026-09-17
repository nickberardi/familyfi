import { prisma } from "../db";
import { probeEnabledCategories } from "./probe";
import { ResolverConfigError } from "./resolver-settings";

/**
 * Interval-driven, mirroring `startReconciliation()`. Deliberately not a cron
 * expression: the existing loop is interval-based and honouring a 5-field expression
 * would mean adding a parser for no behaviour this feature needs.
 */
const MIN_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

async function sweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const household = await prisma().household.findUnique({
      where: { id: "default" },
      select: { dohProbeEnabled: true },
    });
    if (!household?.dohProbeEnabled) return;
    await probeEnabledCategories();
  } catch (error) {
    // A sweep failure is already recorded per category as an unknown verdict; never
    // let it take the process down.
    if (!(error instanceof ResolverConfigError)) {
      console.error("upstream probe sweep failed", error);
    }
  } finally {
    running = false;
  }
}

export function startUpstreamProbe(): void {
  if (timer) return;
  void sweep();
  // Read once at boot; a changed interval takes effect on the next restart, as with
  // the reconciliation loop.
  void prisma()
    .household.findUnique({ where: { id: "default" }, select: { dohProbeIntervalMinutes: true } })
    .then((household) => {
      const minutes = household?.dohProbeIntervalMinutes ?? 1440;
      const intervalMs = Math.max(MIN_INTERVAL_MS, minutes * 60_000);
      timer = setInterval(() => void sweep(), intervalMs);
      timer.unref?.();
    })
    .catch(() => {
      // Database may not be up yet; the next boot starts the loop.
    });
}

export function stopUpstreamProbeForTests(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  running = false;
}
