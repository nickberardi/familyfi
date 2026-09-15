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

  it("wrong key fails with authenticate data", () => {
    const key = randomBytes(32);
    const other = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update("secret", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const decipher = createDecipheriv("aes-256-gcm", other, iv);
    decipher.setAuthTag(tag);
    expect(() => Buffer.concat([decipher.update(ciphertext), decipher.final()])).toThrow(
      /authenticate data|Unsupported state/i,
    );
  });

