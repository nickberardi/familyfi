import { request } from "node:http";
import { isIP } from "node:net";
import { connect, type TLSSocket } from "node:tls";
import { ROUTE_CHECK_HEADER } from "@/lib/constants";
import { ConnectionTrustMode, RouteCheckResult, type ConnectionEndpoint } from "@prisma/client";
import { ensureConnectionIdentity, httpsOrigin } from "../connection";
import { prisma } from "../db";
import { storedServiceToken } from "../edge-auth";
import { spkiSha256 } from "../spki";

/** What Pair Device knows about whether a route the household runs works. */
export type RouteReachability = {
  /** The last request that came in through the route. */
  reachedAt: string | null;
  /** FamilyFi's own last check of the route, from home. */
  checkedAt: string | null;
  result: "reached" | "failed" | null;
  message: string | null;
};

type CheckedRoute = Pick<ConnectionEndpoint, "url" | "trustMode" | "spkiSha256"> & Parameters<typeof storedServiceToken>[0];

export function reachabilityOf(route: Pick<ConnectionEndpoint, "reachedAt" | "checkedAt" | "checkResult" | "checkMessage">): RouteReachability {
  return {
    reachedAt: route.reachedAt?.toISOString() ?? null,
    checkedAt: route.checkedAt?.toISOString() ?? null,
    result: route.checkResult,
    message: route.checkMessage,
  };
}

/** Clears a route's evidence, for when it is published again or changed: what was true before may not be now. */
export const NO_EVIDENCE = { reachedAt: null, checkedAt: null, checkResult: null, checkMessage: null } as const;

class Unreached extends Error {}

/** Why a connection failed, as Pair Device says it. */
function connectionError(error: NodeJS.ErrnoException, address: string, host: string): string {
  if (error instanceof Unreached) return error.message;
  if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") return `FamilyFi could not resolve ${host}.`;
  if (error.code === "ECONNREFUSED") return `Nothing at ${address} accepted the connection.`;
  if (/CERT|SELF_SIGNED|UNABLE_TO|ERR_TLS/.test(error.code ?? "")) return `${address} serves a certificate phones won't trust (${error.code}).`;
  return `FamilyFi could not reach ${address} (${error.code ?? error.message}).`;
}

/**
 * The TLS connection a phone would make: the system's certificate check, or for a pinned route its
 * key alone, as phones trust it, whatever the chain. Nothing is sent until the route is trusted.
 */
function trustedSocket(url: URL, pinned: string | null, ca: string | undefined, timeoutMs: number): Promise<TLSSocket> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: Number(url.port || 443), servername: isIP(host) ? undefined : host, ca, rejectUnauthorized: !pinned, ALPNProtocols: ["http/1.1"] });
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => fail(new Unreached(`No answer from ${url.host} within ${timeoutMs / 1000} seconds.`)));
    socket.once("error", fail);
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerX509Certificate();
      if (pinned && (!certificate || spkiSha256(certificate) !== pinned)) return fail(new Unreached(`${url.host} serves a certificate that doesn't match the pinned one.`));
      socket.removeListener("error", fail);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

/**
 * Asks the route for this household's identity, as a phone would: with the route's own trust (the
 * system's certificate check or its pinned key) and its Cloudflare Access token when one guards it.
 * It counts as reached only when the answer is this household's instance, so a proxy pointed at
 * something else, a sign-in page or a redirect is not mistaken for home. The token goes only to the
 * route's own address, once it is trusted, and is never returned.
 */
export async function reachRoute(route: CheckedRoute, { timeoutMs = 5000, ca }: { timeoutMs?: number; ca?: string } = {}): Promise<{ ok: boolean; message: string | null }> {
  let url: URL;
  try {
    url = httpsOrigin(route.url);
  } catch {
    return { ok: false, message: "This route's address is not an HTTPS origin." };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const pinned = route.trustMode === ConnectionTrustMode.pinned ? route.spkiSha256 : null;
  const instanceId = (await ensureConnectionIdentity()).instanceId;
  const started = Date.now();
  let socket: TLSSocket;
  try {
    socket = await trustedSocket(url, pinned, ca, timeoutMs);
  } catch (error) {
    return { ok: false, message: connectionError(error as NodeJS.ErrnoException, url.host, host) };
  }
  const token = storedServiceToken(route);
  return new Promise((resolve) => {
    const done = (ok: boolean, message: string | null) => {
      req.destroy();
      socket.destroy();
      resolve({ ok, message });
    };
    const req = request(
      {
        host: url.host,
        path: "/api/v1/connection/identity",
        method: "GET",
        headers: { host: url.host, accept: "application/json", [ROUTE_CHECK_HEADER]: "1", ...(token ? { "cf-access-client-id": token.clientId, "cf-access-client-secret": token.clientSecret } : {}) },
        createConnection: () => socket,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return done(false, `${url.host} answered with HTTP ${res.statusCode}${res.statusCode && res.statusCode >= 300 && res.statusCode < 400 ? ", a redirect phones can't follow" : ""}.`);
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 64_000) done(false, `${url.host} answered with something other than FamilyFi.`);
        });
        res.on("end", () => {
          let answered: unknown;
          try {
            answered = (JSON.parse(body) as { instanceId?: unknown }).instanceId;
          } catch {
            answered = undefined;
          }
          if (answered === instanceId) return done(true, null);
          done(false, typeof answered === "string" ? `${url.host} answered as a different FamilyFi.` : `${url.host} answered with something other than FamilyFi.`);
        });
      },
    );
    req.setTimeout(Math.max(1, timeoutMs - (Date.now() - started)), () => done(false, `No answer from ${url.host} within ${timeoutMs / 1000} seconds.`));
    req.once("error", (error: NodeJS.ErrnoException) => done(false, connectionError(error, url.host, host)));
    req.end();
  });
}

/**
 * Checks a route and records what was found on it, unless the route changed address, trust or
 * Access token meanwhile: that change cleared its evidence, and this check was of the old route.
 */
export async function checkRoute(id: string, options?: Parameters<typeof reachRoute>[1]): Promise<RouteReachability | null> {
  const route = await prisma().connectionEndpoint.findUnique({ where: { id } });
  if (!route) return null;
  const { ok, message } = await reachRoute(route, options);
  const { url, trustMode, spkiSha256, edgeAuth, edgeTokenVersion } = route;
  await prisma().connectionEndpoint.updateMany({
    where: { id, url, trustMode, spkiSha256, edgeAuth, edgeTokenVersion },
    data: { checkedAt: new Date(), checkResult: ok ? RouteCheckResult.reached : RouteCheckResult.failed, checkMessage: message },
  });
  const now = await prisma().connectionEndpoint.findUnique({ where: { id } });
  return now ? reachabilityOf(now) : null;
}
