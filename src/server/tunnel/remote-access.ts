import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConnectionTransport, ConnectionTrustMode, TunnelMode, type Household } from "@prisma/client";
import { decryptSecret, encryptSecret } from "../crypto";
import { prisma } from "../db";
import {
  findCloudflared,
  loginUrl,
  parseTunnelCredential,
  quickTunnelUrl,
  runCloudflared,
  startNamedTunnel,
  startQuickTunnel,
  tunnelError,
  tunnelRegistered,
  validHostname,
  type TunnelCredential,
} from "./cloudflared";
import { startPhoneGateway } from "./phone-gateway";

export type RemoteAccessStatus = "off" | "signing-in" | "starting" | "running" | "error" | "unavailable";

export type RemoteAccessState = {
  mode: TunnelMode;
  status: RemoteAccessStatus;
  url: string | null;
  error: string | null;
  endpointId: string | null;
  cloudflared: string | null;
  hostname: string | null;
  loginUrl: string | null;
};

type Runtime = {
  status: RemoteAccessStatus;
  url: string | null;
  error: string | null;
  loginUrl: string | null;
  child: ChildProcess | null;
  setup: AbortController | null;
  gateway: { server: Server; port: number } | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  wanted: TunnelMode;
};

/** One tunnel per process, surviving dev reloads of this module. */
const runtime: Runtime = ((globalThis as { familyfiRemoteAccess?: Runtime }).familyfiRemoteAccess ??= {
  status: "off",
  url: null,
  error: null,
  loginUrl: null,
  child: null,
  setup: null,
  gateway: null,
  restartTimer: null,
  attempts: 0,
  wanted: TunnelMode.off,
});

/** Time a person gets to finish the Cloudflare authorization in their browser. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export class RemoteAccessError extends Error {}

function appPort(): number {
  return Number(process.env.PORT || 3000);
}

async function household(): Promise<Household> {
  return prisma().household.findUniqueOrThrow({ where: { id: "default" } });
}

function storedCredential(row: Household): TunnelCredential | null {
  if (!row.tunnelCredentialCiphertext || !row.tunnelCredentialIv || !row.tunnelCredentialAuthTag) return null;
  return parseTunnelCredential(
    decryptSecret({
      ciphertext: Buffer.from(row.tunnelCredentialCiphertext),
      iv: Buffer.from(row.tunnelCredentialIv),
      authTag: Buffer.from(row.tunnelCredentialAuthTag),
    }),
  );
}

/** Points the one app-owned route at the tunnel's current address, keeping its id so phones follow. */
async function adoptUrl(url: string) {
  await prisma().$transaction(async (db) => {
    const row = await db.household.findUniqueOrThrow({ where: { id: "default" } });
    const current = row.tunnelEndpointId ? await db.connectionEndpoint.findUnique({ where: { id: row.tunnelEndpointId } }) : null;
    if (current) {
      await db.connectionEndpoint.update({ where: { id: current.id }, data: { url, enabled: true } });
      return;
    }
    const last = await db.connectionEndpoint.aggregate({ _max: { priority: true } });
    const created = await db.connectionEndpoint.create({
      data: {
        url,
        transport: ConnectionTransport.cloudflare,
        trustMode: ConnectionTrustMode.system,
        priority: Math.min(999, (last._max.priority ?? -10) + 10),
      },
    });
    await db.household.update({ where: { id: "default" }, data: { tunnelEndpointId: created.id } });
  });
}

async function disableRoute() {
  const row = await prisma().household.findUnique({ where: { id: "default" } });
  if (row?.tunnelEndpointId) {
    await prisma().connectionEndpoint.updateMany({ where: { id: row.tunnelEndpointId }, data: { enabled: false } });
  }
}

function stopAll() {
  if (runtime.restartTimer) clearTimeout(runtime.restartTimer);
  runtime.restartTimer = null;
  runtime.setup?.abort();
  runtime.setup = null;
  runtime.child?.kill();
  runtime.child = null;
  runtime.url = null;
  runtime.loginUrl = null;
}

function onAdoptFailure(error: unknown) {
  runtime.status = "error";
  runtime.error = `The tunnel is up, but its route could not be saved: ${error instanceof Error ? error.message : String(error)}`;
}

