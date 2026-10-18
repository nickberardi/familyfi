// Preloaded into the server by with-env.mjs (`--import`), so FamilyFi's own process is the last hop
// on X-Forwarded-For. Next.js fills the header from the socket only when a request has none, so a
// client that sends one would otherwise hide its address entirely. Appending the address that
// actually connected gives clientIp (src/server/http.ts) one entry nobody can forge; it trusts the
// entries before it only when that peer is a proxy the household named.
import http from "node:http";
import https from "node:https";

/** Appends the socket peer to `req`'s X-Forwarded-For, as a proxy would. */
export function appendPeer(req) {
  const peer = req.socket?.remoteAddress;
  if (!peer) return;
  const forwarded = req.headers["x-forwarded-for"];
  req.headers["x-forwarded-for"] = forwarded ? `${forwarded}, ${peer}` : peer;
}

for (const Server of [http.Server, https.Server]) {
  const emit = Server.prototype.emit;
  Server.prototype.emit = function (event, ...args) {
    if (event === "request") appendPeer(args[0]);
    return emit.call(this, event, ...args);
  };
}
