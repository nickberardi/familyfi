import { describe, expect, it } from "vitest";
import { normalizeMac } from "@/server/mac";

describe("normalizeMac", () => {
  it("lowercases and colon-separates", () => {
    expect(normalizeMac("0A85901A440E")).toBe("0a:85:90:1a:44:0e");
    expect(normalizeMac("0A:85:90:1A:44:0E")).toBe("0a:85:90:1a:44:0e");
    expect(normalizeMac("0a-85-90-1a-44-0e")).toBe("0a:85:90:1a:44:0e");
  });

  it("rejects incomplete values", () => {
    expect(() => normalizeMac("aa:bb")).toThrow(/12 hex/);
  });
});
