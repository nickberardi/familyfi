import { describe, expect, it } from "vitest";
import { recoveryAdminBanner } from "@/server/startup-banner";

describe("recoveryAdminBanner", () => {
  it("makes username and password obvious", () => {
    const banner = recoveryAdminBanner("example-pass-12");
    expect(banner).toContain("username: admin");
    expect(banner).toContain("password: example-pass-12");
    expect(banner).toContain("DEFAULT_PASSWORD");
  });
});
