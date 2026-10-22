/**
 * Public DNS services a device can use instead of the gateway, which Lock DNS blocks. Client-safe:
 * the rule's page names them, and the server writes their addresses and host names into the Lock
 * DNS policies. A seed that ships with each release, never runtime data.
 *
 * Each service is listed by the addresses its plain, TLS and HTTPS resolvers answer on, and by the
 * host names a device looks up to reach its DNS over HTTPS or TLS. An address is a whole subnet
 * only where the service owns it for DNS alone. Ports 53 and 853 are blocked to every address on
 * the internet anyway; the addresses here are for DNS over HTTPS on 443, which looks like any other
 * web traffic, and the host names catch a service whose addresses are not listed.
 *
 * Blocking a host name blocks its subdomains too, so `cloudflare-dns.com` covers
 * `mozilla.cloudflare-dns.com` and `chrome.cloudflare-dns.com`.
 */

export type EncryptedDnsService = {
  name: string;
  /** IPv4 addresses, or subnets in CIDR notation. */
  ipv4: readonly string[];
  /** IPv6 addresses, or subnets in CIDR notation. */
  ipv6: readonly string[];
  hosts: readonly string[];
};

export const ENCRYPTED_DNS_SERVICES: readonly EncryptedDnsService[] = [
  {
    name: "Cloudflare",
    ipv4: ["1.1.1.1", "1.0.0.1", "1.1.1.2", "1.0.0.2", "1.1.1.3", "1.0.0.3"],
    ipv6: [
      "2606:4700:4700::1111",
      "2606:4700:4700::1001",
      "2606:4700:4700::1112",
      "2606:4700:4700::1002",
      "2606:4700:4700::1113",
      "2606:4700:4700::1003",
    ],
    hosts: ["cloudflare-dns.com", "one.one.one.one"],
  },
  {
    name: "Google",
    ipv4: ["8.8.8.8", "8.8.4.4"],
    ipv6: ["2001:4860:4860::8888", "2001:4860:4860::8844"],
    hosts: ["dns.google", "dns.google.com"],
  },
  {
    name: "Quad9",
    ipv4: ["9.9.9.9", "149.112.112.112", "9.9.9.10", "149.112.112.10", "9.9.9.11", "149.112.112.11"],
    ipv6: ["2620:fe::fe", "2620:fe::9", "2620:fe::10", "2620:fe::fe:10", "2620:fe::11", "2620:fe::fe:11"],
    hosts: ["dns.quad9.net", "dns9.quad9.net", "dns10.quad9.net", "dns11.quad9.net"],
  },
  {
    name: "OpenDNS",
    ipv4: ["208.67.222.222", "208.67.220.220", "208.67.222.123", "208.67.220.123"],
    ipv6: ["2620:119:35::35", "2620:119:53::53", "2620:119:35::123", "2620:119:53::123"],
    hosts: ["doh.opendns.com", "doh.familyshield.opendns.com", "dns.umbrella.com"],
  },
  {
    name: "NextDNS",
    ipv4: ["45.90.28.0/24", "45.90.30.0/24"],
    ipv6: ["2a07:a8c0::/32", "2a07:a8c1::/32"],
    hosts: ["dns.nextdns.io"],
  },
  {
    name: "AdGuard",
    ipv4: ["94.140.14.14", "94.140.15.15", "94.140.14.15", "94.140.15.16", "94.140.14.140", "94.140.14.141"],
    ipv6: ["2a10:50c0::ad1:ff", "2a10:50c0::ad2:ff", "2a10:50c0::bad1:ff", "2a10:50c0::bad2:ff", "2a10:50c0::1:ff", "2a10:50c0::2:ff"],
    hosts: ["dns.adguard-dns.com", "family.adguard-dns.com", "unfiltered.adguard-dns.com", "dns.adguard.com"],
  },
  {
    name: "CleanBrowsing",
    ipv4: ["185.228.168.9", "185.228.169.9", "185.228.168.10", "185.228.169.11", "185.228.168.168", "185.228.169.168"],
    ipv6: ["2a0d:2a00:1::2", "2a0d:2a00:2::2", "2a0d:2a00:1::1", "2a0d:2a00:2::1", "2a0d:2a00:1::", "2a0d:2a00:2::"],
    hosts: ["doh.cleanbrowsing.org"],
  },
  {
    name: "Control D",
    ipv4: ["76.76.2.0/24", "76.76.10.0/24"],
    ipv6: ["2606:1a40::/48", "2606:1a40:1::/48"],
    hosts: ["dns.controld.com", "freedns.controld.com"],
  },
  {
    name: "Mullvad",
    ipv4: ["194.242.2.2", "194.242.2.3", "194.242.2.4", "194.242.2.5", "194.242.2.6", "194.242.2.9"],
    ipv6: ["2a07:e340::2", "2a07:e340::3", "2a07:e340::4", "2a07:e340::5", "2a07:e340::6", "2a07:e340::9"],
    hosts: ["dns.mullvad.net"],
  },
  {
    name: "DNS.SB",
    ipv4: ["185.222.222.222", "45.11.45.11"],
    ipv6: ["2a09::", "2a11::"],
    hosts: ["doh.dns.sb", "doh.sb"],
  },
  {
    name: "AliDNS",
    ipv4: ["223.5.5.5", "223.6.6.6"],
    ipv6: ["2400:3200::1", "2400:3200:baba::1"],
    hosts: ["dns.alidns.com"],
  },
  {
    name: "Wikimedia DNS",
    ipv4: ["185.71.138.138"],
    ipv6: ["2001:67c:930::1"],
    hosts: ["wikimedia-dns.org"],
  },
];

/** Every service's addresses of one IP version, deduplicated and sorted. */
export function encryptedDnsAddresses(version: "ipv4" | "ipv6"): string[] {
  return [...new Set(ENCRYPTED_DNS_SERVICES.flatMap((service) => service[version]))].sort();
}

/** Every service's host names, deduplicated and sorted. */
export function encryptedDnsHosts(): string[] {
  return [...new Set(ENCRYPTED_DNS_SERVICES.flatMap((service) => service.hosts))].sort();
}

/** "Cloudflare, Google, Quad9, OpenDNS, NextDNS, AdGuard and 6 more". */
export function encryptedDnsSummary(shown = 6): string {
  const names = ENCRYPTED_DNS_SERVICES.map((service) => service.name);
  if (names.length <= shown) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}
