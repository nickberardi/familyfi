import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConnectionTransport, ConnectionTrustMode, RouteKind, type ConnectionEndpoint } from "@prisma/client";
import { isUniqueViolation } from "../connection";
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

/** What the household chose: no route, FamilyFi's quick tunnel, or "My domain" (FamilyFi's tunnel on it, or a route the household runs). */
export type RemoteAccessMode = "off" | "quick" | "named";

/** The tunnel this process runs for the published route, if any. */
type Wanted = typeof RouteKind.quick | typeof RouteKind.domain | null;

export type RemoteAccessState = {
  mode: RemoteAccessMode;
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
  wanted: Wanted;
  /** This process's identity for the tunnel lease. */
  owner: string;
  leaseTimer: ReturnType<typeof setInterval> | null;
  exitHook: boolean;
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
  wanted: null,
  owner: randomUUID(),
  leaseTimer: null,
  exitHook: false,
});

/**
 * Only one FamilyFi process may run the tunnel for a database. Two would each keep the
 * tunnel's route pointed at their own address and fight over it — two dev servers do it,
 * and so could an old and a new container overlapping during an upgrade. The lease is a
 * row in the same table reconciliation uses, under its own id.
 */
const LEASE_ID = "tunnel";
const LEASE_MS = 60_000;
const LEASE_RENEW_MS = 20_000;

async function acquireLease(): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_MS);
  const existing = await prisma().reconciliationLock.findUnique({ where: { id: LEASE_ID } });
  if (!existing) {
    try {
      await prisma().reconciliationLock.create({ data: { id: LEASE_ID, owner: runtime.owner, expiresAt } });
      return true;
    } catch {
      return false;
    }
  }
  if (existing.owner !== runtime.owner && existing.expiresAt > now) return false;
  const updated = await prisma().reconciliationLock.updateMany({
    where: { id: LEASE_ID, OR: [{ owner: runtime.owner }, { expiresAt: { lte: now } }] },
    data: { owner: runtime.owner, expiresAt },
  });
  return updated.count === 1;
}

async function releaseLease() {
  if (runtime.leaseTimer) clearInterval(runtime.leaseTimer);
  runtime.leaseTimer = null;
  await prisma().reconciliationLock.updateMany({ where: { id: LEASE_ID, owner: runtime.owner }, data: { expiresAt: new Date(0) } });
}

/** Renews the lease while a tunnel is wanted; losing it stops this process's tunnel. */
function keepLease() {
  if (runtime.leaseTimer) return;
  runtime.leaseTimer = setInterval(() => {
    void acquireLease()
      .then((held) => {
        if (held || !runtime.wanted) return;
        runtime.child?.kill();
        runtime.child = null;
        runtime.url = null;
        runtime.status = "error";
        runtime.error = ANOTHER_PROCESS;
      })
      .catch(() => undefined);
  }, LEASE_RENEW_MS);
}

const ANOTHER_PROCESS = "Another FamilyFi process using this database is running remote access. Only one may; this one will take over if that one stops.";

/** A tunnel must not outlive the FamilyFi process that started it. */
function killChildOnExit() {
  if (runtime.exitHook) return;
  runtime.exitHook = true;
  process.once("exit", () => runtime.child?.kill());
}

/** Time a person gets to finish the Cloudflare authorization in their browser. */
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export class RemoteAccessError extends Error {}

type Db = Parameters<Parameters<ReturnType<typeof prisma>["$transaction"]>[0]>[0];

function appPort(): number {
  return Number(process.env.PORT || 3000);
}

async function publishedRoute(db: Db = prisma() as unknown as Db): Promise<ConnectionEndpoint | null> {
  const row = await db.household.findUnique({ where: { id: "default" } });
  return row?.remoteEndpointId ? db.connectionEndpoint.findUnique({ where: { id: row.remoteEndpointId } }) : null;
}

async function routeOfKind(kind: typeof RouteKind.quick | typeof RouteKind.domain, db: Db = prisma() as unknown as Db) {
  return db.connectionEndpoint.findFirst({ where: { householdId: "default", kind } });
}

function storedCredential(route: ConnectionEndpoint): TunnelCredential | null {
  if (!route.tunnelCredentialCiphertext || !route.tunnelCredentialIv || !route.tunnelCredentialAuthTag) return null;
  return parseTunnelCredential(
    decryptSecret({
      ciphertext: Buffer.from(route.tunnelCredentialCiphertext),
      iv: Buffer.from(route.tunnelCredentialIv),
      authTag: Buffer.from(route.tunnelCredentialAuthTag),
    }),
  );
}

/**
 * Makes `endpointId` the one route Remote access publishes, and turns every other route
 * off. A route you run goes on straight away; a tunnel's route waits for its tunnel, so
 * phones are never handed an address nothing answers yet.
 */
