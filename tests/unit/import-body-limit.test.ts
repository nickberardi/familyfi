import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { IMPORT_MAX_BYTES } from "@/server/household-export";

const UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** Next's `proxyClientMaxBodySize`, a number of bytes or a string such as "52mb". */
function bytes(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  const match = /^(\d+)(b|kb|mb|gb)$/i.exec(value ?? "");
  return match ? Number(match[1]) * UNITS[match[2].toLowerCase()] : 10 * 1024 ** 2;
}

describe("a household import through the proxy", () => {
  // `src/proxy.ts` makes Next buffer request bodies, and past its limit it passes on only the first
  // part without an error, so a large export would arrive cut short and read as damaged.
  it("is buffered whole up to the import's own cap", () => {
    expect(bytes(nextConfig.experimental?.proxyClientMaxBodySize)).toBeGreaterThanOrEqual(IMPORT_MAX_BYTES);
  });
});
