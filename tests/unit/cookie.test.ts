import { describe, expect, it } from "vitest";
import { cookieValue } from "@/lib/cookie";

describe("cookieValue", () => {
  it("reads a named cookie from a header", () => {
    expect(cookieValue("a=1; familyfi_session=abc_def; b=2", "familyfi_session")).toBe("abc_def");
  });

  it("decodes URI-encoded values", () => {
    expect(cookieValue("familyfi_session=a%2Fb", "familyfi_session")).toBe("a/b");
  });
});
