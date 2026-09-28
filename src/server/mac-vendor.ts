import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

/**
 * The committed IEEE registrant database, built by `scripts/update-mac-vendors.py`. It is
 * read from disk rather than imported so it never becomes part of a route bundle.
 */
export const MAC_REGISTRANTS_FILE = path.join(process.cwd(), "src/server/mac-registrants.sqlite");

export type MacRegistrants = {
  /** Look up one IEEE assignment prefix without handling a household MAC. */
  forPrefix(prefix: string): string | null;
  /** The IEEE registrant for a universally administered EUI-48, when public. */
  forMac(mac: string): string | null;
};

let cached: MacRegistrants | null = null;

/** Opens the registrant database read-only once per process. Throws when it cannot be read. */
export function macRegistrants(file = MAC_REGISTRANTS_FILE): MacRegistrants {
  if (cached && file === MAC_REGISTRANTS_FILE) return cached;
  const db = new DatabaseSync(file, { readOnly: true });
  const byPrefix: StatementSync = db.prepare(
    "SELECT name.name AS name FROM registrant JOIN name ON name.id = registrant.name_id WHERE registrant.prefix = ?",
  );
  const forPrefix = (prefix: string): string | null => {
    if (!/^[0-9A-F]{6}([0-9A-F]{1}|[0-9A-F]{3})?$/i.test(prefix)) return null;
    const row = byPrefix.get(prefix.toUpperCase()) as { name: string } | undefined;
    return row?.name ?? null;
  };
  const registrants: MacRegistrants = {
    forPrefix,
    forMac(mac) {
      const hex = mac.replaceAll(":", "").replaceAll("-", "").toUpperCase();
      if (!/^[0-9A-F]{12}$/.test(hex)) return null;
      const firstOctet = Number.parseInt(hex.slice(0, 2), 16);
      if (firstOctet & 0b11) return null; // multicast or locally administered
      return forPrefix(hex.slice(0, 9)) ?? forPrefix(hex.slice(0, 7)) ?? forPrefix(hex.slice(0, 6));
    },
  };
  if (file === MAC_REGISTRANTS_FILE) cached = registrants;
  return registrants;
}
