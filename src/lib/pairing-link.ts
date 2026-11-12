/**
 * The pairing link: the pairing code as a link the FamilyFi app opens, for a browser on the device
 * the app is on (a Mac, or the phone itself). It carries the same string as the QR and the copied
 * code, and the app treats it the same way: nothing is claimed until the household is confirmed.
 */

/** The app's own scheme (familyfi-mobile's `scheme`). */
const SCHEME = "familyfi:";
const PAIR = "pair";

export const PAIRING_LINK_LABEL = "Open in the FamilyFi app";
export const PAIRING_LINK_NOTE = "When the app is on this device, this pairs it without scanning.";

/** The link for a pairing code. A code is base64url, so it needs no escaping. */
export function pairingLink(code: string): string {
  return `${SCHEME}//${PAIR}?code=${encodeURIComponent(code)}`;
}

/** The pairing code a link carries, or null when the link is not a pairing link. */
export function pairingCodeFromLink(link: string): string | null {
  // An app receives its links as `scheme://pair?code=…` or, already stripped, as `/pair?code=…`.
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/|\/)?pair\/?\?(.*)$/i.exec(link.trim());
  if (!match) return null;
  const code = new URLSearchParams(match[1]).get("code")?.trim();
  return code || null;
}

/** Whether a browser is on a device the FamilyFi app runs on: a Mac, an iPhone or iPad, or Android. */
export function runsFamilyFiApp(userAgent: string): boolean {
  return /Macintosh|iPhone|iPad|Android/.test(userAgent);
}
