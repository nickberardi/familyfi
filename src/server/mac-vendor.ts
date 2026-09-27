import registrations from "./mac-vendors.json";

const vendors: Record<string, string> = registrations;

/** Look up one IEEE assignment prefix without handling a household MAC. */
export function macRegistrantForPrefix(prefix: string): string | null {
  if (!/^[0-9A-F]{6}([0-9A-F]{1}|[0-9A-F]{3})?$/i.test(prefix)) return null;
  return vendors[prefix.toUpperCase()] ?? null;
}

/** The IEEE registrant for a universally administered EUI-48, when public. */
export function macRegistrant(mac: string): string | null {
  const hex = mac.replaceAll(":", "").replaceAll("-", "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  const firstOctet = Number.parseInt(hex.slice(0, 2), 16);
  if (firstOctet & 0b11) return null; // multicast or locally administered
  return macRegistrantForPrefix(hex.slice(0, 9))
    ?? macRegistrantForPrefix(hex.slice(0, 7))
    ?? macRegistrantForPrefix(hex.slice(0, 6));
}
