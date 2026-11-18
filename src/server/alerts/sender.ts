import type { AlertEvent } from "@prisma/client";
import { ALERT_FORMAT, type AlertEnvelope } from "@/lib/alert-kinds";
import { decryptSecret, encryptSecret } from "../crypto";
import { prisma } from "../db";
import { demoModeEnabled } from "../env";
import { unrefTimer } from "../unref-timer";
import { AlertTooLargeError, encryptAlert } from "./payload";
import { recordSyncBackFor, signedInDevice } from "./producers";
import { currentHouseholdId } from "../household-context";

/**
 * Delivers the alert outbox through the project relay (`push.getfamilyfi.com`), which holds the
 * Apple and Google push credentials a self-hosted server cannot. Each alert is encrypted for its
 * phone before it leaves (payload.ts); the relay sees the push token, the ciphertext, this server's
 * install id and the time.
 *
 * Woken by producers and by a one-minute timer. Never runs in demo mode or while the household's
 * switch is off. A failed send backs off per event and is given up after a day; a token Apple or
 * Google no longer knows (410) drops that phone's registration.
 */

export const DEFAULT_ALERTS_RELAY_URL = "https://push.getfamilyfi.com";
const RETRY_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const BATCH = 50;
const FIRST_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;
/** An alert not delivered within a day is stale; the app shows the same state when opened. */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;
/** Sent rows are kept a week: the hourly new-device cap and "sync is back" read them. */
const KEEP_SENT_MS = 7 * 24 * 60 * 60_000;
/**
 * How long Apple or Google hold an alert for a phone that is off: the same for every kind, so the
 * relay and the push services cannot tell the kinds apart by it.
 */
export const ALERT_TTL_SECONDS = 12 * 3600;

export function alertsRelayUrl(source: Record<string, string | undefined> = process.env): string {
  return (source["FAMILYFI_ALERTS_RELAY_URL"]?.trim() || DEFAULT_ALERTS_RELAY_URL).replace(/\/+$/, "");
}

export type AlertSenderOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  relayUrl?: () => string;
};

export type AlertSender = {
  /** One delivery round now; a call while one runs runs another after it. */
  flush(): Promise<void>;
  /** Asks a started sender to deliver soon. */
  wake(): void;
  start(): void;
};

class RelayStop extends Error {}

function unseal(ciphertext: Uint8Array, iv: Uint8Array, authTag: Uint8Array): string {
  return decryptSecret({ ciphertext: Buffer.from(ciphertext), iv: Buffer.from(iv), authTag: Buffer.from(authTag) });
}

function backoff(attempts: number, retryAfterMs: number | null): number {
  const exponential = Math.min(FIRST_BACKOFF_MS * 2 ** attempts, MAX_BACKOFF_MS);
  return Math.max(exponential, retryAfterMs ?? 0);
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.min(value * 1000, MAX_BACKOFF_MS) : null;
}