/** Watches a running tunnel process and restarts it with backoff if it stops while still wanted. */
function supervise(child: ChildProcess, onChunk: (text: string) => void) {
  runtime.child = child;
  const read = (data: Buffer) => {
    const text = data.toString();
    onChunk(text);
    const failure = tunnelError(text);
    if (failure && runtime.status !== "running") runtime.error = failure;
  };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);
  child.on("exit", () => {
    if (runtime.child !== child) return;
    runtime.child = null;
    runtime.url = null;
    if (runtime.wanted === TunnelMode.off) return;
    runtime.status = "error";
    runtime.error ??= "The tunnel stopped. Retrying.";
    const delay = Math.min(60_000, 5_000 * 2 ** runtime.attempts++);
    runtime.restartTimer = setTimeout(() => void launch(), delay);
  });
}

async function launch() {
  const binary = findCloudflared();
  if (!binary) {
    runtime.status = "unavailable";
    runtime.error = "cloudflared is not installed on this server.";
    return;
  }
  runtime.gateway ??= await startPhoneGateway(appPort());
  const origin = `http://127.0.0.1:${runtime.gateway.port}`;
  runtime.status = "starting";
  runtime.error = null;

  if (runtime.wanted === TunnelMode.quick) {
    supervise(startQuickTunnel(binary.bin, origin), (text) => {
      const url = quickTunnelUrl(text);
      if (url && url !== runtime.url) {
        runtime.url = url;
        runtime.status = "running";
        runtime.attempts = 0;
        void adoptUrl(url).catch(onAdoptFailure);
      }
    });
    return;
  }

  const row = await household();
  const credential = storedCredential(row);
  if (!credential || !row.tunnelHostname) {
    runtime.status = "error";
    runtime.error = "No domain is set up. Connect your domain again.";
    return;
  }
  const url = `https://${row.tunnelHostname}`;
  supervise(startNamedTunnel(binary.bin, origin, credential), (text) => {
    if (tunnelRegistered(text) && runtime.status !== "running") {
      runtime.url = url;
      runtime.status = "running";
      runtime.attempts = 0;
      void adoptUrl(url).catch(onAdoptFailure);
    }
  });
}

/**
 * One-time "Use my domain" setup, the way Scrypted's cloud plugin does it: a person
 * authorizes FamilyFi in Cloudflare, FamilyFi creates a tunnel and a DNS record for
 * the hostname, keeps only that tunnel's credential (encrypted), and throws away the
 * account-wide certificate the login produced.
 */
async function connectDomain(hostname: string, signal: AbortSignal) {
  const binary = findCloudflared();
  if (!binary) throw new RemoteAccessError("cloudflared is not installed on this server.");
  const row = await household();
  const home = mkdtempSync(path.join(tmpdir(), "familyfi-cloudflared-setup-"));
  try {
    runtime.status = "signing-in";
    const login = await runCloudflared(binary.bin, ["tunnel", "login"], {
      home,
      timeoutMs: LOGIN_TIMEOUT_MS,
      signal,
      onOutput: (text) => {
        runtime.loginUrl ??= loginUrl(text);
      },
    });
    runtime.loginUrl = null;
    if (signal.aborted) return;
    const cert = path.join(home, ".cloudflared", "cert.pem");
    if (login.code !== 0 || !existsSync(cert)) {
      throw new RemoteAccessError("Cloudflare sign-in did not finish. Start again and complete the authorization within five minutes.");
    }

    runtime.status = "starting";
    const origin = ["--origincert", cert];
    const name = `familyfi-${row.instanceId ?? "household"}`;
    // A setup that ran before (same household) leaves a tunnel with this name; clear it so create succeeds.
    await runCloudflared(binary.bin, ["tunnel", ...origin, "delete", name], { home, timeoutMs: 30_000, signal });
    const credentialPath = path.join(home, "tunnel.json");
    const created = await runCloudflared(binary.bin, ["tunnel", ...origin, "create", "--credentials-file", credentialPath, name], { home, timeoutMs: 30_000, signal });
    if (created.code !== 0 || !existsSync(credentialPath)) {
      throw new RemoteAccessError(`Cloudflare could not create the tunnel. ${tunnelError(created.output) ?? ""}`.trim());
    }
    const credential = parseTunnelCredential(readFileSync(credentialPath, "utf8"));

    // No --overwrite-dns: an existing record for this hostname is the household's, not ours to replace.
    const routed = await runCloudflared(binary.bin, ["tunnel", ...origin, "route", "dns", credential.TunnelID, hostname], { home, timeoutMs: 30_000, signal });
    if (routed.code !== 0) {
      await runCloudflared(binary.bin, ["tunnel", ...origin, "delete", credential.TunnelID], { home, timeoutMs: 30_000 });
      const reason = tunnelError(routed.output) ?? "";
      throw new RemoteAccessError(
        /already exists/i.test(routed.output)
          ? `${hostname} already has a DNS record in Cloudflare. Choose another hostname, or remove that record first.`
          : `Cloudflare could not point ${hostname} at the tunnel. ${reason}`.trim(),
      );
    }

    const secret = encryptSecret(JSON.stringify(credential));
    await prisma().household.update({
      where: { id: "default" },
      data: {
        tunnelMode: TunnelMode.named,
        tunnelHostname: hostname,
        tunnelCredentialCiphertext: new Uint8Array(secret.ciphertext),
        tunnelCredentialIv: new Uint8Array(secret.iv),
        tunnelCredentialAuthTag: new Uint8Array(secret.authTag),
      },
    });
  } finally {
    // The login certificate can create and delete tunnels and DNS across the whole zone. It never outlives setup.
    rmSync(home, { recursive: true, force: true });
  }
}

