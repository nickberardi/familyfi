import { describe, expect, it } from "vitest";
import type { PendingEnrollment } from "@/lib/companion-pairing";
import { pendingHouseholdNote, pendingHouseholdRows } from "@/lib/companion-setup";
import { shortPin } from "@/lib/connection-routes";
import type { ConnectionRoute } from "@/lib/types";

const PIN = "p".repeat(43);
const FINGERPRINT = "f".repeat(43);
const route: ConnectionRoute = {
  id: "pairing",
  url: "https://familyfi.home",
  kind: "own",
  transport: "lan",
  trustMode: "pinned",
  spkiSha256: PIN,
  priority: 0,
  enabled: true,
  edgeAuth: "none",
  edgeTokenVersion: null,
};
const pending = (endpoint: ConnectionRoute): PendingEnrollment => ({
  code: { pairingId: "cm1", token: "token", endpoint, keyFingerprint: FINGERPRINT, edgeCredential: null },
  identity: {
    protocolVersion: 1,
    householdName: "A household",
    instanceId: "ff_home",
    publicKey: { kty: "OKP", crv: "Ed25519", x: "x" },
    keyFingerprint: FINGERPRINT,
  },
});

describe("confirming a household", () => {
  it("shows the address, route, pin and signing key of a pinned home-network route", () => {
    expect(pendingHouseholdRows(pending(route))).toEqual([
      { label: "Address", value: "https://familyfi.home" },
      { label: "Route", value: "Home network" },
      { label: "Certificate pin", value: shortPin(PIN) },
      { label: "Signing key", value: shortPin(FINGERPRINT) },
    ]);
    expect(pendingHouseholdNote(pending(route))).toBe("The server identity and certificate matched the pairing code.");
  });

  it("shows no pin for a system-trusted route, and says HTTPS validation passed", () => {
    const system = { ...route, transport: "cloudflare" as const, trustMode: "system" as const, spkiSha256: null };
    expect(pendingHouseholdRows(pending(system)).map((row) => row.label)).toEqual(["Address", "Route", "Signing key"]);
    expect(pendingHouseholdNote(pending(system))).toMatch(/passed HTTPS validation/);
  });
});
