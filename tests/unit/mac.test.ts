import { describe, expect, it } from "vitest";
import { normalizeMac } from "@/server/mac";

describe("normalizeMac", () => {
  it("lowercases and colon-separates", () => {
    expect(normalizeMac("8C85901A440E")).toBe("8c:85:90:1a:44:0e");
    expect(normalizeMac("8C:85:90:1A:44:0E")).toBe("8c:85:90:1a:44:0e");
    expect(normalizeMac("8c-85-90-1a-44-0e")).toBe("8c:85:90:1a:44:0e");
  });

  it("rejects incomplete values", () => {
    expect(() => normalizeMac("aa:bb")).toThrow(/12 hex/);
  });
});
