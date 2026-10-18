import type { ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConnectionTransport, ConnectionTrustMode, RouteKind, type ConnectionEndpoint } from "@prisma/client";
import { ensureConnectionIdentity, isUniqueViolation } from "../connection";
import { decryptSecret, encryptSecret } from "../crypto";
import { prisma } from "../db";
import { demoModeEnabled } from "../env";
import {
  findCloudflared,
  loginUrl,
  parseOriginCert,
  parseTunnelCredential,
  quickTunnelUrl,
  runCloudflared,
  startNamedTunnel,
  startQuickTunnel,
  tunnelError,
  tunnelRegistered,
  validHostname,
  type OriginCert,
  type TunnelCredential,
} from "./cloudflared";
import { deleteTunnelDnsRecords } from "./cloudflare-dns";
import { startPhoneGateway } from "./phone-gateway";
import { NO_EVIDENCE, checkRoute, reachabilityOf, type RouteReachability } from "./route-check";

export type RemoteAccessStatus = "off" | "signing-in" | "starting" | "running" | "error" | "unavailable";

/** What the household chose: no route, FamilyFi's quick tunnel, or `named`: Cloudflare Automatic (FamilyFi's tunnel on a hostname) or a route the household runs (My domain, Tailscale, Cloudflare Advanced). */
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
  /** For a route the household runs, the evidence that it works; null for FamilyFi's own tunnel or Off. */
  reachability: RouteReachability | null;
};

type Runtime = {
  status: RemoteAccessStatus;
  url: string | null;
  error: string | null;
  loginUrl: string | null;
  child: ChildProcess | null;
  setup: AbortController | null;
  /** The setup running is Forget domain's cleanup in Cloudflare, not a domain coming up. */
  forgetting: boolean;
  gateway: { server: Server; port: number } | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  attempts: number;
  wanted: Wanted;
  /** This process's identity for the tunnel lease. */
  owner: string;
  leaseTimer: ReturnType<typeof setInterval> | null;
  exitHook: boolean;
  /** Counts switches, so a state read can tell that one happened while it read the database. */
  switches: number;
  /** The remote-access port's view of the published route, read at most every five seconds. */
  routeCheck?: { at: number; route: Promise<string | null> };
  /** When a request through the published route was last recorded. */
  reachedWrite?: { at: number; id: string };
};

/**
 * One tunnel per process, surviving dev reloads of this module, and shared by the route handlers and
 * the remote-access port, which Next.js bundles as separate copies of this module.
 */
