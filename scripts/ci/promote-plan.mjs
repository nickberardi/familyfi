#!/usr/bin/env node
// Which image .github/workflows/promote.yml moves :latest and :X.Y to, from the repository's
// GitHub releases (a JSON array on stdin):
//
//   node scripts/ci/promote-plan.mjs [--if-built] <tag> <owner/repo> [<tag :latest runs now>] < releases.json
//
// Prints `digest=sha256:…`, `minor=X.Y` and `latest=true|false` for $GITHUB_OUTPUT. The release must
// no longer be a Pre-release, its notes must name the image the Release workflow pushed to :next for
// it (`ghcr.io/<owner/repo>@sha256:…`), and no other full release of its line may be newer: :X.Y
// never moves back. :latest moves too unless another full release, or what :latest runs now, is
// newer, so a fix to an older line (v0.38.1 after v0.39.0) reaches households pinned to it alone. It
// may be behind the newest Pre-release on :next. Anything else exits 1 and says why.
//
// With --if-built, a release whose notes name no image yet is left to the Release workflow, which
// promotes a full release once it has built it: it prints nothing and exits 0.

import { readFileSync } from "node:fs";
import { compareTags, parseTag } from "./newest-tag.mjs";

const args = process.argv.slice(2);
const ifBuilt = args[0] === "--if-built";
const [tag, repository, current] = ifBuilt ? args.slice(1) : args;
if (!tag || !repository) {
  console.error("usage: promote-plan.mjs [--if-built] <tag> <owner/repo> [<tag :latest runs now>] < releases.json");
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
const pinned = [...(release.body ?? "").matchAll(/(ghcr\.io\/[\w.\/-]+)@(sha256:[0-9a-f]{64})/g)].find(
  (match) => match[1].toLowerCase() === image,
);
if (!pinned && ifBuilt) {
  console.error(`::notice::${tag}'s image is not built yet; the Release workflow promotes it once it is.`);
  process.exit(0);
}
if (!pinned) {
  fail(
    `${tag}'s notes name no image (${image}@sha256:…), so there is nothing to promote. ` +
      "If the Release workflow for this tag is still running, run this again once it has finished.",
  );
}

const minor = `${version.core.at(0)}.${version.core.at(1)}`;
const sameLine = (other) => other.core.at(0) === version.core.at(0) && other.core.at(1) === version.core.at(1);
const newer = [];
for (const other of releases) {
  if (other.tag_name === tag || other.draft || other.prerelease) continue;
  const otherVersion = parseTag(other.tag_name ?? "");
  if (otherVersion && compareTags(otherVersion, version) > 0) newer.push({ ...otherVersion, why: "which is already a full release" });
}
const running = parseTag(current ?? "");
if (running && compareTags(running, version) > 0) newer.push({ ...running, why: "which :latest already runs" });
const ahead = newer.find(sameLine);
if (ahead) fail(`${tag} is older than ${ahead.tag}, ${ahead.why}, so :latest and :${minor} stay where they are.`);
const latest = newer.length === 0;
if (!latest) {
  console.error(`::notice::${tag} is older than ${newer[0].tag}, ${newer[0].why}, so only :${minor} moves to it.`);
}

console.log(`digest=${pinned[2]}`);
console.log(`minor=${minor}`);
console.log(`latest=${latest}`);