export function createAlertSender(options: AlertSenderOptions = {}): AlertSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const relayUrl = options.relayUrl ?? (() => alertsRelayUrl());
  let inFlight: Promise<void> | undefined;
  let again = false;
  let started = false;

  async function post(path: string, body: unknown, secret?: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetchImpl(`${relayUrl()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** This server's id and secret at the relay, asked for once and kept encrypted. */
  async function install(): Promise<{ installId: string; secret: string }> {
    const stored = await prisma().household.findUniqueOrThrow({ where: { id: currentHouseholdId() } });
    if (stored.alertsInstallId && stored.alertsInstallSecretCiphertext && stored.alertsInstallSecretIv && stored.alertsInstallSecretAuthTag) {
      return {
        installId: stored.alertsInstallId,
        secret: unseal(stored.alertsInstallSecretCiphertext, stored.alertsInstallSecretIv, stored.alertsInstallSecretAuthTag),
      };
    }
    const response = await post("/v1/installs", {});
    if (!response.ok) throw new RelayStop(`The push relay refused an install id (HTTP ${response.status}).`);
    const issued = (await response.json()) as { installId?: unknown; secret?: unknown };
    if (typeof issued.installId !== "string" || typeof issued.secret !== "string") throw new RelayStop("The push relay answered without an install id.");
    const sealed = encryptSecret(issued.secret);
    // Kept only if no other process stored one first; then that one is used.
    await prisma().household.updateMany({
      // An install id kept without its secret is replaced too, so this never asks again forever.
      where: { id: currentHouseholdId(), OR: [{ alertsInstallId: null }, { alertsInstallSecretCiphertext: null }, { alertsInstallSecretIv: null }, { alertsInstallSecretAuthTag: null }] },
      data: { alertsInstallId: issued.installId, alertsInstallSecretCiphertext: Uint8Array.from(sealed.ciphertext), alertsInstallSecretIv: Uint8Array.from(sealed.iv), alertsInstallSecretAuthTag: Uint8Array.from(sealed.authTag) },
    });
    return install();
  }

  async function forgetInstall() {
    await prisma().household.update({
      where: { id: currentHouseholdId() },
      data: { alertsInstallId: null, alertsInstallSecretCiphertext: null, alertsInstallSecretIv: null, alertsInstallSecretAuthTag: null },
    });
  }

  async function retryLater(event: AlertEvent, at: Date, retryAfterMs: number | null = null) {
    await prisma().alertEvent.updateMany({
      where: { id: event.id },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(at.getTime() + backoff(event.attempts, retryAfterMs)) },
    });
  }

  async function deliver() {
    if (demoModeEnabled()) return;
    const at = now();
    const household = await prisma().household.findUnique({
      where: { id: currentHouseholdId() },
      select: { alertsRelayEnabled: true, syncTroubleAlertedAt: true },
    });
    const alerted = household?.syncTroubleAlertedAt;
    await prisma().alertEvent.deleteMany({
      where: {
        OR: [
          {
            sentAt: { lt: new Date(at.getTime() - KEEP_SENT_MS) },
            // The trouble alerts of an outage still going on are how its "back" alert finds its phones.
            ...(alerted ? { NOT: { kind: "sync.down", createdAt: { gte: alerted } } } : {}),
          },
          { sentAt: null, createdAt: { lt: new Date(at.getTime() - GIVE_UP_AFTER_MS) } },
        ],
      },
    });
    if (!household?.alertsRelayEnabled) return;
    const due = await prisma().alertEvent.findMany({
      where: { sentAt: null, nextAttemptAt: { lte: at } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH,
    });
    if (!due.length) return;
    let credential: { installId: string; secret: string };
    try {
      credential = await install();
    } catch (error) {
      console.warn("Phone alerts:", error instanceof RelayStop ? error.message : "the push relay could not be reached.");
      for (const event of due) await retryLater(event, at);
      return;
    }
    for (const [index, event] of due.entries()) {
      // Read again just before it goes: the batch can take a while, and in that time the switch may
      // have gone off, the alert been dropped, or the device been signed out, revoked or re-registered.
      const switchOn = await prisma().household.findUnique({ where: { id: currentHouseholdId() }, select: { alertsRelayEnabled: true } });
      if (!switchOn?.alertsRelayEnabled) return;
      const current = await prisma().alertEvent.findFirst({
        where: { id: event.id, sentAt: null },
        select: { device: { select: { pushRegistration: true } } },
      });
      if (!current) continue;
      const registration = current.device.pushRegistration;
      const signedIn = registration && (await prisma().pairedDevice.count({ where: { id: event.deviceId, ...signedInDevice(now()) } }));
      // A phone that registered again since this was queued may no longer take this kind.
      const wanted = registration && registration.supportedKinds.includes(event.kind) && !registration.mutedKinds.includes(event.kind);
      if (!registration || !signedIn || !wanted) {
        await prisma().alertEvent.deleteMany({ where: { id: event.id } });
        continue;
      }
      const envelope: AlertEnvelope = {
        v: Math.min(registration.format, ALERT_FORMAT),
        i: event.dedupeKey,
        t: Math.floor(event.createdAt.getTime() / 1000),
        k: event.kind,
        d: (event.detail ?? {}) as Record<string, unknown>,
      };
      let ciphertext: string;
      try {
        const key = Buffer.from(unseal(registration.keyCiphertext, registration.keyIv, registration.keyAuthTag), "base64url");
        ciphertext = encryptAlert(key, envelope);
      } catch (error) {
        // Too large, or a key this install can no longer read: it can never be sent.
        console.warn("Phone alerts:", error instanceof AlertTooLargeError ? error.message : "an alert key could not be read.");
        await prisma().alertEvent.deleteMany({ where: { id: event.id } });
        continue;
      }
      let response: Response;
      try {
        response = await post("/v1/send", {
          installId: credential.installId,
          platform: registration.platform,
          channel: registration.channel,
          token: unseal(registration.tokenCiphertext, registration.tokenIv, registration.tokenAuthTag),
          ciphertext,
          collapse: event.dedupeKey,
          ttl: ALERT_TTL_SECONDS,
        }, credential.secret);
      } catch {
        await retryLater(event, at);
        continue;
      }
      if (response.ok) {
        const marked = await prisma().alertEvent.updateMany({ where: { id: event.id }, data: { sentAt: now() } });
        // Deleted while it was on its way: a recovering pass dropped it as never sent.
        if (!marked.count && event.kind === "sync.down") await recordSyncBackFor(event.deviceId, now());
      } else if (response.status === 410) {
        // Apple or Google no longer know this token: the phone registers again when it next opens.
        // Only the registration this send used: one the phone made meanwhile has a new token.
        const gone = await prisma().pushRegistration.deleteMany({
          where: { deviceId: event.deviceId, tokenCiphertext: registration.tokenCiphertext, updatedAt: registration.updatedAt },
        });
        await prisma().alertEvent.deleteMany({ where: gone.count ? { deviceId: event.deviceId, sentAt: null } : { id: event.id } });
      } else if (response.status === 401) {
        // The relay no longer knows this install: ask for a new one next round.
        await forgetInstall();
        for (const rest of due.slice(index)) await retryLater(rest, at);
        return;
      } else if (response.status === 429) {
        const wait = retryAfter(response);
        for (const rest of due.slice(index)) await retryLater(rest, at, wait);
        return;
      } else if (response.status >= 400 && response.status < 500) {
        // The relay will never take this one.
        console.warn(`Phone alerts: the push relay refused an alert (HTTP ${response.status}).`);
        await prisma().alertEvent.deleteMany({ where: { id: event.id } });
      } else {
        await retryLater(event, at, retryAfter(response));
      }
    }
  }

  const flush = (): Promise<void> => {
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      do {
        again = false;
        try {
          await deliver();
        } catch (error) {
          console.warn("Phone alerts could not be sent:", error instanceof Error ? error.message : error);
        }
      } while (again);
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  const start = () => {
    if (started || demoModeEnabled()) return;
    started = true;
    const run = () => {
      void flush().finally(() => {
        const timer = setTimeout(run, RETRY_INTERVAL_MS);
        unrefTimer(timer);
      });
    };
    run();
  };

  const wake = () => {
    if (started) void flush();
  };

  return { flush, wake, start };
}

// Next.js bundles instrumentation and route handlers separately: one sender per process.
const processState = globalThis as typeof globalThis & { familyfiAlertSender?: AlertSender };
const alertSender = (processState.familyfiAlertSender ??= createAlertSender());

/** Starts delivery and its one-minute retry loop, once per process; nothing in demo mode. */
export function startAlertSender(): void {
  alertSender.start();
}

/** Asks the sender to deliver what producers just wrote. Does nothing until it is started. */
export function wakeAlertSender(): void {
  alertSender.wake();
}
