import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Where the Docker image installs the pinned binary; elsewhere (dev) it comes from PATH. */
const IMAGE_BINARY = "/usr/local/bin/cloudflared";

export function findCloudflared(): { bin: string; version: string } | null {
  for (const bin of [IMAGE_BINARY, "cloudflared"]) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (probe.status === 0) return { bin, version: (probe.stdout || probe.stderr).trim().split("\n")[0] };
  }
  return null;
}

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** The random address a quick tunnel announces in its log, if this chunk carries it. */
export function quickTunnelUrl(chunk: string): string | null {
  return chunk.match(QUICK_URL)?.[0] ?? null;
}

/** The first `ERR` line in a chunk, for showing why a tunnel is not up. */
export function tunnelError(chunk: string): string | null {
  const line = chunk.split("\n").find((entry) => /\sERR\s/.test(entry));
  return line ? line.replace(/^\S+\s+ERR\s+/, "").trim().slice(0, 300) : null;
}

/**
 * Starts a quick tunnel to `origin`. HOME points at an empty directory so a
 * cloudflared config the host happens to have can't change what this tunnel serves.
 */
export function startQuickTunnel(bin: string, origin: string): ChildProcess {
  const home = mkdtempSync(path.join(tmpdir(), "familyfi-cloudflared-"));
  return spawn(bin, ["tunnel", "--no-autoupdate", "--url", origin], {
    // A fresh environment on purpose: the app's own (database password, encryption key) never reaches cloudflared.
    env: { PATH: process.env.PATH ?? "", HOME: home } as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
