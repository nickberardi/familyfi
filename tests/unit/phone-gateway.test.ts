import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TUNNEL_HEADER } from "@/lib/constants";
import { allowedThroughTunnel, startPhoneGateway, tunnelHeaders } from "@/server/tunnel/phone-gateway";
import { quickTunnelUrl, tunnelError } from "@/server/tunnel/cloudflared";

describe("phone-only gateway rules", () => {
  it("passes the app's API and nothing else", () => {
    expect(allowedThroughTunnel("/api/v1/connection/identity")).toBe(true);
    expect(allowedThroughTunnel("/api/v1/groups?x=1")).toBe(true);
    for (const path of ["/", "/login", "/phones", "/reference", "/openapi", "/_next/static/x.js", "/api/v2/x", "/api/v1", undefined]) {
      expect(allowedThroughTunnel(path)).toBe(false);
    }
  });

  it("refuses dot segments and encoded separators instead of trusting later normalisation", () => {
    expect(allowedThroughTunnel("/api/v1/../../login")).toBe(false);
    expect(allowedThroughTunnel("/api/v1/%2e%2e/login")).toBe(false);
    expect(allowedThroughTunnel("/api/v1/x%2F..%2Fy")).toBe(false);
  });

  it("drops cookies and client-claimed forwarding, keeps Cloudflare's client address, and marks the call", () => {
    const headers = tunnelHeaders({
      cookie: "familyfi_session=abc",
      authorization: "Bearer t",
      "x-forwarded-for": "6.6.6.6",
      "x-real-ip": "6.6.6.6",
      [TUNNEL_HEADER]: "lan",
      "cf-connecting-ip": "203.0.113.9",
      connection: "keep-alive",
    });
    expect(headers.cookie).toBeUndefined();
    expect(headers.connection).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBe("203.0.113.9");
    expect(headers.authorization).toBe("Bearer t");
    expect(headers[TUNNEL_HEADER]).toBe("tunnel");
  });
});

describe("phone-only gateway", () => {
  let app: Server;
  let gateway: Server;
  let port: number;
  const seen: { url?: string; headers: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    app = createServer((req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      res.setHeader("set-cookie", "familyfi_session=leak");
      res.end("ok");
    });
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    const started = await startPhoneGateway((app.address() as AddressInfo).port);
    gateway = started.server;
    port = started.port;
  });

  afterAll(async () => {
    await new Promise((resolve) => gateway.close(resolve));
    await new Promise((resolve) => app.close(resolve));
  });

  function get(path: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: string; setCookie: unknown }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, setCookie: res.headers["set-cookie"] }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  it("listens on loopback only", () => {
    expect((gateway.address() as AddressInfo).address).toBe("127.0.0.1");
  });

  it("forwards an API call marked as tunnelled, without the cookie either way", async () => {
    const result = await get("/api/v1/connection/identity", { cookie: "familyfi_session=abc" });
    expect(result).toMatchObject({ status: 200, body: "ok", setCookie: undefined });
    const last = seen.at(-1)!;
    expect(last.url).toBe("/api/v1/connection/identity");
    expect(last.headers.cookie).toBeUndefined();
    expect(last.headers[TUNNEL_HEADER]).toBe("tunnel");
  });

  it("never reaches the app for a page", async () => {
    const before = seen.length;
    expect((await get("/login")).status).toBe(404);
    expect(seen.length).toBe(before);
  });
});

describe("cloudflared log parsing", () => {
  it("finds the quick tunnel address in cloudflared's banner", () => {
    const banner = [
      "2026-09-23T18:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...",
      "2026-09-23T18:00:01Z INF +--------------------------------------------------------------------------------------------+",
      "2026-09-23T18:00:01Z INF |  https://quiet-river-demo-harbor.trycloudflare.com                                          |",
    ].join("\n");
    expect(quickTunnelUrl(banner)).toBe("https://quiet-river-demo-harbor.trycloudflare.com");
    expect(quickTunnelUrl("2026-09-23T18:00:00Z INF Starting tunnel")).toBeNull();
  });

  it("surfaces the first error line", () => {
    expect(tunnelError("2026-09-23T18:00:00Z ERR failed to request quick Tunnel: 429 Too Many Requests\n")).toBe(
      "failed to request quick Tunnel: 429 Too Many Requests",
    );
    expect(tunnelError("2026-09-23T18:00:00Z INF fine")).toBeNull();
  });
});
