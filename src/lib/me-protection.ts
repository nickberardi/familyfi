/**
 * What FamilyFi Me on a child's phone says of its Screen Time permission, which it needs to block
 * apps (iPhone and iPad only; Android never says). `on`: allowed. `notAllowed`: never allowed, or
 * turned down when asked. `removed`: it was on and was taken away in Settings. Sent by the phone on
 * `PATCH /paired/devices/{its id}`; an `x-extensible-enum`, so a reader treats a value it doesn't
 * know as no answer.
 */
export const ME_PROTECTION = ["on", "notAllowed", "removed"] as const;

export type MeProtection = (typeof ME_PROTECTION)[number];

export function isMeProtection(value: unknown): value is MeProtection {
  return typeof value === "string" && (ME_PROTECTION as readonly string[]).includes(value);
}

/** A child's phone not heard from for this long has gone quiet: parents are told once, until it is heard from again. */
export const ME_QUIET_AFTER_MS = 24 * 60 * 60_000;
