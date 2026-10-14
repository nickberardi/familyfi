/**
 * What FamilyFi tells an operator about its own load on the UniFi console: every request
 * the real client sends is counted by endpoint for the last few minutes, logged as one line,
 * and a self-signed console's TLS connection is reused rather than negotiated per request.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HttpUnifiClient } from "@/server/unifi/client";
import {
  REQUEST_WINDOW_MS,
  endpointTemplate,
  recordUnifiRequest,
  resetUnifiRequestMeterForTests,
  startUnifiRequestLog,
  unifiRequestLoad,
  unifiRequestSummary,
} from "@/server/unifi/request-meter";

const SITE = "11111111-1111-4111-8111-111111111111";
const BASE = "https://10.0.0.1/proxy/network/integration";

afterEach(() => {
  resetUnifiRequestMeterForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("UniFi request meter", () => {
  it("names an endpoint without its ids or query", () => {
    expect(endpointTemplate("get", `/v1/sites/${SITE}/clients?offset=0&limit=200`)).toBe("GET /v1/sites/{id}/clients");
    expect(endpointTemplate("PUT", `/v1/sites/${SITE}/firewall/policies/0123456789abcdef01234567`)).toBe(
      "PUT /v1/sites/{id}/firewall/policies/{id}",
    );
    expect(endpointTemplate("GET", "/v1/info")).toBe("GET /v1/info");
  });

  it("counts requests, failures and latency by endpoint over the window, busiest first", () => {
    const now = 1_000_000;
    recordUnifiRequest("GET", "/v1/info", 10, true, now - REQUEST_WINDOW_MS - 1);
    recordUnifiRequest("GET", `/v1/sites/${SITE}/clients`, 100, true, now - 1000);
    recordUnifiRequest("GET", `/v1/sites/${SITE}/clients`, 301, false, now - 500);
    recordUnifiRequest("GET", `/v1/sites/${SITE}/networks`, 20, true, now);
    expect(unifiRequestLoad(now)).toEqual({
      windowSec: REQUEST_WINDOW_MS / 1000,
      total: 3,
      errors: 1,
      endpoints: [
        { endpoint: "GET /v1/sites/{id}/clients", count: 2, errors: 1, averageMs: 201, maxMs: 301 },
        { endpoint: "GET /v1/sites/{id}/networks", count: 1, errors: 0, averageMs: 20, maxMs: 20 },
      ],
    });
  });

  it("summarises the window in one line, and says nothing when there was no traffic", () => {
    expect(unifiRequestSummary(unifiRequestLoad())).toBeNull();
    recordUnifiRequest("GET", `/v1/sites/${SITE}/clients`, 40, true);
    expect(unifiRequestSummary(unifiRequestLoad())).toMatch(/^UniFi requests, last 5 min: 1 \(0\.2\/min, 0 failed\)\. GET \/v1\/sites\/\{id\}\/clients ×1 avg 40ms$/);
  });

  it("logs the summary every window while there is traffic", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    startUnifiRequestLog();
    startUnifiRequestLog();
    await vi.advanceTimersByTimeAsync(REQUEST_WINDOW_MS);
    expect(log).not.toHaveBeenCalled();
    recordUnifiRequest("GET", "/v1/info", 5, true);
    await vi.advanceTimersByTimeAsync(REQUEST_WINDOW_MS);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("counts every request the real client sends, whether it worked or not", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const failing = String(input).includes("/statistics/latest");
      return new Response(failing ? "{}" : JSON.stringify({ data: [], count: 0, offset: 0, limit: 200, totalCount: 0 }), {
        status: failing ? 404 : 200,
      });
    }) as typeof fetch;
    const client = new HttpUnifiClient({ apiKey: "meter-test-key", baseUrl: BASE, fetchImpl });
    await client.listSiteDevices(SITE);
    await expect(client.getDeviceStatistics(SITE, "77777777-7777-4777-8777-777777777770")).rejects.toThrow();
    expect(unifiRequestLoad().endpoints.map(({ endpoint, count, errors }) => ({ endpoint, count, errors }))).toEqual([
      { endpoint: "GET /v1/sites/{id}/devices", count: 1, errors: 0 },
      { endpoint: "GET /v1/sites/{id}/devices/{id}/statistics/latest", count: 1, errors: 1 },
    ]);
  });
});

describe("a console with a self-signed certificate", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "familyfi-unifi-tls-"));
  let server: Server;
  let origin: string;
  let handshakes = 0;

  beforeAll(async () => {
    // Minted per run so no private key is ever committed.
    const base = path.join(dir, "console");
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=familyfi.test", "-keyout", `${base}.key`, "-out", `${base}.pem`], { stdio: "ignore" });
    server = createServer({ cert: readFileSync(`${base}.pem`), key: readFileSync(`${base}.key`) }, (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ applicationVersion: "10.0.0" }));
    });
    server.on("secureConnection", () => (handshakes += 1));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("is asked over one kept-alive connection, not a new handshake per request", async () => {
    const baseUrl = `${origin}/proxy/network/integration`;
    // Each household read builds a new client; the connection still carries over.
    for (let i = 0; i < 3; i += 1) {
      await expect(new HttpUnifiClient({ apiKey: "tls-test-key", baseUrl, tlsInsecure: true }).getInfo()).resolves.toEqual({ applicationVersion: "10.0.0" });
      // Let the finished response hand its connection back to the pool, as it has between real reads.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(handshakes).toBe(1);
  });
});
