import { describe, expect, it } from "vitest";
import type { PendingEnrollment } from "@/lib/companion-pairing";
import { connectionHousehold, pendingHouseholdNote, pendingHouseholdSections, trustExplanation } from "@/lib/companion-setup";
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
  it("groups what the code said (the key kept secret) and what a pinned household proved", () => {
    expect(pendingHouseholdSections(pending(route))).toEqual([
      {
        title: "Found in pairing code",
        rows: [
          { label: "Server address", value: "https://familyfi.home", mono: true },
          { label: "One-time pairing key", value: "cm1.token", mono: true, secret: true },
        ],
      },
      {
        title: "Verified household",
        rows: [
          { label: "Household", value: "A household", mono: false },
          { label: "Instance", value: "ff_home", mono: true },
          { label: "Key fingerprint", value: FINGERPRINT, mono: true },
          { label: "Certificate", value: PIN, mono: true },
        ],
      },
    ]);
    expect(pendingHouseholdNote(pending(route))).toBe("The server identity and certificate matched the pairing code.");
    expect(trustExplanation(pending(route))).toMatch(/^FamilyFi issues its own certificate\. Trusting it pins this fingerprint/);
  });

  it("shows no certificate for a system-trusted route, and says ordinary HTTPS validation applies", () => {
    const system = { ...route, transport: "cloudflare" as const, trustMode: "system" as const, spkiSha256: null };
    expect(pendingHouseholdSections(pending(system))[1]!.rows.map((row) => row.label)).toEqual(["Household", "Instance", "Key fingerprint"]);
    expect(pendingHouseholdNote(pending(system))).toMatch(/passed HTTPS validation/);
    expect(trustExplanation(pending(system))).toMatch(/^This route uses ordinary HTTPS validation\./);
  });
});

describe("the Connection screen", () => {
  it("names the signing key, and who is signed in", () => {
    expect(connectionHousehold(FINGERPRINT, "Admin")).toBe(`Signing key ${shortPin(FINGERPRINT)} · signed in as Admin`);
    expect(connectionHousehold(FINGERPRINT, null)).toBe(`Signing key ${shortPin(FINGERPRINT)}`);
  });
});
