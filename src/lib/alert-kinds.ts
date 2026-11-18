/**
 * The kinds of phone alert FamilyFi sends through the push relay (issue 263). This list is the
 * one place a kind is named: the server validates against it, the OpenAPI document lists it as an
 * `x-extensible-enum`, and the apps mirror it. Adding a kind changes nothing else on the wire: the
 * envelope, the encryption and the relay are kind-agnostic, and a phone is only ever sent the kinds
 * it registered as understanding.
 */
export const ALERT_KINDS = ["device.new", "sync.down", "sync.up", "ask.new", "me.protection", "me.quiet"] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

/** The highest alert envelope version this server writes. It rises only for an incompatible envelope change. */
export const ALERT_FORMAT = 1;

export function isAlertKind(value: unknown): value is AlertKind {
  return typeof value === "string" && (ALERT_KINDS as readonly string[]).includes(value);
}

/**
 * The plaintext of one alert, before it is encrypted for a phone. Short keys keep it near 70 bytes:
 * `v` envelope version, `i` event id (a phone ignores one it has seen), `t` Unix seconds, `k` kind,
 * `d` data for that kind. Unknown keys are ignored by readers, so a new optional key never bumps `v`.
 */
export type AlertEnvelope = {
  v: number;
  i: string;
  t: number;
  k: string;
  d: Record<string, unknown>;
};

/** `device.new`: `n` new devices waiting in Unassigned; `h` is the hostname when `n` is 1 and it has one. */
export type NewDeviceData = { n: number; h?: string };

/**
 * `ask.new`: a child asked for more time in FamilyFi Me. `g` the group's id and `n` its name; `a`
 * `pause` (to be unpaused) or `rule` (more time in a rule's window), with `r` the rule's name and `m`
 * the minutes asked for.
 */
export type AskData = { g: string; n: string; a: "pause" | "rule"; r?: string; m?: number };

/**
 * A child's phone (FamilyFi Me): `me.protection` when it says its Screen Time permission was taken
 * away or turned down after being on, `me.quiet` when it hasn't been heard from for a day. `p` the
 * phone's name, `g` its family member's group id and `n` their name.
 */
export type MePhoneData = { p: string; g?: string; n?: string };
