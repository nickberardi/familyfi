/**
 * What a phone's setup says, step by step, in the web's own names for where a code comes from
 * (Pair Device → Pair a phone), and the household details a person checks before trusting it. Each client lays the steps out natively.
 */
import type { PendingEnrollment } from "./companion-pairing";
import { shortPin } from "./connection-routes";

/** The three steps the setup header's progress shows, in order. Trusting the household signs the phone in. */
export const SETUP_PROGRESS = ["welcome", "code", "confirm"] as const;
export type SetupProgressStep = (typeof SETUP_PROGRESS)[number];

export const SETUP_STEPS = {
  welcome: {
    title: "Connect to FamilyFi",
    body: "FamilyFi already runs on the Pi in your house. This phone is a control surface for it — nothing moves off the household.",
  },
  scan: {
    title: "Scan the pairing code",
    body: "On a computer at home, open FamilyFi → Pair Device → Pair a phone. The code is single-use and expires in five minutes.",
  },
  paste: {
    title: "Paste the pairing code",
    body: "In FamilyFi on the web, open Pair a phone, copy the pairing code, and paste it here. It is single-use and expires in five minutes.",
  },
  confirm: {
    title: "Is this your household?",
    body: "Check the household details before trusting this server. Your one-time key is not used until you confirm; trusting it signs this phone in.",
  },
} as const;

/** The setup steps' actions. */
export const SETUP_ACTIONS = {
  scan: "Scan pairing code",
  paste: "Paste pairing code",
  pasteInstead: "Paste the code instead",
  pair: "Pair this phone",
  pasteFromClipboard: "Paste",
  back: "Back",
  scanAgain: "Scan again",
  openSettings: "Open Settings",
  trust: "Trust this instance",
  reject: "Not my household — start over",
  reveal: "Reveal",
  hide: "Hide",
} as const;

export const SCAN_NOTE =
  "The code carries a short-lived pairing key and the server identity. It never carries a UniFi API key or an administrator password.";
export const PAIRING_CODE_LABEL = "Pairing code";
export const SCAN_VERIFYING = "Code found — verifying the instance…";
export const CAMERA_OFF = "Camera access is off for FamilyFi. Allow it in Settings, or paste the code instead.";
export const SCAN_UNAVAILABLE = "Camera scanning isn't available on this device";

export type PendingRow = { label: string; value: string; mono: boolean; secret?: boolean };

/**
 * The details of a verified household, to check before trusting it, in two groups:
 * what the pairing code said (the one-time key hidden until revealed) and what the household proved.
 */
export function pendingHouseholdSections({ code, identity }: PendingEnrollment): { title: string; rows: PendingRow[] }[] {
  const { endpoint } = code;
  return [
    {
      title: "Found in pairing code",
      rows: [
        { label: "Server address", value: endpoint.url, mono: true },
        { label: "One-time pairing key", value: `${code.pairingId}.${code.token}`, mono: true, secret: true },
      ],
    },
    {
      title: "Verified household",
      rows: [
        { label: "Household", value: identity.householdName, mono: false },
        { label: "Instance", value: identity.instanceId, mono: true },
        { label: "Key fingerprint", value: identity.keyFingerprint, mono: true },
        ...(endpoint.trustMode === "pinned" && endpoint.spkiSha256 ? [{ label: "Certificate", value: endpoint.spkiSha256, mono: true }] : []),
      ],
    },
  ];
}

/** A hidden one-time key, until the person reveals it. */
export const HIDDEN_KEY = "••••••••••••";

/** What trusting the household means: pinning its own certificate, or ordinary HTTPS. */
export function trustExplanation({ code }: PendingEnrollment): string {
  return code.endpoint.trustMode === "pinned"
    ? "FamilyFi issues its own certificate. Trusting it pins this fingerprint — if it changes later, the app stops and asks you, rather than trusting anything that answers the address."
    : "This route uses ordinary HTTPS validation. The fingerprint above identifies the household itself, not the certificate.";
}

/** What matched: the identity and the pinned certificate, or the identity and the system's HTTPS check. */
export function pendingHouseholdNote({ code }: PendingEnrollment): string {
  return code.endpoint.trustMode === "pinned"
    ? "The server identity and certificate matched the pairing code."
    : "The server identity matched the pairing code, and its certificate passed HTTPS validation.";
}

/**
 * A paired phone's Connection screen: the household it trusts, who it is signed in as, its routes,
 * and unpairing it. Pairing is the sign-in, so unpairing replaces signing out and forgetting.
 */
export const CONNECTION_COPY = {
  title: "Connection",
  routes: "Routes",
  inUse: "In use",
  off: "Off",
  check: "Check routes again",
  checking: "Checking routes…",
  unpair: "Unpair this phone",
  unpairTitle: "Unpair this phone?",
  unpairBody:
    "This phone stops working with this household, and so do the Watches it set up. To use FamilyFi again, pair with a new code from FamilyFi on the web.",
  unpairConfirm: "Unpair",
  cancel: "Cancel",
} as const;

/** The trusted household's line: its signing key. */
export function connectionHousehold(keyFingerprint: string): string {
  return `Signing key ${shortPin(keyFingerprint)}`;
}

/** Who the phone acts as: the adult the pairing code was made for. */
export function connectionSignedInAs(displayName: string): string {
  return `Signed in as ${displayName}`;
}
