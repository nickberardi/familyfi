import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findCloudflared } from "@/server/tunnel/cloudflared";

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CLOUDFLARED_BIN;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in cloudflared that counts each `--version` it answers, or fails each one. */
function standIn(answers: boolean) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "familyfi-cloudflared-"));
  dirs.push(dir);
  const bin = path.join(dir, "cloudflared");
  const log = path.join(dir, "calls");
  writeFileSync(log, "");
  writeFileSync(bin, `#!/bin/sh\necho x >> "${log}"\n${answers ? 'echo "cloudflared version 2026.1.0"' : "exit 1"}\n`);
  chmodSync(bin, 0o755);
  return { bin, calls: () => readFileSync(log, "utf8").split("\n").filter(Boolean).length };
}

/** A real cloudflared on this machine answers after the stand-in fails, so "missing" cannot be staged. */
const installed = ["/usr/local/bin/cloudflared", "cloudflared"].some((bin) => spawnSync(bin, ["--version"]).status === 0);

describe("finding cloudflared", () => {
  it("asks a found binary its version once per process", () => {
    const found = standIn(true);
    process.env.CLOUDFLARED_BIN = found.bin;
    for (let i = 0; i < 3; i += 1) expect(findCloudflared()).toEqual({ bin: found.bin, version: "cloudflared version 2026.1.0" });
    expect(found.calls()).toBe(1);
  });

  it.skipIf(installed)("looks again for a missing binary only after a minute", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const broken = standIn(false);
    process.env.CLOUDFLARED_BIN = broken.bin;
    const first = findCloudflared();
    findCloudflared();
    expect(broken.calls()).toBe(1);
    vi.setSystemTime(Date.now() + 60_000);
    expect(findCloudflared()).toEqual(first);
    expect(broken.calls()).toBe(2);
  });
});
