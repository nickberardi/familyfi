export function normalizeMac(input: string): string {
  const hex = input.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12) {
    throw new Error("MAC address must contain 12 hex digits.");
  }
  return hex.match(/.{2}/g)!.join(":");
}
