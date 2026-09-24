/**
 * AGENTS.md: never commit `/designs/`, `.env`, UniFi keys or unsanitized household API
 * dumps. This checks what git tracks, and that test data could not have come from a real
 * household: every MAC is locally administered (no real device ships with one) and every
 * fixture IPv4 address is in a range reserved for documentation.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

const MAC = /\b[0-9a-f]{2}(?:([:-])[0-9a-f]{2}(?:\1[0-9a-f]{2}){4})\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/** RFC 5737 documentation ranges, plus loopback and the unspecified address. */
const DOCUMENTATION_IPV4 = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$|^127\.0\.0\.1$|^0\.0\.0\.0$/;

describe("repository hygiene", () => {
  it("tracks no designs, environment files or private keys", () => {
    expect(tracked.filter((file) => file.startsWith("designs/"))).toEqual([]);
    expect(tracked.filter((file) => /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".env.example"))).toEqual([]);
    const keys = tracked.filter(
      (file) =>
        !file.endsWith("repository-hygiene.test.ts") &&
        !/\.(png|jpg|ico|woff2?)$/.test(file) &&
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(read(file)),
    );
    expect(keys).toEqual([]);
  });

  it("uses only locally administered MAC addresses in tests and fixtures", () => {
    const global: string[] = [];
    for (const file of tracked.filter((name) => name.startsWith("tests/") && !name.endsWith("repository-hygiene.test.ts"))) {
      for (const mac of read(file).match(MAC) ?? []) {
        // The locally administered bit is 0x02 of the first octet; vendor-assigned MACs clear it.
        if ((parseInt(mac.slice(0, 2), 16) & 0x02) === 0) global.push(`${file}: ${mac}`);
      }
    }
    expect(global).toEqual([]);
  });

  it("uses only documentation IPv4 addresses in fixtures", () => {
    const real: string[] = [];
    for (const file of tracked.filter((name) => name.startsWith("tests/fixtures/"))) {
      for (const address of read(file).match(IPV4) ?? []) {
        if (!DOCUMENTATION_IPV4.test(address)) real.push(`${file}: ${address}`);
      }
    }
    expect(real).toEqual([]);
  });
});
