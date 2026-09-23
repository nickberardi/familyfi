import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Minimal environment for every cloudflared child, even `--version`: never the app's own secrets. */
function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", HOME: home, ...extra } as unknown as NodeJS.ProcessEnv;
}

/** Where the Docker image installs the pinned binary; elsewhere (dev) it comes from PATH. */
const IMAGE_BINARY = "/usr/local/bin/cloudflared";

export function findCloudflared(): { bin: string; version: string } | null {
  // CLOUDFLARED_BIN is test-only: it points integration tests at a stand-in binary.
  const candidates = [process.env.CLOUDFLARED_BIN, IMAGE_BINARY, "cloudflared"].filter((bin): bin is string => Boolean(bin));
  for (const bin of candidates) {
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, env: childEnv(tmpdir()) });
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

const LOGIN_URL = /https:\/\/dash\.cloudflare\.com\/argotunnel\S*/;

/** The authorization link `cloudflared tunnel login` asks a person to open. */
export function loginUrl(chunk: string): string | null {
  return chunk.match(LOGIN_URL)?.[0] ?? null;
}

/** A named tunnel is serving once cloudflared registers its first edge connection. */
export function tunnelRegistered(chunk: string): boolean {
  return /Registered tunnel connection/i.test(chunk);
}

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function validHostname(value: string): boolean {
  return HOSTNAME.test(value) && !value.endsWith(".trycloudflare.com") && !value.endsWith(".cfargotunnel.com");
}

/** The tunnel-scoped credential `tunnel create` writes: enough to run that one tunnel, nothing else. */
export type TunnelCredential = { AccountTag: string; TunnelSecret: string; TunnelID: string };

export function parseTunnelCredential(json: string): TunnelCredential {
  const parsed = JSON.parse(json) as Partial<TunnelCredential>;
  if (!parsed.AccountTag || !parsed.TunnelSecret || !parsed.TunnelID) throw new Error("cloudflared did not write a usable tunnel credential.");
  return { AccountTag: parsed.AccountTag, TunnelSecret: parsed.TunnelSecret, TunnelID: parsed.TunnelID };
}

/** Runs one cloudflared command to completion, streaming its output to `onOutput`. */
export function runCloudflared(
  bin: string,
  args: string[],
  { home, timeoutMs, onOutput, signal }: { home: string; timeoutMs: number; onOutput?: (chunk: string) => void; signal?: AbortSignal },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: childEnv(home), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (data: Buffer) => {
      const text = data.toString();
      output += text;
      onOutput?.(text);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code, output });
    });
  });
}

/**
 * Runs a named tunnel. The credential goes in through `TUNNEL_CRED_CONTENTS`, so it is
 * never written to disk, and every hostname routed to the tunnel lands on `origin`.
 */
export function startNamedTunnel(bin: string, origin: string, credential: TunnelCredential): ChildProcess {
  const home = mkdtempSync(path.join(tmpdir(), "familyfi-cloudflared-"));
  return spawn(bin, ["tunnel", "--no-autoupdate", "--url", origin, "run", credential.TunnelID], {
    env: childEnv(home, { TUNNEL_CRED_CONTENTS: JSON.stringify(credential) }),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Starts a quick tunnel to `origin`. HOME points at an empty directory so a
 * cloudflared config the host happens to have can't change what this tunnel serves.
 */
export function startQuickTunnel(bin: string, origin: string): ChildProcess {
  const home = mkdtempSync(path.join(tmpdir(), "familyfi-cloudflared-"));
  return spawn(bin, ["tunnel", "--no-autoupdate", "--url", origin], {
    // A fresh environment on purpose: the app's own (database password, encryption key) never reaches cloudflared.
    env: childEnv(home),
    stdio: ["ignore", "pipe", "pipe"],
  });
}
