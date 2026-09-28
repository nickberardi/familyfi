import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MAC_REGISTRANTS_FILE, macRegistrants } from "@/server/mac-vendor";

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) return sourceFiles(file);
    return /\.(ts|tsx)$/.test(entry) ? [path.relative(root, file)] : [];
  });
}

describe("MAC registrant database", () => {
  it("resolves IEEE prefixes of each assignment size and leaves unlisted prefixes unknown", () => {
    const registrants = macRegistrants();
    expect(registrants.forPrefix("00000C")).toBe("Cisco Systems, Inc");
    expect(registrants.forPrefix("00000c")).toBe("Cisco Systems, Inc");
    expect(registrants.forPrefix("000833")).toBeNull();
    const db = new DatabaseSync(MAC_REGISTRANTS_FILE, { readOnly: true });
    try {
      for (const length of [7, 9]) {
        const row = db.prepare(
          "SELECT prefix, name.name AS name FROM registrant JOIN name ON name.id = name_id WHERE length(prefix) = ? LIMIT 1",
        ).get(length) as { prefix: string; name: string };
        expect(registrants.forPrefix(row.prefix)).toBe(row.name);
      }
    } finally {
      db.close();
    }
  });

  it("does not infer a registrant from a locally administered or malformed MAC", () => {
    const registrants = macRegistrants();
    expect(registrants.forMac("02:00:00:00:00:01")).toBeNull();
    expect(registrants.forMac("invalid")).toBeNull();
    expect(registrants.forPrefix("ZZZZZZ")).toBeNull();
  });

  it("records where and when its IEEE listings were downloaded", () => {
    const db = new DatabaseSync(MAC_REGISTRANTS_FILE, { readOnly: true });
    try {
      const meta = Object.fromEntries(
        (db.prepare("SELECT key, value FROM meta").all() as { key: string; value: string }[]).map((row) => [row.key, row.value]),
      );
      expect(meta.format_version).toBe("1");
      expect(Number.isNaN(Date.parse(meta.downloaded_at))).toBe(false);
      const sources = db.prepare("SELECT url, sha256, rows FROM source ORDER BY url").all() as {
        url: string;
        sha256: string;
        rows: number;
      }[];
      expect(sources.map((source) => source.url)).toEqual([
        "https://standards-oui.ieee.org/oui/oui.csv",
        "https://standards-oui.ieee.org/oui28/mam.csv",
        "https://standards-oui.ieee.org/oui36/oui36.csv",
      ]);
      for (const source of sources) {
        expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(source.rows).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });

  it("throws when the database cannot be read so sync can keep the last known value", () => {
    expect(() => macRegistrants(path.join(root, "missing-mac-registrants.sqlite"))).toThrow();
  });

  it("is imported only by sync, not directly by a route or page, and ships in the image", () => {
    const importers = sourceFiles(path.join(root, "src")).filter((file) =>
      /from\s+["'](?:\.\/|@\/server\/)mac-vendor["']/.test(readFileSync(path.join(root, file), "utf8")),
    );
    expect(importers).toEqual(["src/server/reconciliation.ts"]);
    expect(readFileSync(path.join(root, "docker/Dockerfile"), "utf8")).toContain(
      "COPY --from=build /app/src/server/mac-registrants.sqlite ./src/server/mac-registrants.sqlite",
    );
  });
});
