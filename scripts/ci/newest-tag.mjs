#!/usr/bin/env node
// The newest release tag (vMAJOR.MINOR.PATCH[-PRERELEASE]) of those on stdin, one a line, in
// SemVer order (src/lib/semver.ts): v1.0.0-rc.1 comes before v1.0.0. Other lines are ignored.
// release.yml and scripts/release.sh move :next only to the newest tag; promote-plan.mjs orders
// releases with the same comparison.
//
//   git tag -l 'v*' | node scripts/ci/newest-tag.mjs

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** The tag's version parts, or null when it is not a release tag. */
export function parseTag(tag) {
  const match = TAG.exec(tag);
  return match ? { tag, core: match.slice(1, 4).map(Number), prerelease: match[4]?.split(".") ?? [] } : null;
}

/** Negative when a is older than b. */
export function compareTags(a, b) {
  for (const i of [0, 1, 2]) {
    const d = a.core.at(i) - b.core.at(i);
    if (d !== 0) return d;
  }
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length - a.prerelease.length;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    const l = a.prerelease.at(i), r = b.prerelease.at(i);
    if (l === r) continue;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    if (ln && rn) return Number(l) - Number(r);
    if (ln !== rn) return ln ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tags = readFileSync(0, "utf8").split("\n").map((line) => parseTag(line.trim())).filter(Boolean);
  const newest = tags.reduce((best, tag) => (!best || compareTags(tag, best) > 0 ? tag : best), null);
  if (newest) console.log(newest.tag);
}
