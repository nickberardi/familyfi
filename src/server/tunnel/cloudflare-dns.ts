import type { OriginCert } from "./cloudflared";

/**
 * The one Cloudflare API call FamilyFi makes itself: removing the DNS record it created for a
 * tunnel. cloudflared can create a tunnel's CNAME (`tunnel route dns`) but has no command to
 * delete one, and `tunnel delete` leaves it behind.
 */
const API = "https://api.cloudflare.com/client/v4";
/** Where cloudflared sends a FedRAMP account's calls (`endpoint: "fed"` in cert.pem). */
const FED_API = "https://api.fed.cloudflare.com/client/v4";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function apiBase(cert: OriginCert): string {
  // CLOUDFLARE_API_URL is test-only: it points integration tests at a stand-in API on this machine.
  // Anything else is ignored, so a stray setting can never send the zone's token off to another host.
  const override = process.env.CLOUDFLARE_API_URL;
  if (override && LOOPBACK.has(URL.parse(override)?.hostname ?? "")) return override;
  return cert.endpoint === "fed" ? FED_API : API;
}

type Envelope<T> = { success?: boolean; result?: T; errors?: { message?: string }[] };

async function call<T>(cert: OriginCert, method: "GET" | "DELETE", pathname: string): Promise<T> {
  const response = await fetch(`${apiBase(cert)}${pathname}`, {
    method,
    headers: { authorization: `Bearer ${cert.apiToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || body.success === false) {
    throw new Error(`Cloudflare answered ${response.status}${body.errors?.[0]?.message ? `: ${body.errors[0].message}` : ""}`);
  }
  return body.result as T;
}

/**
 * Deletes every CNAME in the signed-in zone that points at `tunnelId`, and nothing else: a
 * record that points anywhere else is the household's, and is left alone. Records are found by
 * what they point at, so a forgotten hostname's record goes too. With `hostname`, a hostname
 * outside that zone is reported, since its record can't be reached from this sign-in; `only`
 * narrows the deletion to that one name. Throws when Cloudflare can't be asked.
 */
export async function deleteTunnelDnsRecords({ cert, tunnelId, hostname, only }: { cert: OriginCert; tunnelId: string; hostname?: string; only?: string }): Promise<void> {
  const zone = encodeURIComponent(cert.zoneID);
  if (hostname) {
    const { name } = await call<{ name: string }>(cert, "GET", `/zones/${zone}`);
    if (hostname !== name && !hostname.endsWith(`.${name}`)) throw new Error(`${hostname} is not in the Cloudflare zone ${name}`);
  }
  const target = `${tunnelId}.cfargotunnel.com`.toLowerCase();
  const named = only ? `&name=${encodeURIComponent(only)}` : "";
  const records = await call<{ id: string; content: string }[]>(cert, "GET", `/zones/${zone}/dns_records?type=CNAME&content=${encodeURIComponent(target)}${named}`);
  for (const record of records ?? []) {
    if (record.content?.toLowerCase() === target) await call(cert, "DELETE", `/zones/${zone}/dns_records/${encodeURIComponent(record.id)}`);
  }
}
