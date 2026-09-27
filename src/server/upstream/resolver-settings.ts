export class ResolverConfigError extends Error {}

/**
 * A DoH endpoint is configuration, not a credential, so it is stored and returned in
 * full. Its path may carry an account or profile id — enough for someone to spend that
 * profile's quota and appear in its logs, not enough to read those logs or change a
 * setting — which puts it in the same bracket as the rest of the household config:
 * worth keeping out of a pasted dump, not worth hiding from the operator who typed it.
 *
 * Hiding it actively hurt: a mistyped profile id showed a mask and an unknown verdict
 * with no way to see the mistake.
 */

/** Must be an absolute HTTPS URL. Plain HTTP would put DNS queries back in the clear. */
export function normalizeResolverUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new ResolverConfigError("Paste the DNS-over-HTTPS endpoint.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ResolverConfigError("That is not a URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new ResolverConfigError("The endpoint must start with https://.");
  }
  if (!parsed.hostname.includes(".")) {
    throw new ResolverConfigError("That URL has no host.");
  }
  return parsed.toString();
}
