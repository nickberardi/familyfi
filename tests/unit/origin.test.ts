import { describe, expect, it } from "vitest";
import { originAllowed } from "@/server/origin";

describe("originAllowed", () => {
  it("allows a request with no Origin", () => {
    expect(originAllowed(new Request("http://localhost:3000/api/v1/auth/login"))).toBe(true);
  });

  it("allows Origin when it matches the Host the browser used", () => {
    const request = new Request("http://localhost:3000/api/v1/auth/login", {
      headers: { origin: "http://10.1.2.88:3000", host: "10.1.2.88:3000" },
    });
    expect(originAllowed(request)).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    const request = new Request("http://localhost:3000/api/v1/auth/login", {
      headers: { origin: "http://evil.example", host: "localhost:3000" },
    });
    expect(originAllowed(request)).toBe(false);
  });
});
