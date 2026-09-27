import registrations from "./mac-vendors.json";

const vendors: Record<string, string> = registrations;

/** The IEEE registrant for a universally administered EUI-48, when public. */
export function macRegistrant(mac: string): string | null {
  const hex = mac.replaceAll(":", "").replaceAll("-", "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  const firstOctet = Number.parseInt(hex.slice(0, 2), 16);
  if (firstOctet & 0b11) return null; // multicast or locally administered
  return vendors[hex.slice(0, 9)] ?? vendors[hex.slice(0, 7)] ?? vendors[hex.slice(0, 6)] ?? null;
}
