import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { clientIp, trustedProxies } from "@/server/http";

function from(forwardedFor?: string) {
  return new Request("http://familyfi.test/api/v1/auth/login", {
    headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  });
}

describe("clientIp", () => {
  const none = trustedProxies("");

  it("believes only the address that connected when that peer is not a trusted proxy", () => {
    // The last entry is the one FamilyFi's own server appends; everything before it is the client's claim.
    expect(clientIp(from("198.51.100.7, 192.0.2.10"), none)).toBe("192.0.2.10");
    expect(clientIp(from("192.0.2.10"), none)).toBe("192.0.2.10");
  });

  it("follows a trusted proxy's chain to the first address it did not add itself", () => {
    const proxies = trustedProxies("10.0.0.0/8, 2001:db8::/32");
    expect(clientIp(from("203.0.113.5, 198.51.100.7, 10.1.2.3"), proxies)).toBe("198.51.100.7");
    expect(clientIp(from("198.51.100.7, 2001:db8::1, 10.0.0.2"), proxies)).toBe("198.51.100.7");
    // Loopback is always trusted: the phone gateway and cloudflared reach the app that way.
    expect(clientIp(from("198.51.100.7, 127.0.0.1"), none)).toBe("198.51.100.7");
    expect(clientIp(from("198.51.100.7, ::ffff:127.0.0.1"), none)).toBe("198.51.100.7");
    expect(clientIp(from("198.51.100.7, ::1"), none)).toBe("198.51.100.7");
  });

  it("stops at the last trusted hop when an entry is malformed", () => {
    const proxies = trustedProxies("10.0.0.0/8");
    expect(clientIp(from("not-an-ip, 10.1.2.3"), proxies)).toBe("10.1.2.3");
    expect(clientIp(from("198.51.100.7, , 10.1.2.3"), proxies)).toBe("10.1.2.3");
    expect(clientIp(from("198.51.100.7:4433, 192.0.2.10"), none)).toBe("192.0.2.10");
    expect(clientIp(from("garbage"), none)).toBe("unknown");
    expect(clientIp(from(), none)).toBe("unknown");
  });

  it("reads IPv4-mapped addresses as IPv4", () => {
    expect(clientIp(from("::ffff:192.0.2.10"), none)).toBe("192.0.2.10");
  });

  it("leaves out FAMILYFI_TRUSTED_PROXIES entries that are not addresses or CIDRs", () => {
    const proxies = trustedProxies("10.0.0.0/33 proxy.local 10.0.0.0/8/8 192.0.2.1");
    expect(proxies.check("10.0.0.1", "ipv4")).toBe(false);
    expect(proxies.check("192.0.2.1", "ipv4")).toBe(true);
    expect(proxies.check("192.0.2.2", "ipv4")).toBe(false);
  });
});

describe("the server's forwarded-for preload", () => {
  const preload = pathToFileURL(path.resolve(__dirname, "../../scripts/runtime/forwarded-for.mjs")).href;
  // A server started with the preload echoes the X-Forwarded-For its handler sees.
  const echo = `
    import http from "node:http";
    const server = http.createServer((req, res) => res.end(req.headers["x-forwarded-for"] ?? ""));
    server.listen(0, "127.0.0.1", async () => {
      const url = "http://127.0.0.1:" + server.address().port + "/";
      const claimed = await fetch(url, { headers: { "x-forwarded-for": "198.51.100.7" } }).then((r) => r.text());
      const bare = await fetch(url).then((r) => r.text());
      console.log(JSON.stringify({ claimed, bare }));
      server.close();
    });
  `;

  it("appends the address that connected, after whatever the client claimed", () => {
    const output = execFileSync(process.execPath, [`--import=${preload}`, "--input-type=module", "-e", echo], { encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({ claimed: "198.51.100.7, 127.0.0.1", bare: "127.0.0.1" });
  });
});
