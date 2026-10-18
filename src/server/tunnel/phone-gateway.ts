import { createServer, request as forward, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ROUTE_CHECK_HEADER, TUNNEL_HEADER } from "@/lib/constants";

/**
 * The only thing a tunnel ever points at. It listens on loopback, passes nothing but
 * `/api/v1/*` to the app, and forwards those calls as a phone would make them: no
 * cookies, so no browser session, and marked as coming through a tunnel so sign-in can
 * demand a paired phone. Pages, the admin sign-in form and the API reference stay on
 * the home network.
 *
 * The mark can only narrow what a request may do, so a LAN client that forges it
 * gains nothing.
 */

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer"]);

export function allowedThroughTunnel(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split("?")[0];
  // Reject dot segments outright rather than trusting what normalisation downstream does with them.
  if (/(^|\/)\.\.?(\/|$)/.test(path) || /%2e|%2f|%5c/i.test(path)) return false;
  return path.startsWith("/api/v1/");
}

const EDGE_TOKEN_HEADERS = new Set(["cf-access-client-id", "cf-access-client-secret"]);

/** The headers the app sees for a tunnelled call. */
export function tunnelHeaders(incoming: IncomingHttpHeaders): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    if (name === "cookie" || name === TUNNEL_HEADER || name === ROUTE_CHECK_HEADER || name === "x-forwarded-for" || name === "x-real-ip") continue;
    // A Cloudflare Access service token is for Cloudflare alone; the app never needs it, so it can never log it.
    if (EDGE_TOKEN_HEADERS.has(name)) continue;
    headers[name] = value;
  }
  // Cloudflare overwrites CF-Connecting-IP with the real client; X-Forwarded-For only gets
  // appended to, so its first entry is whatever the client claimed. Rebuild it from
  // CF-Connecting-IP, which only Cloudflare vouches for; on a route the household runs anyone
  // can set it. The app believes it because the gateway connects over loopback, which is
  // harmless while sign-in is refused through a tunnel.
  const client = incoming["cf-connecting-ip"];
  if (typeof client === "string" && client) headers["x-forwarded-for"] = client;
  headers[TUNNEL_HEADER] = "tunnel";
  return headers;
}

/** What a browser sees at the bare tunnel address: an explanation instead of a bare 404. */
const ROOT_NOTE = [
  "This is a FamilyFi remote-access address.",
  "",
  "Open the FamilyFi app on a paired phone to use it. The FamilyFi web app is only",
  "available on your home network.",
  "",
].join("\n");

function refuse(res: ServerResponse) {
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "not_found", message: "Not available through remote access." } }));
}

/**
 * By default the gateway listens on a free loopback port for FamilyFi's own cloudflared.
 * `listen` is the remote-access port (FAMILYFI_REMOTE_ACCESS_PORT) for a route the household
 * runs: same rules, reachable from outside the container. `open` gates it: while it answers
 * nothing (false or null) the gateway closes every connection without a word, so nothing is learned
 * from it. `answered` is told each time the app answers a call that came in, with what `open`
 * admitted it on, as evidence that route works.
 */
export function startPhoneGateway<Admitted = true>(
  upstreamPort: number,
  listen: { host: string; port: number } = { host: "127.0.0.1", port: 0 },
  open?: () => Promise<Admitted | false | null>,
  answered?: (admitted: Admitted) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const admitted = open ? await open().catch(() => false as const) : (true as Admitted);
    if (admitted === false || admitted === null) {
      req.socket.destroy();
      return;
    }
    if (req.url === "/" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
      return res.end(req.method === "HEAD" ? undefined : ROOT_NOTE);
    }
    if (!allowedThroughTunnel(req.url)) return refuse(res);
    const upstream = forward(
      { host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers: tunnelHeaders(req.headers) },
      (reply) => {
        const headers = { ...reply.headers };
        delete headers["set-cookie"];
        // FamilyFi checking its own route from home is not evidence a phone can reach it from outside.
        if (!req.headers[ROUTE_CHECK_HEADER]) answered?.(admitted);
        res.writeHead(reply.statusCode ?? 502, headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "unavailable", message: "FamilyFi is starting. Try again shortly." } }));
    });
    req.pipe(upstream);
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listen.port, listen.host, () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}
