import { describe, expect, it } from "vitest";
import { createSocket, type Socket } from "node:dgram";
import { createServer, type Server } from "node:net";
import { discoveredNetwork } from "@/server/upstream/discovery";
import { plainDnsResolver } from "@/server/upstream/plain-dns";

const network = {
  id: "network-1", name: "Kids", enabled: true,
  ipv4Configuration: { hostIpAddress: "192.0.2.1", dhcpConfiguration: { mode: "SERVER" } },
};

function reply(query: Uint8Array, flags: number): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, new DataView(query.buffer, query.byteOffset, query.byteLength).getUint16(0));
  view.setUint16(2, flags);
  return bytes;
}

/**
 * A UDP socket from `makeUdp` and `tcp` listening on one free loopback port. The port picked for UDP
 * can already be taken for TCP by another process on a shared runner, so a taken port is tried again.
 */
async function listenOnOnePort(makeUdp: () => Socket, tcp: Server): Promise<{ udp: Socket; port: number }> {
  for (let attempt = 1; ; attempt += 1) {
    const udp = makeUdp();
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
    const port = udp.address().port;
    const listened = await new Promise<boolean>((resolve) => {
      const taken = () => resolve(false);
      tcp.once("error", taken);
      tcp.listen(port, "127.0.0.1", () => {
        tcp.off("error", taken);
        resolve(true);
      });
    });
    if (listened) return { udp, port };
    await new Promise<void>((resolve) => udp.close(resolve));
    if (attempt === 10) throw new Error("no loopback port was free for both UDP and TCP");
  }
}

/** A UDP server that answers every query truncated, sending the resolver on to TCP. */
function truncatingUdp(): Socket {
  const udp = createSocket("udp4");
  udp.on("message", (query, peer) => udp.send(reply(query, 0x8200), peer.port, peer.address));
  return udp;
}

describe("DHCP resolver discovery", () => {
  it("uses the gateway for automatic DNS and every explicit server", () => {
    expect(discoveredNetwork(network).servers).toEqual(["192.0.2.1"]);
    expect(discoveredNetwork({ ...network, ipv4Configuration: {
      ...network.ipv4Configuration,
      dhcpConfiguration: { mode: "SERVER", dnsServerIpAddressesOverride: ["192.0.2.53", "198.51.100.53"] },
    } }).servers).toEqual(["192.0.2.53", "198.51.100.53"]);
  });

  it("does not guess in relay, absent DHCP, or invalid address states", () => {
    expect(discoveredNetwork({ ...network, ipv4Configuration: {
      ...network.ipv4Configuration, dhcpConfiguration: { mode: "RELAY" },
    } }).reason).toMatch(/relay/i);
    expect(discoveredNetwork({ ...network, ipv4Configuration: { hostIpAddress: "192.0.2.1" } }).servers).toEqual([]);
    expect(discoveredNetwork({ ...network, ipv4Configuration: {
      ...network.ipv4Configuration, dhcpConfiguration: { mode: "SERVER", dnsServerIpAddressesOverride: ["bad"] },
    } }).reason).toMatch(/invalid/i);
  });
});

describe("plain DNS", () => {
  it("exchanges a real UDP query with a local DNS server", async () => {
    const server = createSocket("udp4");
    let queries = 0;
    server.on("message", (query, peer) => {
      queries += 1;
      server.send(reply(query, 0x8183), peer.port, peer.address);
    });
    try {
      await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", resolve));
      const port = server.address().port;
      const result = await plainDnsResolver({ server: "127.0.0.1", port, timeoutMs: 1000 })("example.com");
      expect(result.blocked).toBe(true);
      expect(queries).toBe(1); // NXDOMAIN settles the name without an AAAA query.
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it("retries a truncated UDP reply over a framed TCP connection", async () => {
    const tcp = createServer((socket) => {
      let frame = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        frame = Buffer.concat([frame, Buffer.from(chunk)]);
        if (frame.length < 2 || frame.length < frame.readUInt16BE(0) + 2) return;
        const response = Buffer.from(reply(frame.subarray(2), 0x8183));
        const header = Buffer.alloc(2);
        header.writeUInt16BE(response.length);
        socket.end(Buffer.concat([header, response]));
      });
    });
    let tcpQueries = 0;
    tcp.on("connection", () => { tcpQueries += 1; });
    const { udp, port } = await listenOnOnePort(truncatingUdp, tcp);
    try {
      const result = await plainDnsResolver({ server: "127.0.0.1", port, timeoutMs: 1000 })("example.com");
      expect(result.blocked).toBe(true);
      expect(tcpQueries).toBe(1);
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => udp.close(resolve)),
        new Promise<void>((resolve) => tcp.close(() => resolve())),
      ]);
    }
  });

  it("reports a UDP timeout as unknown", async () => {
    const server = createSocket("udp4");
    try {
      await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", resolve));
      const result = await plainDnsResolver({ server: "127.0.0.1", port: server.address().port, timeoutMs: 100 })("example.com");
      expect(result).toMatchObject({ blocked: null, error: "DNS UDP timeout." });
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  it("reports an early TCP close as unknown after UDP truncation", async () => {
    const tcp = createServer((socket) => {
      socket.once("data", () => socket.end(Buffer.from([0])));
    });
    const { udp, port } = await listenOnOnePort(truncatingUdp, tcp);
    try {
      const result = await plainDnsResolver({ server: "127.0.0.1", port, timeoutMs: 1000 })("example.com");
      expect(result).toMatchObject({ blocked: null, error: "DNS TCP reply ended early." });
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => udp.close(resolve)),
        new Promise<void>((resolve) => tcp.close(() => resolve())),
      ]);
    }
  });

  it("uses UDP then TCP after truncation and applies the same blocked verdict", async () => {
    const transports: boolean[] = [];
    const resolve = plainDnsResolver({ server: "192.0.2.53", timeoutMs: 100,
      exchange: async (_server, packet, _timeout, tcp) => {
        transports.push(tcp);
        return reply(packet, tcp ? 0x8183 : 0x8200);
      },
    });
    const result = await resolve("example.com");
    expect(result.blocked).toBe(true);
    expect(transports).toEqual([false, true]);
  });

  it("treats a transport failure as unknown", async () => {
    const resolve = plainDnsResolver({ server: "192.0.2.53", timeoutMs: 100,
      exchange: async () => { throw new Error("unreachable"); },
    });
    expect(await resolve("example.com")).toMatchObject({ blocked: null, error: "unreachable" });
  });
});
