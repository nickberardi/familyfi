import { describe, expect, it } from "vitest";
import { pairingCodeFromLink, pairingLink, runsFamilyFiApp } from "@/lib/pairing-link";

const CODE = "eyJ2ZXJzaW9uIjoxfQ-_x";

describe("pairing link", () => {
  it("carries the pairing code unchanged in the app's scheme", () => {
    expect(pairingLink(CODE)).toBe(`familyfi://pair?code=${CODE}`);
    expect(pairingCodeFromLink(pairingLink(CODE))).toBe(CODE);
  });

  it("reads the code from the forms an app receives its link in", () => {
    for (const link of [`familyfi://pair?code=${CODE}`, `familyfi-dev://pair?code=${CODE}`, `/pair?code=${CODE}`, `pair?code=${CODE}`, `familyfi://pair/?x=1&code=${CODE}`]) {
      expect(pairingCodeFromLink(link)).toBe(CODE);
    }
  });

  it("reads nothing from any other link", () => {
    for (const link of ["familyfi://family/abc", "familyfi://pair", "familyfi://pair?code=", "familyfi://repair?code=x", "https://example.com/?code=x", ""]) {
      expect(pairingCodeFromLink(link)).toBeNull();
    }
  });

  it("is offered only where the app runs", () => {
    expect(runsFamilyFiApp("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(true);
    expect(runsFamilyFiApp("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(runsFamilyFiApp("Mozilla/5.0 (Linux; Android 16; Pixel 10)")).toBe(true);
    expect(runsFamilyFiApp("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(runsFamilyFiApp("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
});
