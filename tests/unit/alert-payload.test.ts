import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import vectors from "../fixtures/alert-vectors.json";
import { alertText } from "@/lib/alert-copy";
import type { AlertEnvelope } from "@/lib/alert-kinds";
import { ALERT_CIPHERTEXT_MAX_CHARS, AlertTooLargeError, decryptAlert, encryptAlert, parseAlertKey } from "@/server/alerts/payload";

const envelope: AlertEnvelope = { v: 1, i: "k3f9x2", t: 1794787200, k: "device.new", d: { n: 3 } };

describe("alert payload", () => {
  it("round-trips an envelope under the phone's key, in the documented frame", () => {
    const key = randomBytes(32);
    const sealed = encryptAlert(key, envelope);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    const frame = Buffer.from(sealed, "base64url");
    expect(frame[0]).toBe(1);
    expect(frame.length).toBe(1 + 12 + Buffer.byteLength(JSON.stringify(envelope)) + 16);
    expect(decryptAlert(key, sealed)).toEqual(envelope);
    // A fresh nonce each time.
    expect(encryptAlert(key, envelope)).not.toBe(sealed);
  });

  it("fails with another key, a changed byte or other additional data", () => {
    const key = randomBytes(32);
    const sealed = encryptAlert(key, envelope);
    expect(() => decryptAlert(randomBytes(32), sealed)).toThrow();
    const frame = Buffer.from(sealed, "base64url");
    frame[20] ^= 1;
    expect(() => decryptAlert(key, frame.toString("base64url"))).toThrow();
    const versioned = Buffer.from(sealed, "base64url");
    versioned[0] = 2;
    expect(() => decryptAlert(key, versioned.toString("base64url"))).toThrow("Not a FamilyFi alert.");
  });

  it("refuses a key that is not 32 bytes, and an alert too large to send", () => {
    expect(() => encryptAlert(randomBytes(16), envelope)).toThrow();
    const huge = { ...envelope, d: { h: "x".repeat(ALERT_CIPHERTEXT_MAX_CHARS) } };
    expect(() => encryptAlert(randomBytes(32), huge)).toThrow(AlertTooLargeError);
  });

  it("reads a phone's key in standard or URL-safe base64, and nothing else", () => {
    const key = randomBytes(32);
    expect(parseAlertKey(key.toString("base64"))).toEqual(key);
    expect(parseAlertKey(key.toString("base64url"))).toEqual(key);
    expect(parseAlertKey(randomBytes(31).toString("base64"))).toBeNull();
    expect(parseAlertKey("not base64!")).toBeNull();
  });

  it("matches the shared vectors the apps' native ports check against", () => {
    const key = Buffer.from(vectors.key, "base64");
    expect(vectors.aad).toBe("familyfi-alert-v1");
    for (const vector of vectors.cases) {
      expect(encryptAlert(key, vector.envelope as AlertEnvelope, Buffer.from(vector.nonce, "hex")), vector.name).toBe(vector.ciphertext);
      const opened = decryptAlert(key, vector.ciphertext);
      expect(opened, vector.name).toEqual(vector.envelope);
      expect(alertText(opened.k, opened.d), vector.name).toEqual(vector.text);
    }
  });
});
