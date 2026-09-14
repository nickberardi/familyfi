import { describe, expect, it } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function roundTrip(plain: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

describe("secret encryption", () => {
  it("round-trips AES-256-GCM payloads", () => {
    const key = randomBytes(32);
    expect(roundTrip("unifi-key-example", key)).toBe("unifi-key-example");
  });
});
