/**
 * The kinds of phone alert FamilyFi sends through the push relay (issue 263). This list is the
 * one place a kind is named: the server validates against it, the OpenAPI document lists it as an
 * `x-extensible-enum`, and the apps mirror it. Adding a kind changes nothing else on the wire: the
 * envelope, the encryption and the relay are kind-agnostic, and a phone is only ever sent the kinds
 * it registered as understanding.
 */
export const ALERT_KINDS = ["device.new", "sync.down", "sync.up"] as const;

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
