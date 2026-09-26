import { describe, expect, it } from "vitest";
import { encodePairingCode, type PairingPayload } from "@/server/pairing-code";

const BASE: PairingPayload = { version: 1, url: "https://familyfi.example.com", code: "cm1.tok-en_1", fingerprint: "YHR8ymzYy_jm_u6uZiR3pvKfqqQ19dRn69BhlUV2VMc" };

function decode(pairingCode: string): unknown {
  return JSON.parse(Buffer.from(pairingCode, "base64url").toString("utf8"));
}

describe("pairing code", () => {
  it("is unpadded base64url of the payload, safe to paste or put in a link", () => {
    for (const payload of [BASE, { ...BASE, pin: "a".repeat(43) }, { ...BASE, access: { clientId: "abc.access", clientSecret: "s+e/c=r?e&t" } }]) {
      const pairingCode = encodePairingCode(payload);
      expect(pairingCode).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decode(pairingCode)).toEqual(payload);
    }
  });

  it("never carries both a certificate pin and an Access token", () => {
    expect(() => encodePairingCode({ ...BASE, pin: "a".repeat(43), access: { clientId: "a", clientSecret: "b" } })).toThrow(/never both/);
  });
});
