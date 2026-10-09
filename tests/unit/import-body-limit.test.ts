import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

/** Whether a path goes through `src/proxy.ts`, as Next reads its matcher. */
const proxied = (path: string) => config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));

describe("a household import", () => {
  // The proxy makes Next buffer a request's body and, past 10 MB, pass on only the first part
  // without an error, so a large export would arrive cut short and read as damaged.
  it("skips the proxy, so its body reaches the route whole", () => {
    expect(proxied("/api/v1/settings/import")).toBe(false);
  });

  it("leaves every other route, including the rest of Settings, behind the proxy", () => {
    for (const path of ["/settings", "/api/v1/settings/export", "/api/v1/settings/import/x", "/api/v1/auth/login", "/update"]) {
      expect(proxied(path), path).toBe(true);
    }
  });
});