export async function remoteAccessState(): Promise<RemoteAccessState> {
  const row = await household();
  return {
    mode: row.tunnelMode,
    // Mode stays stored as off until a domain setup finishes, and after one fails. While setup runs,
    // or after it failed, report what is actually happening rather than "off".
    status: row.tunnelMode === TunnelMode.off && !runtime.setup && runtime.status !== "error" ? "off" : runtime.status,
    url: runtime.url,
    error: runtime.error,
    endpointId: row.tunnelEndpointId,
    cloudflared: findCloudflared()?.version ?? null,
    hostname: row.tunnelHostname,
    loginUrl: runtime.loginUrl,
  };
}

export type RemoteAccessChange =
  | { mode: typeof TunnelMode.off; forget?: boolean }
  | { mode: typeof TunnelMode.quick }
  | { mode: typeof TunnelMode.named; hostname?: string };

export async function setRemoteAccess(change: RemoteAccessChange) {
  stopAll();
  runtime.error = null;
  runtime.attempts = 0;

  if (change.mode === TunnelMode.off) {
    runtime.wanted = TunnelMode.off;
    runtime.status = "off";
    await prisma().household.update({
      where: { id: "default" },
      data: {
        tunnelMode: TunnelMode.off,
        ...(change.forget
          ? { tunnelHostname: null, tunnelCredentialCiphertext: null, tunnelCredentialIv: null, tunnelCredentialAuthTag: null }
          : {}),
      },
    });
    await disableRoute();
    return;
  }

  if (change.mode === TunnelMode.quick) {
    runtime.wanted = TunnelMode.quick;
    await prisma().household.update({ where: { id: "default" }, data: { tunnelMode: TunnelMode.quick } });
    await launch();
    return;
  }

  const row = await household();
  const hostname = change.hostname?.trim().toLowerCase() || row.tunnelHostname;
  if (!hostname || !validHostname(hostname)) throw new RemoteAccessError("Enter a hostname on a domain in your Cloudflare account, like familyfi.example.com.");

  // Already set up for this hostname: just run it.
  if (hostname === row.tunnelHostname && storedCredential(row)) {
    runtime.wanted = TunnelMode.named;
    await prisma().household.update({ where: { id: "default" }, data: { tunnelMode: TunnelMode.named } });
    await launch();
    return;
  }

  // New hostname: stop serving whatever ran before, then set up in the background while the page polls.
  await prisma().household.update({ where: { id: "default" }, data: { tunnelMode: TunnelMode.off } });
  await disableRoute();
  runtime.wanted = TunnelMode.named;
  const setup = new AbortController();
  runtime.setup = setup;
  runtime.status = "signing-in";
  void connectDomain(hostname, setup.signal)
    .then(async () => {
      if (setup.signal.aborted || runtime.setup !== setup) return;
      runtime.setup = null;
      await launch();
    })
    .catch((error) => {
      if (runtime.setup !== setup) return;
      runtime.setup = null;
      runtime.wanted = TunnelMode.off;
      runtime.status = "error";
      runtime.loginUrl = null;
      runtime.error = error instanceof Error ? error.message : String(error);
    });
}

/**
 * For a tunnel run in its own container (Compose sidecar): exposes the phone-only
 * gateway on the container network at FAMILYFI_PHONE_GATEWAY_PORT. Never publish this
 * port on the host; point the sidecar at `http://app:<port>`.
 */
export async function startSidecarGateway(port: number) {
  const { port: bound } = await startPhoneGateway(appPort(), { host: "0.0.0.0", port });
  console.log(`Phone-only gateway for a tunnel sidecar listening on port ${bound}.`);
}

/** Called once at boot: resumes the tunnel the household left on. */
export async function resumeRemoteAccess() {
  const row = await prisma().household.findUnique({ where: { id: "default" } });
  if (!row || row.tunnelMode === TunnelMode.off) return;
  runtime.wanted = row.tunnelMode;
  if (!runtime.child) await launch();
}
