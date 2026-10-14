/**
 * Counts the requests FamilyFi sends the UniFi console, so an operator can see how hard
 * FamilyFi works the gateway: Settings shows the last few minutes, and the server logs a
 * summary every few minutes while there is traffic.
 */

import type { GatewayHealth, UnifiEndpointLoad } from "@/lib/types";
import { unrefTimer } from "../unref-timer";

export const REQUEST_WINDOW_MS = 5 * 60_000;
/** A ceiling on memory if something loops: far above the hundreds a normal window holds. */
const MAX_SAMPLES = 20_000;

type Sample = { at: number; endpoint: string; ms: number; ok: boolean };

export type UnifiRequestLoad = GatewayHealth["requests"];

type Meter = { samples: Sample[]; logTimer: ReturnType<typeof setInterval> | null };

// Next.js bundles instrumentation (reconcile) and route handlers separately; both count here.
const meter: Meter = ((globalThis as { familyfiUnifiRequestMeter?: Meter }).familyfiUnifiRequestMeter ??= {
  samples: [],
  logTimer: null,
});

const ID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{24}$/i;

/** `GET /v1/sites/{id}/clients`: one endpoint whatever the ids and query. */
export function endpointTemplate(method: string, path: string): string {
  const bare = path.split("?")[0] ?? path;
  const segments = bare.split("/").map((segment) => (ID_SEGMENT.test(segment) ? "{id}" : segment));
  return `${method.toUpperCase()} ${segments.join("/")}`;
}

function prune(now: number) {
  const cutoff = now - REQUEST_WINDOW_MS;
  let drop = 0;
  while (drop < meter.samples.length && meter.samples[drop]!.at < cutoff) drop += 1;
  if (meter.samples.length - drop > MAX_SAMPLES) drop = meter.samples.length - MAX_SAMPLES;
  if (drop > 0) meter.samples.splice(0, drop);
}

export function recordUnifiRequest(method: string, path: string, ms: number, ok: boolean, now = Date.now()) {
  meter.samples.push({ at: now, endpoint: endpointTemplate(method, path), ms, ok });
  prune(now);
}

export function unifiRequestLoad(now = Date.now()): UnifiRequestLoad {
  prune(now);
  const byEndpoint = new Map<string, UnifiEndpointLoad & { totalMs: number }>();
  for (const sample of meter.samples) {
    const entry = byEndpoint.get(sample.endpoint) ?? {
      endpoint: sample.endpoint,
      count: 0,
      errors: 0,
      averageMs: 0,
      maxMs: 0,
      totalMs: 0,
    };
    entry.count += 1;
    if (!sample.ok) entry.errors += 1;
    entry.totalMs += sample.ms;
    entry.maxMs = Math.max(entry.maxMs, Math.round(sample.ms));
    byEndpoint.set(sample.endpoint, entry);
  }
  const endpoints = [...byEndpoint.values()]
    .map(({ totalMs, ...entry }) => ({ ...entry, averageMs: Math.round(totalMs / entry.count) }))
    .sort((a, b) => b.count - a.count || a.endpoint.localeCompare(b.endpoint));
  return {
    windowSec: REQUEST_WINDOW_MS / 1000,
    total: meter.samples.length,
    errors: endpoints.reduce((sum, entry) => sum + entry.errors, 0),
    endpoints,
  };
}

/** One log line for the window, or null when FamilyFi sent the console nothing. */
export function unifiRequestSummary(load: UnifiRequestLoad): string | null {
  if (load.total === 0) return null;
  const perMinute = (load.total / (load.windowSec / 60)).toFixed(1);
  const busiest = load.endpoints
    .slice(0, 6)
    .map((entry) => `${entry.endpoint} ×${entry.count} avg ${entry.averageMs}ms`)
    .join("; ");
  return `UniFi requests, last ${load.windowSec / 60} min: ${load.total} (${perMinute}/min, ${load.errors} failed). ${busiest}`;
}

export function startUnifiRequestLog() {
  if (meter.logTimer) return;
  meter.logTimer = setInterval(() => {
    const line = unifiRequestSummary(unifiRequestLoad());
    if (line) console.log(line);
  }, REQUEST_WINDOW_MS);
  unrefTimer(meter.logTimer);
}

export function resetUnifiRequestMeterForTests() {
  meter.samples.length = 0;
}
