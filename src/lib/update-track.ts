/**
 * Which releases a household runs and is offered, from `FAMILYFI_UPDATE_TAG`: the tag Compose runs
 * and Watchtower pulls, matched as GHCR spells it. `next` follows every release, pre-releases included; `X.Y` only
 * that line's releases not marked Pre-release on GitHub, which promote.yml moves `:X.Y` to; `latest`,
 * blank, missing or anything else only releases not marked Pre-release.
 */
export type UpdateTrack = "latest" | "next" | { major: string; minor: string };

export function updateTrackFor(tag: string | undefined): UpdateTrack {
  const value = (tag ?? "").trim();
  if (value === "next") return "next";
  const line = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return line ? { major: line[1]!, minor: line[2]! } : "latest";
}

/** Whether FamilyFi knows the tag: blank (latest), `latest`, `next` or a line such as `0.38`. */
export function knownUpdateTag(tag: string | undefined): boolean {
  const value = (tag ?? "").trim();
  return value === "" || value === "latest" || updateTrackFor(value) !== "latest";
}
