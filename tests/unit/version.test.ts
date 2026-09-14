import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION, appVersionLabel } from "@/lib/version";

describe("app version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(appVersionLabel()).toBe(`v${pkg.version}`);
  });
});