async function publish(db: Db, endpointId: string | null, enable: boolean) {
  await db.household.update({ where: { id: "default" }, data: { remoteEndpointId: endpointId } });
  await db.connectionEndpoint.updateMany({
    where: { householdId: "default", ...(endpointId ? { id: { not: endpointId } } : {}) },
    data: { enabled: false },
  });
  if (endpointId) await db.connectionEndpoint.update({ where: { id: endpointId }, data: { enabled: enable } });
}

/**
 * Points the quick-tunnel route at the tunnel's current address and turns it on, keeping
 * its id so phones follow. The first quick tunnel creates the route and publishes it.
 */
async function adoptQuickUrl(url: string) {
  await prisma().$transaction(async (db) => {
    if (runtime.wanted !== RouteKind.quick) return;
    const current = await routeOfKind(RouteKind.quick, db);
    if (current) {
      await db.connectionEndpoint.update({ where: { id: current.id }, data: { url } });
      await publish(db, current.id, true);
      return;
    }
    const created = await db.connectionEndpoint.create({
      data: { url, kind: RouteKind.quick, transport: ConnectionTransport.cloudflare, trustMode: ConnectionTrustMode.system, enabled: false },
    });
    await publish(db, created.id, true);
  });
}

/** The domain route's address never changes; going live only turns it on. */
async function adoptDomainRoute(id: string) {
  await prisma().$transaction(async (db) => {
    if (runtime.wanted !== RouteKind.domain) return;
    await publish(db, id, true);
  });
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

/**
 * Saves the tunnel's route, then reports running — never the other way round, so
 * "running" always means phones can already learn the address.
 */
function goLive(url: string, adopt: () => Promise<void>) {
  runtime.attempts = 0;
  void adopt()
    .then(() => {
      if (runtime.url === url) runtime.status = "running";
    })
    .catch(onAdoptFailure);
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
    if (!runtime.wanted) return;
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
  if (!(await acquireLease())) {
    runtime.status = "error";
    runtime.error = ANOTHER_PROCESS;
    // Try again later: the other process may stop, and its lease then expires.
    runtime.restartTimer = setTimeout(() => void launch(), LEASE_MS);
    return;
  }
  keepLease();
  killChildOnExit();
  runtime.gateway ??= await startPhoneGateway(appPort());
  const origin = `http://127.0.0.1:${runtime.gateway.port}`;
  runtime.status = "starting";
  runtime.error = null;

  if (runtime.wanted === RouteKind.quick) {
    supervise(startQuickTunnel(binary.bin, origin), (text) => {
      const url = quickTunnelUrl(text);
      if (url && url !== runtime.url) {
        runtime.url = url;
        goLive(url, () => adoptQuickUrl(url));
      }
    });
    return;
  }

  const route = await routeOfKind(RouteKind.domain);
  const credential = route ? storedCredential(route) : null;
  if (!route || !credential) {
    runtime.status = "error";
    runtime.error = "No domain is set up. Connect your domain again.";
    return;
  }
  supervise(startNamedTunnel(binary.bin, origin, credential), (text) => {
    // cloudflared registers several edge connections; the first is enough.
    if (tunnelRegistered(text) && runtime.url !== route.url) {
      runtime.url = route.url;
      goLive(route.url, () => adoptDomainRoute(route.id));
    }
  });
}

/**
 * Saves the domain route: `https://<hostname>`, holding the tunnel credential. A new
 * hostname rewrites the one domain route in place, keeping its id so phones follow.
 */
async function saveDomainRoute(hostname: string, credential: TunnelCredential) {
  const secret = encryptSecret(JSON.stringify(credential));
  const data = {
    url: `https://${hostname}`,
    tunnelCredentialCiphertext: new Uint8Array(secret.ciphertext),
    tunnelCredentialIv: new Uint8Array(secret.iv),
    tunnelCredentialAuthTag: new Uint8Array(secret.authTag),
  };
  try {
    await prisma().$transaction(async (db) => {
      const current = await routeOfKind(RouteKind.domain, db);
      if (current) await db.connectionEndpoint.update({ where: { id: current.id }, data });
      else await db.connectionEndpoint.create({ data: { ...data, kind: RouteKind.domain, transport: ConnectionTransport.cloudflare, trustMode: ConnectionTrustMode.system, enabled: false } });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new RemoteAccessError(`Another route already uses https://${hostname}. Remove it first, or choose another hostname.`);
    throw error;
  }
}

/**
 * One-time "Use my domain" setup, the way Scrypted's cloud plugin does it: a person
 * authorizes FamilyFi in Cloudflare, FamilyFi creates a tunnel and a DNS record for
 * the hostname, keeps only that tunnel's credential (encrypted, on the domain route),
 * and throws away the account-wide certificate the login produced.
 */
async function connectDomain(hostname: string, signal: AbortSignal) {
  const binary = findCloudflared();
  if (!binary) throw new RemoteAccessError("cloudflared is not installed on this server.");
  const row = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
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

    await saveDomainRoute(hostname, credential);
  } finally {
    // The login certificate can create and delete tunnels and DNS across the whole zone. It never outlives setup.
    rmSync(home, { recursive: true, force: true });
  }
}

function modeOf(route: ConnectionEndpoint | null): RemoteAccessMode {
  if (route) return route.kind === RouteKind.quick ? "quick" : "named";
  // Nothing is published while a first quick tunnel comes up or a domain is being set up.
  if (runtime.setup || runtime.wanted === RouteKind.domain) return "named";
  return runtime.wanted === RouteKind.quick ? "quick" : "off";
}

export async function remoteAccessState(): Promise<RemoteAccessState> {
  const route = await publishedRoute();
  const domain = await routeOfKind(RouteKind.domain);
  const own = route?.kind === RouteKind.own;
  const tunnelWanted = Boolean(route ? !own : runtime.wanted || runtime.setup);
  return {
    mode: modeOf(route),
    // A route the household runs is up as far as FamilyFi can tell. Otherwise report what the tunnel is
    // actually doing — including a setup that failed after nothing was published — rather than "off".
    status: own ? "running" : !tunnelWanted && runtime.status !== "error" ? "off" : runtime.status,
    url: own ? route.url : runtime.url,
    error: own ? null : runtime.error,
    endpointId: route?.id ?? null,
    cloudflared: findCloudflared()?.version ?? null,
    hostname: domain ? new URL(domain.url).hostname : null,
    loginUrl: runtime.loginUrl,
  };
}

export type RemoteAccessChange =
  | { mode: "off"; forget?: boolean }
  | { mode: "quick" }
  | { mode: "named"; hostname?: string; endpointId?: string };

async function stopTunnel() {
  runtime.wanted = null;
  runtime.status = "off";
  await releaseLease();
}

/** Checks a "My domain" change before anything stops, so a refused request never takes down a running tunnel. */
async function namedTarget(change: Extract<RemoteAccessChange, { mode: "named" }>) {
  if (change.endpointId) {
    const route = await prisma().connectionEndpoint.findUnique({ where: { id: change.endpointId } });
    if (!route || route.householdId !== "default") throw new RemoteAccessError("That route doesn't exist.");
    if (route.kind !== RouteKind.own) throw new RemoteAccessError("That route belongs to FamilyFi's own tunnel. Choose Quick tunnel or your domain instead.");
    return { own: route } as const;
  }
  const domain = await routeOfKind(RouteKind.domain);
  const setUp = domain ? new URL(domain.url).hostname : null;
  const hostname = change.hostname?.trim().toLowerCase() || setUp;
  if (!hostname || !validHostname(hostname)) throw new RemoteAccessError("Enter a hostname on a domain in your Cloudflare account, like familyfi.example.com.");
  // Already set up for this hostname: just run it.
  return domain && hostname === setUp && storedCredential(domain) ? ({ domain } as const) : ({ hostname } as const);
}

export async function setRemoteAccess(change: RemoteAccessChange) {
  const target = change.mode === "named" ? await namedTarget(change) : null;
  stopAll();
  runtime.error = null;
  runtime.attempts = 0;

  if (change.mode === "off") {
    await stopTunnel();
    await prisma().$transaction(async (db) => {
      await publish(db, null, false);
      // The credential lives on the domain route, so forgetting the domain deletes it with the route.
      if (change.forget) await db.connectionEndpoint.deleteMany({ where: { householdId: "default", kind: RouteKind.domain } });
    });
    return;
  }

  if (change.mode === "quick") {
    runtime.wanted = RouteKind.quick;
    const current = await routeOfKind(RouteKind.quick);
    await prisma().$transaction((db) => publish(db, current?.id ?? null, false));
    await launch();
    return;
  }

  // A route the household runs: publish it and run no tunnel.
  if (target?.own) {
    await stopTunnel();
    await prisma().$transaction((db) => publish(db, target.own.id, true));
    return;
  }

  if (target?.domain) {
    runtime.wanted = RouteKind.domain;
    await prisma().$transaction((db) => publish(db, target.domain.id, false));
    await launch();
    return;
  }

  // New hostname: stop publishing whatever ran before, then set up in the background while the page polls.
  await prisma().$transaction((db) => publish(db, null, false));
  runtime.wanted = RouteKind.domain;
  const setup = new AbortController();
  runtime.setup = setup;
  runtime.status = "signing-in";
  void connectDomain(target!.hostname!, setup.signal)
    .then(async () => {
      if (setup.signal.aborted || runtime.setup !== setup) return;
      runtime.setup = null;
      const route = await routeOfKind(RouteKind.domain);
      if (route) await prisma().$transaction((db) => publish(db, route.id, false));
      await launch();
    })
    .catch((error) => {
      if (runtime.setup !== setup) return;
      runtime.setup = null;
      runtime.wanted = null;
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

/** Called once at boot: resumes the tunnel behind the route the household left published. */
export async function resumeRemoteAccess() {
  const route = await publishedRoute();
  if (!route || route.kind === RouteKind.own) return;
  runtime.wanted = route.kind;
  if (!runtime.child) await launch();
}
