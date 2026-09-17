import type { Group, Household } from "@prisma/client";
import { decryptSecret, encryptSecret } from "../crypto";

export class ResolverConfigError extends Error {}

/**
 * The host with its path hidden. Several DoH providers put an account or profile id
 * in the URL path, and that id is bearer-ish — anyone holding it can query through
 * the household's profile — so the stored display value keeps the host and drops the
 * rest. `maskSecret` is wrong here: the last four characters of a profile path are
 * not a useful hint and still leak.
 */
export function maskResolverUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/••••••`;
  } catch {
    return "••••••";
  }
}

/** Must be an absolute HTTPS URL. Plain HTTP would put DNS queries back in the clear. */
export function normalizeResolverUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new ResolverConfigError("Paste the DNS-over-HTTPS endpoint.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ResolverConfigError("That is not a URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new ResolverConfigError("The endpoint must start with https://.");
  }
  if (!parsed.hostname.includes(".")) {
    throw new ResolverConfigError("That URL has no host.");
  }
  return parsed.toString();
}

/**
 * Returns `Uint8Array` rather than `Buffer` so the result drops straight into a
 * Prisma `Bytes` column — `Buffer<ArrayBufferLike>` is not assignable to Prisma 7's
 * `Uint8Array<ArrayBuffer>`. Converting here means no call site has to remember.
 */
export function encryptResolverUrl(raw: string): {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
  mask: string;
} {
  const url = normalizeResolverUrl(raw);
  const secret = encryptSecret(url);
  return {
    ciphertext: bytes(secret.ciphertext),
    iv: bytes(secret.iv),
    authTag: bytes(secret.authTag),
    mask: maskResolverUrl(url),
  };
}

/** Copies into a fresh ArrayBuffer: `Uint8Array.from` keeps the source's ArrayBufferLike. */
function bytes(source: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function decrypt(
  ciphertext: Uint8Array | null,
  iv: Uint8Array | null,
  authTag: Uint8Array | null,
): string | null {
  if (!ciphertext || !iv || !authTag) return null;
  try {
    return decryptSecret({
      ciphertext: Buffer.from(ciphertext),
      iv: Buffer.from(iv),
      authTag: Buffer.from(authTag),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/authenticate data|Unsupported state/i.test(message)) {
      throw new ResolverConfigError(
        "The stored DNS endpoint cannot be decrypted. FAMILYFI_ENCRYPTION_KEY has changed — paste the endpoint again in Categories.",
      );
    }
    throw error;
  }
}

export function householdResolverUrl(household: Household): string | null {
  return decrypt(household.dohUrlCiphertext, household.dohUrlIv, household.dohUrlAuthTag);
}

export function groupResolverOverride(group: Group): string | null {
  return decrypt(group.dohOverrideCiphertext, group.dohOverrideIv, group.dohOverrideAuthTag);
}

/**
 * A group's own endpoint when it has one, otherwise the household default — the
 * "Uses the household default set in Categories" case in the design.
 */
export function resolverUrlForGroup(household: Household, group: Group | null): string | null {
  if (group) {
    const override = groupResolverOverride(group);
    if (override) return override;
  }
  return householdResolverUrl(household);
}
