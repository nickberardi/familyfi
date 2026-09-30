/**
 * What a phone's setup says, step by step (familyfi-ios's setup views), in the web's own names for
 * where a code comes from (Pair Device → Pair a phone), and the household details a person checks
 * before trusting it. Each client lays the steps out natively.
 */
import type { PendingEnrollment } from "./companion-pairing";
import { shortPin, transportLabel } from "./connection-routes";

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
    body: "Check the household details before trusting this server. Your one-time key is not used until you confirm.",
  },
  signIn: {
    title: "Sign in to FamilyFi",
    body: "Your FamilyFi login — the same one as the web app. The UniFi key stays on the Pi and never reaches this phone.",
  },
} as const;

export const SCAN_VERIFYING = "Code found — verifying the instance…";
export const CAMERA_OFF = "Camera access is off for FamilyFi. Allow it in Settings, or paste the code instead.";
export const CAMERA_NEEDED = "FamilyFi needs the camera to read the pairing code.";

/** The details of a verified household, to check before trusting it. */
export function pendingHouseholdRows({ code, identity }: PendingEnrollment): { label: string; value: string }[] {
  const { endpoint } = code;
  return [
    { label: "Address", value: endpoint.url },
    { label: "Route", value: transportLabel(endpoint.transport) },
    ...(endpoint.trustMode === "pinned" && endpoint.spkiSha256 ? [{ label: "Certificate pin", value: shortPin(endpoint.spkiSha256) }] : []),
    { label: "Signing key", value: shortPin(identity.keyFingerprint) },
  ];
}

/** What matched: the identity and the pinned certificate, or the identity and the system's HTTPS check. */
export function pendingHouseholdNote({ code }: PendingEnrollment): string {
  return code.endpoint.trustMode === "pinned"
    ? "The server identity and certificate matched the pairing code."
    : "The server identity matched the pairing code, and its certificate passed HTTPS validation.";
}
