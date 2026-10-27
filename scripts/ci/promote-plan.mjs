#!/usr/bin/env node
// Which image .github/workflows/promote.yml moves :latest and :X.Y to, from the repository's
// GitHub releases (a JSON array on stdin):
//
//   node scripts/ci/promote-plan.mjs <tag> <owner/repo> [<tag :latest runs now>] < releases.json
//
// Prints `digest=sha256:…` and `minor=X.Y` for $GITHUB_OUTPUT. The release must no longer be a
// Pre-release, its notes must name the image the Release workflow pushed to :next for it
// (`ghcr.io/<owner/repo>@sha256:…`), and neither another full release nor what :latest runs now
// may be newer: :latest never moves back. It may be behind the newest Pre-release on :next. Anything else exits 1 and says why.

import { readFileSync } from "node:fs";
import { compareTags, parseTag } from "./newest-tag.mjs";

const [tag, repository, current] = process.argv.slice(2);
if (!tag || !repository) {
  console.error("usage: promote-plan.mjs <tag> <owner/repo> < releases.json");
  process.exit(2);
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const version = parseTag(tag);
if (!version) fail(`${tag} is not vMAJOR.MINOR.PATCH, so it is not a FamilyFi release.`);

const releases = JSON.parse(readFileSync(0, "utf8"));
const release = releases.find((r) => r.tag_name === tag);
if (!release) fail(`GitHub has no release for ${tag}.`);
if (release.draft) fail(`${tag} is a draft. Publish it first.`);
if (release.prerelease) fail(`${tag} is still a Pre-release. Edit it and set its label to None or Latest.`);

const image = `ghcr.io/${repository.toLowerCase()}`;
const pinned = new RegExp(`${image.replace(/[.\\/]/g, "\\$&")}@(sha256:[0-9a-f]{64})`).exec(release.body ?? "");
if (!pinned) {
  fail(
    `${tag}'s notes name no image (${image}@sha256:…), so there is nothing to promote. ` +
      "If the Release workflow for this tag is still running, run this again once it has finished.",
  );
}

for (const other of releases) {
  if (other.tag_name === tag || other.draft || other.prerelease) continue;
  const otherVersion = parseTag(other.tag_name ?? "");
  if (otherVersion && compareTags(otherVersion, version) > 0) {
    fail(`${tag} is older than ${other.tag_name}, which is already a full release, so :latest stays where it is.`);
  }
}

const running = parseTag(current ?? "");
if (running && compareTags(running, version) > 0) {
  fail(`${tag} is older than ${current}, which :latest already runs, so :latest stays where it is.`);
}

console.log(`digest=${pinned[1]}`);
console.log(`minor=${version.core.at(0)}.${version.core.at(1)}`);
