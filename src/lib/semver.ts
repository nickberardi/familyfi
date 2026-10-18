/** Strict SemVer parsing and ordering, shared by the server's release checks and the update card. */

export type Semver = {
  major: string;
  minor: string;
  patch: string;
  prerelease: string[];
  version: string;
};

const NUMERIC = "(?:0|[1-9]\\d*)";
const IDENTIFIER = "[0-9A-Za-z-]+";
const SEMVER = new RegExp(
  `^(?<major>${NUMERIC})\\.(?<minor>${NUMERIC})\\.(?<patch>${NUMERIC})(?:-(?<prerelease>${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      if (leftPart === rightPart) return 0;
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return compareNumeric(leftPart, rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

/** Strict SemVer, accepting an optional conventional leading `v` in Git tags. */
export function parseSemver(input: string): Semver | null {
  const normalized = input.trim().replace(/^v/, "");
  const match = SEMVER.exec(normalized);
  const groups = match?.groups;
  if (!groups?.major || !groups.minor || !groups.patch) return null;
  const prerelease = groups.prerelease?.split(".") ?? [];
  if (prerelease.some((part) => /^0\d+$/.test(part))) return null;
  return {
    major: groups.major,
    minor: groups.minor,
    patch: groups.patch,
    prerelease,
    version: `${groups.major}.${groups.minor}.${groups.patch}${prerelease.length ? `-${prerelease.join(".")}` : ""}`,
  };
}

/** Returns a negative number when left is older than right. */
export function compareSemver(left: Semver, right: Semver): number {
  for (const part of ["major", "minor", "patch"] as const) {
    const compared = compareNumeric(left[part], right[part]);
    if (compared !== 0) return compared;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}
