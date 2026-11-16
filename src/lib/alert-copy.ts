import type { NewDeviceData } from "./alert-kinds";

/**
 * The words of phone alerts and of the Alerts card. A push carries only codes (src/lib/alert-kinds.ts);
 * the phone writes the sentence from them, so the apps restate `alertText` in Swift and Kotlin and
 * familyfi-mobile checks the copies against this file. Plain words for parents: Unassigned, never
 * quarantined.
 */

export type AlertText = { title: string; body: string };

/** The line iOS shows when it cannot decrypt an alert (the relay sends only the code `A0` for it). */
export const ALERT_FALLBACK_TEXT = "Something in FamilyFi needs your attention.";

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

/**
 * What a phone shows for an alert of `kind` with data `data`, or null for a kind it does not know
 * (which the server never sends it).
 */
export function alertText(kind: string, data: Record<string, unknown>): AlertText | null {
  switch (kind) {
    case "device.new": {
      const { n, h } = data as Partial<NewDeviceData>;
      const many = count(n);
      if (many > 1) return { title: "New devices", body: `${many} new devices are waiting in Unassigned.` };
      const name = typeof h === "string" && h.trim() ? h.trim() : null;
      return { title: "New device", body: name ? `${name} is waiting in Unassigned.` : "A new device is waiting in Unassigned." };
    }
    case "sync.down":
      return { title: "Can't reach your gateway", body: "Your rules may not apply until FamilyFi reaches it again." };
    case "sync.up":
      return { title: "Gateway reached", body: "FamilyFi can reach your gateway again." };
    default:
      return null;
  }
}

/** The name of each kind on an Alerts screen or card, where a parent turns it on or off. */
export const ALERT_KIND_LABELS: Record<string, string> = {
  "device.new": "New devices",
  "sync.down": "Can't reach your gateway",
  "sync.up": "Gateway back",
};

/** The Alerts card in Settings. */
export const ALERTS_CARD_COPY = {
  title: "Alerts",
  switchLabel: "Send alerts to the FamilyFi app",
  description:
    "Tells the FamilyFi app on your phones and tablets when a new device is waiting in Unassigned, or when FamilyFi can't reach your gateway.",
  disclosureTitle: "What leaves your home",
  disclosure: [
    "Alerts go through FamilyFi's push relay, which hands them to Apple or Google.",
    "Each alert is locked with a key that only that device and your FamilyFi hold. The relay sees an address for the device, whether it is an Apple or Android device, the locked alert, a random number for your FamilyFi and the time. It can't read the alert, and it keeps nothing.",
    "Apple or Google see that a device got an alert and when, not what it says or what kind it is.",
  ],
  /** Each paired app's own choice, as its tag on Pair Device. */
  accessOn: "Alerts on",
  accessOff: "Alerts off",
} as const;