const runtime: Runtime = ((globalThis as { familyfiRemoteAccess?: Runtime }).familyfiRemoteAccess ??= {
  status: "off",
  url: null,
  error: null,
  loginUrl: null,
  child: null,
  setup: null,
  forgetting: false,
  gateway: null,
  restartTimer: null,
  attempts: 0,
  wanted: null,
  owner: randomUUID(),
  leaseTimer: null,
  exitHook: false,
  switches: 0,
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
 * Runs `save` in one transaction while `kind` is still the tunnel wanted, and reports
 * whether it ran: a choice changed while the tunnel came up publishes nothing.
 */
async function adoptWhileWanted(kind: typeof RouteKind.quick | typeof RouteKind.domain, save: (db: Db) => Promise<void>): Promise<boolean> {
  return prisma().$transaction(async (db) => {
    if (runtime.wanted !== kind) return false;
    await save(db);
    return true;
  });
}

/**
 * Points the quick-tunnel route at the tunnel's current address and turns it on, keeping
 * its id rather than adding a route. Phones paired through the old address can't reach this
 * one and must pair again. The first quick tunnel creates the route and publishes it.
 */
function adoptQuickUrl(url: string) {
  return adoptWhileWanted(RouteKind.quick, async (db) => {
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
function adoptDomainRoute(id: string) {
  return adoptWhileWanted(RouteKind.domain, (db) => publish(db, id, true));
}

function stopAll() {
  if (runtime.restartTimer) clearTimeout(runtime.restartTimer);
  runtime.restartTimer = null;
  runtime.setup?.abort();
  runtime.setup = null;
  runtime.forgetting = false;
  runtime.child?.kill();
  runtime.child = null;
  runtime.url = null;
  runtime.loginUrl = null;
  // Before any route is unpublished, so a state read never pairs "running" with no route.
  runtime.status = "starting";
  runtime.switches = (runtime.switches ?? 0) + 1;
}

function onAdoptFailure(error: unknown) {
  runtime.status = "error";
  runtime.error = `The tunnel is up, but its route could not be saved: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Saves the tunnel's route, then reports running — never the other way round, so
 * "running" always means phones can already learn the address.
 */
function goLive(url: string, adopt: () => Promise<boolean>) {
  runtime.attempts = 0;
  void adopt()
    .then((published) => {
      if (published && runtime.url === url) runtime.status = "running";
    })
    .catch(onAdoptFailure);
}

/** Watches a running tunnel process and restarts it with backoff if it stops while still wanted. */
function supervise(child: ChildProcess, onChunk: (text: string) => void) {
  runtime.child = child;
  const read = (data: Buffer) => {
    // A stopped or replaced tunnel can still flush output; only the current one speaks for remote access.
    if (runtime.child !== child) return;
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
    runtime.error = "Cloudflare Automatic isn't set up. Sign in to Cloudflare again.";
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
    throw error; // coverage-exempt: any other database failure; a household can only cause the unique violation above
  }
}

/** Tunnels FamilyFi made for this household: `familyfi-<instance id>`, or that with a suffix since each setup names its own. */
function ownTunnelName(base: string, name: string): boolean {
  return name === base || new RegExp(`^${base.replace(/[^\w-]/g, "\\$&")}-[0-9a-f]{8}$`).test(name);
}

/** The ids of this household's tunnels in the account, for finding what a forgotten domain left behind. */
async function listOwnTunnels(bin: string, args: { home: string; signal: AbortSignal }, origin: string[], base: string): Promise<string[]> {
  const listed = await runCloudflared(bin, ["tunnel", ...origin, "list", "--name-prefix", base, "--output", "json"], { ...args, timeoutMs: 30_000 });
  // The JSON is on stdout alone; cloudflared logs, an update notice say, go to stderr after it. A failed list
  // prints no JSON: nothing is found, and setup carries on as on a first connect.
  try {
    const tunnels = JSON.parse(listed.stdout) as { id?: string; name?: string }[];
    return tunnels.filter((tunnel) => tunnel.id && tunnel.name && ownTunnelName(base, tunnel.name)).map((tunnel) => tunnel.id!);
  } catch {
    console.warn(`Remote access: could not list FamilyFi's tunnels in Cloudflare: ${tunnelError(listed.output) ?? `exit ${listed.code}`}`);
    return [];
  }
}

function readCredential(route: ConnectionEndpoint | null): TunnelCredential | null {
  try {
    return route ? storedCredential(route) : null;
  } catch {
    return null;
  }
}

/** A finished Cloudflare sign-in: cloudflared commands that act with its certificate, and the certificate's API token. */
type SignedIn = { run: (args: string[], signal?: AbortSignal) => ReturnType<typeof runCloudflared>; api: OriginCert | null; list: (base: string) => Promise<string[]> };

/**
 * Runs `cloudflared tunnel login` in `home`, showing its link while a person authorizes
 * FamilyFi. Null when aborted. The certificate it writes stays in `home`, which the caller deletes.
 */
async function signIn(bin: string, home: string, signal: AbortSignal): Promise<SignedIn | null> {
  runtime.status = "signing-in";
  const login = await runCloudflared(bin, ["tunnel", "login"], {
    home,
    timeoutMs: LOGIN_TIMEOUT_MS,
    signal,
    onOutput: (text) => {
      runtime.loginUrl ??= loginUrl(text);
    },
  });
  runtime.loginUrl = null;
  if (signal.aborted) return null;
  const cert = path.join(home, ".cloudflared", "cert.pem");
  if (login.code !== 0 || !existsSync(cert)) {
    throw new RemoteAccessError("Cloudflare sign-in did not finish. Start again and complete the authorization within five minutes.");
  }
  runtime.status = "starting";
  const origin = ["--origincert", cert];
  let api: OriginCert | null = null;
  try {
    api = parseOriginCert(readFileSync(cert, "utf8"));
  } catch (error) {
    console.warn(`Remote access: ${error instanceof Error ? error.message : String(error)} Old DNS records are left in place.`);
  }
  return {
    run: (args, runSignal) => runCloudflared(bin, ["tunnel", ...origin, ...args], { home, timeoutMs: 30_000, signal: runSignal }),
    api,
    list: (base) => listOwnTunnels(bin, { home, signal }, origin, base),
  };
}

/**
 * Deletes FamilyFi's old tunnels by their ids, each after the DNS records pointing at it, and
 * returns what could not be removed, as sentences for the person to act on. `hostname` is the
 * one the person knows those records by, when there is one. `force` is for the domain's own
 * recorded tunnel, which this process stopped moments ago and Cloudflare may still count
 * connections for; a tunnel only found by name is never forced, in case another FamilyFi (a
 * restored backup, say) still runs it.
 */
async function removeOldTunnels(cloudflare: SignedIn, hostname: string | null, tunnelIds: string[], force: boolean): Promise<string[]> {
  const leftovers: string[] = [];
  const records = async (tunnelId: string) => {
    try {
      if (!cloudflare.api) throw new Error("no API token in the sign-in certificate");
      await deleteTunnelDnsRecords({ cert: cloudflare.api, tunnelId, hostname: hostname ?? undefined });
    } catch (error) {
      console.warn(`Remote access: could not remove the DNS records for the old tunnel ${tunnelId}: ${error instanceof Error ? error.message : String(error)}`);
      leftovers.push(hostname ? `The old DNS record for ${hostname} could not be removed; delete it in Cloudflare.` : `The DNS records for the old tunnel ${tunnelId} could not be removed; delete them in Cloudflare.`);
    }
  };
  for (const tunnelId of tunnelIds) {
    // The recorded tunnel's records go first: they no longer reach anything. A tunnel found by name keeps
    // its records unless it could be deleted, so one another FamilyFi still runs keeps working.
    if (force) await records(tunnelId);
    const deleted = await cloudflare.run(["delete", ...(force ? ["-f"] : []), tunnelId]);
    if (deleted.code !== 0) {
      console.warn(`Remote access: could not delete the old tunnel ${tunnelId}: ${tunnelError(deleted.output) ?? `exit ${deleted.code}`}`);
      leftovers.push(`The old tunnel ${tunnelId} could not be removed; delete it in Cloudflare.`);
    } else if (!force) await records(tunnelId);
  }
  return leftovers;
}

/** FamilyFi's tunnels are named for this install's instance id, so a name never matches another install's. */
async function tunnelBase(): Promise<string> {
  return `familyfi-${(await ensureConnectionIdentity()).instanceId}`;
}

/**
 * One-time "Use my domain" setup, the way Scrypted's cloud plugin does it: a person
 * authorizes FamilyFi in Cloudflare, FamilyFi creates a tunnel and a DNS record for
 * the hostname, keeps only that tunnel's credential (encrypted, on the domain route),
 * and throws away the account-wide certificate the login produced.
 *
 * A hostname change saves the new domain before it removes anything, so a change that
 * fails leaves the old domain working. Only then, while the certificate still exists, it
 * removes the old tunnel and the DNS record FamilyFi made for it. That cleanup never
 * blocks the change: what it could not remove comes back as a warning to show.
 */
async function connectDomain(hostname: string, signal: AbortSignal): Promise<string | null> {
  const binary = findCloudflared();
  if (!binary) throw new RemoteAccessError("cloudflared is not installed on this server.");
  const previous = await routeOfKind(RouteKind.domain);
  const oldHostname = previous ? new URL(previous.url).hostname : null;
  const home = mkdtempSync(path.join(tmpdir(), "familyfi-cloudflared-setup-"));
  try {
    const cloudflare = await signIn(binary.bin, home, signal);
    if (!cloudflare) return null;
    const { run, api } = cloudflare;
    const base = await tunnelBase();
    // The tunnel the domain route runs, or, after Forget or with a credential FamilyFi can't read, whatever tunnels of ours are in the account.
    const recorded = readCredential(previous)?.TunnelID;
    const oldTunnels = recorded ? [recorded] : await cloudflare.list(base);

    // A record FamilyFi made for this hostname before (a forgotten domain, or one whose credential it can't read)
    // is removed so the hostname can be routed; anyone else's record stops setup below.
    for (const tunnelId of oldTunnels) {
      if (api) await deleteTunnelDnsRecords({ cert: api, tunnelId, only: hostname }).catch((error) => console.warn(`Remote access: could not remove the old DNS record for ${hostname}: ${error instanceof Error ? error.message : String(error)}`));
    }

    // Each setup names its own tunnel, so the old one keeps running until the new domain is saved.
    const name = `${base}-${randomBytes(4).toString("hex")}`;
    const credentialPath = path.join(home, "tunnel.json");
    const created = await run(["create", "--credentials-file", credentialPath, name], signal);
    if (created.code !== 0 || !existsSync(credentialPath)) {
      throw new RemoteAccessError(`Cloudflare could not create the tunnel. ${tunnelError(created.output) ?? ""}`.trim());
    }
    const credential = parseTunnelCredential(readFileSync(credentialPath, "utf8"));

    // No --overwrite-dns: an existing record for this hostname is the household's, not ours to replace.
    const routed = await run(["route", "dns", credential.TunnelID, hostname], signal);
    if (routed.code !== 0) {
      await run(["delete", credential.TunnelID]);
      const reason = tunnelError(routed.output) ?? "";
      throw new RemoteAccessError(
        /already exists/i.test(routed.output)
          ? `${hostname} already has a DNS record in Cloudflare. Choose another hostname, or remove that record first.`
          : `Cloudflare could not point ${hostname} at the tunnel. ${reason}`.trim(),
      );
    }

    try {
      await saveDomainRoute(hostname, credential);
    } catch (error) {
      // Nothing points at the new tunnel; take it and its record back out rather than leave them behind.
      if (api) await deleteTunnelDnsRecords({ cert: api, tunnelId: credential.TunnelID }).catch(() => undefined);
      await run(["delete", "-f", credential.TunnelID]);
      throw error;
    }

    // The new domain is saved: remove what the old one left, by its recorded tunnel id, never by name.
    const stale = oldTunnels.filter((id) => id !== credential.TunnelID);
    const leftovers = await removeOldTunnels(cloudflare, oldHostname && oldHostname !== hostname ? oldHostname : null, stale, Boolean(recorded));
    return leftovers.length ? leftovers.join(" ") : null;
  } finally {
    // The login certificate can create and delete tunnels and DNS across the whole zone. It never outlives setup.
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Forget domain's cleanup in Cloudflare, after the domain route is already gone: one more
 * sign-in, then FamilyFi deletes its tunnel and that hostname's DNS record. Returns what is
 * left for the person to delete, or null when nothing is (or the sign-in was cancelled).
 */
async function forgetInCloudflare(hostname: string, tunnelId: string | null, signal: AbortSignal): Promise<string | null> {
  const left = `The tunnel and DNS record for ${hostname} stay in your Cloudflare account; delete them there.`;
  const binary = findCloudflared();
  if (!binary) return left; // coverage-exempt: cloudflared set this domain up, so it is missing only if removed since
  const home = mkdtempSync(path.join(tmpdir(), "familyfi-cloudflared-setup-"));
  try {
    const cloudflare = await signIn(binary.bin, home, signal);
    if (!cloudflare) return null;
    // A credential FamilyFi could no longer read: its tunnels are still found by name in the account.
    const tunnels = tunnelId ? [tunnelId] : await cloudflare.list(await tunnelBase());
    const leftovers = await removeOldTunnels(cloudflare, hostname, tunnels, Boolean(tunnelId));
    return leftovers.length ? leftovers.join(" ") : null;
  } catch {
    return `Cloudflare sign-in did not finish. ${left}`;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function modeOf(route: ConnectionEndpoint | null): RemoteAccessMode {
  if (route) return route.kind === RouteKind.quick ? "quick" : "named";
  // Nothing is published while a first quick tunnel comes up or a domain is being set up.
  if (runtime.forgetting) return "off";
  if (runtime.setup || runtime.wanted === RouteKind.domain) return "named";
  return runtime.wanted === RouteKind.quick ? "quick" : "off";
}

export async function remoteAccessState(): Promise<RemoteAccessState> {
  // The tunnel's status is read on both sides of the database reads, and "running" only when both say so
  // and no switch came between. goLive saves its route before it reports running, and every switch leaves
  // running before it unpublishes one, so "running" only ever comes back with the route that tunnel published.
  const before = runtime.status;
  const switches = runtime.switches;
  const route = await publishedRoute();
  const domain = await routeOfKind(RouteKind.domain);
  const settled = before === "running" && runtime.switches === switches;
  const status = runtime.status === "running" && !settled ? (before === "running" ? "starting" : before) : runtime.status;
  const { url, error, loginUrl } = runtime;
  const own = route?.kind === RouteKind.own;
  const tunnelWanted = Boolean(route ? !own : runtime.wanted || runtime.setup);
  return {
    mode: modeOf(route),
    // A route the household runs is published; whether it works is `reachability`. Otherwise report what
    // the tunnel is actually doing — including a setup that failed after nothing was published — rather than "off".
    status: own ? "running" : !tunnelWanted && status !== "error" ? "off" : status,
    url: own ? route.url : url,
    error: own ? null : error,
    endpointId: route?.id ?? null,
    cloudflared: findCloudflared()?.version ?? null,
    hostname: domain ? new URL(domain.url).hostname : null,
    loginUrl,
    // The demo's route is the website every visitor is using, and nothing there can record or check it.
    reachability: own && !demoModeEnabled() ? reachabilityOf(route) : null,
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

/** Checks a `named` change (Cloudflare Automatic, or a route the household runs) before anything stops, so a refused request never takes down a running tunnel. */
async function namedTarget(change: Extract<RemoteAccessChange, { mode: "named" }>) {
  if (change.endpointId) {
    const route = await prisma().connectionEndpoint.findUnique({ where: { id: change.endpointId } });
    if (!route || route.householdId !== "default") throw new RemoteAccessError("That route doesn't exist.");
    if (route.kind !== RouteKind.own) throw new RemoteAccessError("That route belongs to FamilyFi's own tunnel. Choose Quick tunnel or Cloudflare Automatic instead.");
    return { own: route } as const;
  }
  const domain = await routeOfKind(RouteKind.domain);
  const setUp = domain ? new URL(domain.url).hostname : null;
  const hostname = change.hostname?.trim().toLowerCase() || setUp;
  if (!hostname || !validHostname(hostname)) throw new RemoteAccessError("Enter a hostname on a domain in your Cloudflare account, like familyfi.example.com.");
  // Already set up for this hostname: just run it.
  return domain && hostname === setUp && readCredential(domain) ? ({ domain } as const) : ({ hostname } as const);
}

/** Signs in to Cloudflare once more in the background to delete a forgotten domain's tunnel and DNS record. */
function forget(hostname: string, tunnelId: string | null) {
  const setup = new AbortController();
  runtime.setup = setup;
  runtime.forgetting = true;
  runtime.status = "signing-in";
  const done = (left: string | null) => {
    if (runtime.setup !== setup) return;
    runtime.setup = null;
    runtime.forgetting = false;
    runtime.status = "off";
    runtime.error = left;
  };
  void forgetInCloudflare(hostname, tunnelId, setup.signal).then(done, () => done(`The tunnel and DNS record for ${hostname} stay in your Cloudflare account; delete them there.`)); // coverage-exempt: the rejection is only a temporary directory that can't be made
}

export async function setRemoteAccess(change: RemoteAccessChange) {
  const target = change.mode === "named" ? await namedTarget(change) : null;
  stopAll();
  runtime.error = null;
  runtime.attempts = 0;

  if (change.mode === "off") {
    await stopTunnel();
    const domain = change.forget ? await routeOfKind(RouteKind.domain) : null;
    await prisma().$transaction(async (db) => {
      await publish(db, null, false);
      // The credential lives on the domain route, so forgetting the domain deletes it with the route.
      if (change.forget) await db.connectionEndpoint.deleteMany({ where: { householdId: "default", kind: RouteKind.domain } });
    });
    if (domain) forget(new URL(domain.url).hostname, readCredential(domain)?.TunnelID ?? null);
    return;
  }

  if (change.mode === "quick") {
    runtime.wanted = RouteKind.quick;
    const current = await routeOfKind(RouteKind.quick);
    await prisma().$transaction((db) => publish(db, current?.id ?? null, false));
    await launch();
    return;
  }

  // A route the household runs: publish it and run no tunnel, then look at it from home. Evidence from
  // before it was published again says nothing about it now.
  if (target?.own) {
    await stopTunnel();
    await prisma().$transaction(async (db) => {
      await publish(db, target.own.id, true);
      await db.connectionEndpoint.update({ where: { id: target.own.id }, data: NO_EVIDENCE });
    });
    forgetRouteReached();
    publishCheck = checkRoute(target.own.id).catch(() => null);
    return;
  }

  if (target?.domain) {
    runtime.wanted = RouteKind.domain;
    await prisma().$transaction((db) => publish(db, target.domain.id, false));
    await launch();
    return;
  }

  // New hostname: stop publishing whatever ran before, then set up in the background while the page polls.
  const before = await publishedRoute();
  await prisma().$transaction((db) => publish(db, null, false));
  runtime.wanted = RouteKind.domain;
  const setup = new AbortController();
  runtime.setup = setup;
  runtime.status = "signing-in";
  void connectDomain(target!.hostname!, setup.signal)
    .then(async (warning) => {
      if (setup.signal.aborted || runtime.setup !== setup) return;
      runtime.setup = null;
      const route = await routeOfKind(RouteKind.domain);
      if (route) await prisma().$transaction((db) => publish(db, route.id, false));
      await launch();
      if (warning) runtime.error = [runtime.error, warning].filter(Boolean).join(" ");
    })
    .catch(async (error) => {
      if (runtime.setup !== setup) return;
      runtime.setup = null;
      runtime.loginUrl = null;
      const message = error instanceof Error ? error.message : String(error);
      // A failed hostname change leaves the domain that was running untouched: run it again.
      if (before?.kind === RouteKind.domain && readCredential(await routeOfKind(RouteKind.domain))) {
        await prisma().$transaction((db) => publish(db, before.id, false));
        await launch();
        runtime.error = [message, runtime.error].filter(Boolean).join(" ");
        return;
      }
      runtime.wanted = null;
      runtime.status = "error";
      runtime.error = message;
    })
    .catch((error) => {
      // coverage-exempt: a database failure while restoring the old domain
      runtime.status = "error";
      // coverage-exempt: a database failure while restoring the old domain
      runtime.error = error instanceof Error ? error.message : String(error);
    });
}

const ROUTE_CHECK_MS = 5_000;

/** The check started when a route the household runs was last published, for tests to wait on. */
let publishCheck: Promise<unknown> = Promise.resolve();

/** The published route the household runs, enabled, read at most every five seconds. */
function openRoute(now: number): Promise<string | null> {
  const cached = runtime.routeCheck;
  if (cached && now - cached.at < ROUTE_CHECK_MS) return cached.route;
  const route = publishedRoute().then((published) => (published?.kind === RouteKind.own && published.enabled ? published.id : null));
  runtime.routeCheck = { at: now, route };
  return route;
}

/**
 * Whether the remote-access port should answer: only while Remote access publishes a route the
 * household runs (a port forward, reverse proxy, Tailscale or its own tunnel). FamilyFi's own quick
 * and domain tunnels reach the gateway on loopback instead. Read at most every five seconds.
 */
export async function householdRoutePublished(now = Date.now()): Promise<boolean> {
  return (await openRoute(now)) !== null;
}

const REACHED_WRITE_MS = 60_000;

/**
 * A request came in through the remote-access port on route `id` and the app answered it: that
 * route works. Recorded at most once a minute, so a busy phone does not write on every call; the
 * minute is claimed before the write, so a burst of answers writes once (and a failed write
 * waits for the next minute like any other).
 */
export async function noteRouteReached(id: string, now = Date.now()): Promise<void> {
  const last = runtime.reachedWrite;
  if (last?.id === id && now - last.at < REACHED_WRITE_MS) return;
  runtime.reachedWrite = { at: now, id };
  await prisma().connectionEndpoint.updateMany({ where: { id }, data: { reachedAt: new Date(now) } });
}

/**
 * The published route or its evidence changed: the port answers for the new route at once (so
 * FamilyFi's check on publish is not turned away by what was published a moment ago), and the next
 * request through it is recorded straight away.
 */
export function forgetRouteReached() {
  runtime.routeCheck = undefined;
  runtime.reachedWrite = undefined;
}

export function resetRouteCheckForTests() {
  forgetRouteReached();
}

export function publishCheckForTests(): Promise<unknown> {
  return publishCheck;
}

/**
 * The remote-access port (FAMILYFI_REMOTE_ACCESS_PORT, 7002 by default): the phone-only gateway
 * on every interface, published by the Compose file, for a route the household runs to point at.
 * Until Remote access publishes such a route it closes every connection without answering.
 */
export async function startRemoteAccessPort(port: number) {
  // Each answer is credited to the route its request was let in on, not whatever is published by then.
  const gateway = await startPhoneGateway(appPort(), { host: "0.0.0.0", port }, () => openRoute(Date.now()), (id) => void noteRouteReached(id).catch(() => undefined));
  console.log(`Remote access port ${gateway.port} answers while a route the household runs is published.`);
  return gateway;
}

/** Called once at boot: resumes the tunnel behind the route the household left published. */
export async function resumeRemoteAccess() {
  const route = await publishedRoute();
  if (!route || route.kind === RouteKind.own) return;
  runtime.wanted = route.kind;
  if (!runtime.child) await launch();
}
