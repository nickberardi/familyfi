import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteTunnelDnsRecords } from "@/server/tunnel/cloudflare-dns";
import { parseOriginCert, type OriginCert } from "@/server/tunnel/cloudflared";

const TUNNEL = "11111111-2222-3333-4444-555555555555";

/** cert.pem as `cloudflared tunnel login` writes it: one PEM block of base64 JSON. */
function certPem(token: unknown, type = "ARGO TUNNEL TOKEN") {
  const body = Buffer.from(typeof token === "string" ? token : JSON.stringify(token)).toString("base64").replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${type}-----\n${body}\n-----END ${type}-----\n`;
}

describe("parseOriginCert", () => {
  it("reads the zone, account and API token from the ARGO TUNNEL TOKEN block", () => {
    const pem = certPem({ zoneID: "zone-1", accountID: "acct", apiToken: "a".repeat(120), endpoint: "FED" });
    expect(parseOriginCert(pem)).toEqual({ zoneID: "zone-1", accountID: "acct", apiToken: "a".repeat(120), endpoint: "fed" });
    // Older certificates carry legacy blocks beside the token.
    expect(parseOriginCert(`${certPem("legacy", "PRIVATE KEY")}${certPem({ zoneID: "zone-1", apiToken: "t" })}`)).toEqual({ zoneID: "zone-1", accountID: "", apiToken: "t", endpoint: "" });
  });

  it("refuses a certificate without a readable token, never echoing its contents", () => {
    for (const pem of ["", certPem({ zoneID: "zone-1" }), certPem("not json secret-ish"), certPem({ zoneID: "zone-1", apiToken: "t" }, "CERTIFICATE")]) {
      expect(() => parseOriginCert(pem)).toThrow("The Cloudflare sign-in certificate has no API token FamilyFi can read.");
    }
  });
});

describe("deleteTunnelDnsRecords", () => {
  const cert: OriginCert = { zoneID: "zone-1", accountID: "acct", apiToken: "zone-token", endpoint: "" };
  const saved = process.env.CLOUDFLARE_API_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.CLOUDFLARE_API_URL;
    else process.env.CLOUDFLARE_API_URL = saved;
  });

  /** Answers like the Cloudflare API for zone example.com holding `records`, and logs each call. */
  function cloudflare(records: { id: string; content: string }[], status = 200) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url} ${(init.headers as Record<string, string>).authorization}`);
        if (status !== 200) return new Response("<html>bad gateway</html>", { status });
        const result = url.endsWith("/zones/zone-1") ? { name: "example.com" } : init.method === "GET" ? records : {};
        return Response.json({ success: true, result });
      }),
    );
    return calls;
  }

  it("deletes only the CNAME that points at the tunnel", async () => {
    delete process.env.CLOUDFLARE_API_URL;
    const calls = cloudflare([
      { id: "ours", content: `${TUNNEL.toUpperCase()}.cfargotunnel.com` },
      { id: "theirs", content: "elsewhere.example.net" },
    ]);
    await deleteTunnelDnsRecords({ cert, hostname: "familyfi.example.com", tunnelId: TUNNEL });
    expect(calls).toEqual([
      "GET https://api.cloudflare.com/client/v4/zones/zone-1 Bearer zone-token",
      `GET https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?type=CNAME&content=${TUNNEL}.cfargotunnel.com Bearer zone-token`,
      "DELETE https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/ours Bearer zone-token",
    ]);
  });

  it("finds records by the tunnel they point at when no hostname is known", async () => {
    delete process.env.CLOUDFLARE_API_URL;
    const calls = cloudflare([{ id: "forgotten", content: `${TUNNEL}.cfargotunnel.com` }]);
    await deleteTunnelDnsRecords({ cert, tunnelId: TUNNEL });
    expect(calls.map((call) => call.split(" ")[0] + " " + new URL(call.split(" ")[1]).pathname)).toEqual(["GET /client/v4/zones/zone-1/dns_records", "DELETE /client/v4/zones/zone-1/dns_records/forgotten"]);
  });

  it("sends the zone token only to Cloudflare, or a stand-in API on this machine", async () => {
    process.env.CLOUDFLARE_API_URL = "https://cloudflare.example.net/client/v4";
    const calls = cloudflare([]);
    await deleteTunnelDnsRecords({ cert, tunnelId: TUNNEL });
    process.env.CLOUDFLARE_API_URL = "http://127.0.0.1:9";
    await deleteTunnelDnsRecords({ cert, tunnelId: TUNNEL });
    expect(calls.map((call) => new URL(call.split(" ")[1]).origin)).toEqual(["https://api.cloudflare.com", "http://127.0.0.1:9"]);
  });

  it("uses Cloudflare's FedRAMP API for a FedRAMP account, as cloudflared does", async () => {
    delete process.env.CLOUDFLARE_API_URL;
    const calls = cloudflare([]);
    await deleteTunnelDnsRecords({ cert: { ...cert, endpoint: "fed" }, hostname: "example.com", tunnelId: TUNNEL });
    expect(calls[0]).toBe("GET https://api.fed.cloudflare.com/client/v4/zones/zone-1 Bearer zone-token");
  });

  it("refuses a hostname outside the zone the person signed in to", async () => {
    const calls = cloudflare([{ id: "ours", content: `${TUNNEL}.cfargotunnel.com` }]);
    await expect(deleteTunnelDnsRecords({ cert, hostname: "familyfi.notexample.com", tunnelId: TUNNEL })).rejects.toThrow("familyfi.notexample.com is not in the Cloudflare zone example.com");
    expect(calls).toHaveLength(1);
  });

  it("reports a failed call with its status", async () => {
    cloudflare([], 502);
    await expect(deleteTunnelDnsRecords({ cert, hostname: "familyfi.example.com", tunnelId: TUNNEL })).rejects.toThrow("Cloudflare answered 502");
  });
});
