import { createSocket } from "node:dgram";
import { isIP, Socket } from "node:net";
import { decodeResponse, encodeQuery, type DnsResponse } from "./dns-message";
import { wireResolver, type WireResolver } from "./doh";

function udpQuery(server: string, port: number, packet: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(isIP(server) === 6 ? "udp6" : "udp4");
    let settled = false;
    const finish = (error?: Error, data?: Uint8Array) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(data!);
    };
    const timer = setTimeout(() => finish(new Error("DNS UDP timeout.")), timeoutMs);
    socket.on("error", (error) => finish(error));
    socket.on("message", (message) => finish(undefined, message));
    socket.connect(port, server, () => socket.send(packet, (error) => { if (error) finish(error); }));
  });
}

function tcpQuery(server: string, port: number, packet: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let settled = false;
    let expected = 0;
    const finish = (error?: Error, data?: Uint8Array) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(data!);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("DNS TCP timeout.")));
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(new Error("DNS TCP reply ended early.")));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (bytes.length >= 2 && expected === 0) expected = bytes.readUInt16BE(0);
      if (expected > 0 && bytes.length >= expected + 2) finish(undefined, bytes.subarray(2, expected + 2));
    });
    socket.connect(port, server, () => {
      const frame = Buffer.allocUnsafe(packet.length + 2);
      frame.writeUInt16BE(packet.length, 0);
      frame.set(packet, 2);
      socket.write(frame);
    });
  });
}

/** RFC 1035 UDP with RFC 7766 TCP fallback only for a truncated response. */
export function plainDnsResolver(input: {
  server: string;
  timeoutMs: number;
  /** A local test resolver can bind an unprivileged port; production uses DNS port 53. */
  port?: number;
  exchange?: (server: string, packet: Uint8Array, timeoutMs: number, tcp: boolean) => Promise<Uint8Array>;
}): WireResolver {
  if (!isIP(input.server)) throw new Error("DHCP DNS server is not an IP address.");
  const exchange = input.exchange ?? ((server, packet, timeout, tcp) =>
    tcp ? tcpQuery(server, input.port ?? 53, packet, timeout) : udpQuery(server, input.port ?? 53, packet, timeout));
  return wireResolver(async (domain, type): Promise<DnsResponse> => {
    const id = Math.floor(Math.random() * 0x10000);
    const packet = encodeQuery(domain, type, id);
    let bytes = await exchange(input.server, packet, input.timeoutMs, false);
    if (bytes.length < 4) throw new Error("DNS reply shorter than its header.");
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (header.getUint16(0) !== id) throw new Error("Response id did not match the query.");
    if (header.getUint16(2) & 0x0200) bytes = await exchange(input.server, packet, input.timeoutMs, true);
    const response = decodeResponse(bytes);
    if (response.id !== id) throw new Error("Response id did not match the query.");
    return response;
  });
}
