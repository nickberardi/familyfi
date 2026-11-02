#!/usr/bin/env node
// What .github/workflows/release.yml does when a tag's run fails, and how a later run of the same
// tag undoes it. v0.43.1's run failed before it built an image, its GitHub release still read as
// out, and households were told nothing: :latest stayed on v0.43.0.
//
//   node scripts/ci/release-failed.mjs fail <tag> <built: true|false>
//     Opens an issue naming the jobs that failed (or comments on the one already open for the
//     tag). When no image was built, it deletes the tag's GitHub release, so the newest release
//     GitHub shows is one households can install, and saves that release's name, notes and label
//     in the issue. The tag stays, so "Re-run failed jobs" builds it.
//   node scripts/ci/release-failed.mjs restore <tag>
//     Before the run names its image: when the tag has no release and its open issue saved one,
//     creates it again as a Pre-release with its name and notes.
//   node scripts/ci/release-failed.mjs relabel <tag>
//     After the run names its image: when `restore` recreated the release, in this attempt or an
//     earlier one (its notes carry a mark until then), gives it back the label the issue saved, so
//     the run's promote job promotes a full release. A release made by hand has no mark and keeps
//     the label it was given.
//   node scripts/ci/release-failed.mjs close <tag>
//     Once every job of the run has passed: closes the tag's issue.
//
// The release comes back as a new one with the same tag, name and notes; anything uploaded to it
// is gone. It takes GitHub's "Latest" badge only when it is newer than every full release.
//
// Reads GH_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_SERVER_URL, GITHUB_RUN_ID and
// GITHUB_RUN_ATTEMPT, as a workflow sets them. curl and jq are not needed.

import { pathToFileURL } from "node:url";

import { compareTags, parseTag } from "./newest-tag.mjs";

export const issueTitle = (tag) => `Release ${tag} failed`;

const MARKER = /<!-- familyfi-release-failed (\S+) -->/;

/** In the notes of a release `restore` made, until `relabel` has given it its label. */
export const RESTORED = "<!-- familyfi-release-restored -->";

/** The release `fail` removed, kept in the issue so `restore` and `relabel` can bring it back. */
export function saveRelease(release) {
  const saved = { name: release.name ?? "", body: release.body ?? "", prerelease: Boolean(release.prerelease) };
  return `<!-- familyfi-release-failed ${Buffer.from(JSON.stringify(saved)).toString("base64")} -->`;
}

export function savedRelease(issueBody) {
  const match = MARKER.exec(issueBody ?? "");
  if (!match) return null;
  try {
    const saved = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    return typeof saved.prerelease === "boolean" ? saved : null;
  } catch {
    return null;
  }
}

/** The issue `fail` opens, or the comment it adds to one already open. */
export function failureReport({ tag, runUrl, failedJobs, built, release, saved = false }) {
  const jobs = failedJobs.length
    ? failedJobs.map((job) => `- [${job.name}](${job.url})`).join("\n")
    : "- (GitHub listed no failed job; see the run.)";
  const lines = [`The [Release run for ${tag}](${runUrl}) failed.`, "", "Failed jobs:", jobs, ""];
  if (built) {
    lines.push(
      `Its image was built and named in the release's notes, so the release stays. Fix the failure and choose **Re-run failed jobs** on the run.`,
    );
  } else if (release) {
    lines.push(
      `No image was built, so households cannot install ${tag}. Its ${release.prerelease ? "Pre-release" : "full release"} was deleted${saved ? " again" : ""}, so the newest release GitHub shows is one they can install. The tag stays.`,
      "",
      `Fix the failure and choose **Re-run failed jobs** on the run. Once it has built the image, the release comes back with its name and notes${release.prerelease ? "" : " as a full release, `:latest` moves to it,"} and this issue closes.`,
      "",
      "<details><summary>The deleted release's notes</summary>",
      "",
      release.body || "(empty)",
      "",
      "</details>",
      "",
      saveRelease(release),
    );
  } else {
    lines.push(
      saved
        ? `No image was built. ${tag}'s release, deleted by an earlier attempt, is saved in this issue and comes back once a re-run builds the image. Fix the failure and choose **Re-run failed jobs** on the run.`
        : `No image was built, and ${tag} has no GitHub release. Fix the failure and choose **Re-run failed jobs** on the run.`,
    );
  }
  return lines.join("\n");
}

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function github(method, path, body) {
  const response = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env("GH_TOKEN")}`,
      accept: "application/vnd.github+json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 404 && method === "GET") return null;
  if (!response.ok) throw new Error(`${method} ${path}: GitHub answered ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

const repo = () => `/repos/${env("GITHUB_REPOSITORY")}`;

async function openIssue(tag) {
  const title = issueTitle(tag);
  for (let page = 1; page <= 10; page++) {
    const issues = await github("GET", `${repo()}/issues?state=open&per_page=100&page=${page}`);
    const found = issues?.find((issue) => !issue.pull_request && issue.title === title);
    if (found) return found;
    if (!issues || issues.length < 100) return null;
  }
  return null;
}

export async function fail(tag, built) {
  const runId = env("GITHUB_RUN_ID");
  const attempt = process.env.GITHUB_RUN_ATTEMPT || "1";
  const runUrl = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${env("GITHUB_REPOSITORY")}/actions/runs/${runId}/attempts/${attempt}`;
  const jobs = await github("GET", `${repo()}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
  const failedJobs = (jobs?.jobs ?? [])
    .filter((job) => job.conclusion === "failure")
    .map((job) => ({ name: job.name, url: job.html_url }));

  const existing = await openIssue(tag);
  const saved = savedRelease(existing?.body);
  const found = built ? null : await github("GET", `${repo()}/releases/tags/${encodeURIComponent(tag)}`);
  // A release an earlier attempt deleted is saved in the issue already, and a run that restored it
  // and failed again before naming the image deletes the copy: the saved one is what comes back.
  const release = found && saved ? { ...found, ...saved } : found;
  const body = failureReport({ tag, runUrl, failedJobs, built, release, saved: Boolean(saved) });
  if (existing) {
    await github("POST", `${repo()}/issues/${existing.number}/comments`, { body });
    // restore and relabel read the issue's own text, so a release this attempt deletes is saved
    // there when nothing is yet.
    if (release && !saved) {
      await github("PATCH", `${repo()}/issues/${existing.number}`, { body: `${existing.body ?? ""}\n\n${saveRelease(release)}` });
    }
    console.log(`::notice::Commented on #${existing.number}.`);
  } else {
    const issue = await github("POST", `${repo()}/issues`, { title: issueTitle(tag), body });
    console.log(`::notice::Opened #${issue.number}.`);
  }
  if (found) {
    await github("DELETE", `${repo()}/releases/${found.id}`);
    console.log(`::notice::Deleted ${tag}'s release; the tag stays.`);
  }
}

/** Whether `tag` is newer than every full release, so GitHub may badge it "Latest". */
async function newestFull(tag) {
  const releases = await github("GET", `${repo()}/releases?per_page=100`);
  const version = parseTag(tag);
  return (releases ?? [])
    .filter((r) => !r.prerelease && !r.draft && r.tag_name !== tag && parseTag(r.tag_name))
    .every((r) => compareTags(parseTag(r.tag_name), version) < 0);
}

export async function restore(tag) {
  if (await github("GET", `${repo()}/releases/tags/${encodeURIComponent(tag)}`)) return;
  const saved = savedRelease((await openIssue(tag))?.body);
  if (!saved) return;
  await github("POST", `${repo()}/releases`, {
    tag_name: tag,
    name: saved.name || tag,
    body: `${saved.body}\n\n${RESTORED}`,
    prerelease: true,
    make_latest: "false",
  });
  console.log(`::notice::Created ${tag}'s release again from its failure issue.`);
}

export async function relabel(tag) {
  const release = await github("GET", `${repo()}/releases/tags/${encodeURIComponent(tag)}`);
  if (!release?.body?.includes(RESTORED)) return;
  const saved = savedRelease((await openIssue(tag))?.body);
  // The mark goes with the label in one write, so an attempt that fails before it tries again.
  const update = { body: release.body.replace(RESTORED, "").trimEnd() };
  if (saved?.prerelease === false && release.prerelease) {
    Object.assign(update, { prerelease: false, make_latest: (await newestFull(tag)) ? "true" : "false" });
  }
  await github("PATCH", `${repo()}/releases/${release.id}`, update);
  if (update.prerelease === false) console.log(`::notice::${tag} is a full release again.`);
}

export async function close(tag) {
  const issue = await openIssue(tag);
  if (!issue) return;
  await github("POST", `${repo()}/issues/${issue.number}/comments`, { body: `This run finished ${tag}: its image is built and named in the release's notes, and every job passed.` });
  await github("PATCH", `${repo()}/issues/${issue.number}`, { state: "closed", state_reason: "completed" });
  console.log(`::notice::Closed #${issue.number}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, tag, flag] = process.argv.slice(2);
  const run = {
    fail: () => fail(tag, flag === "true"),
    restore: () => restore(tag),
    relabel: () => relabel(tag),
    close: () => close(tag),
  }[command];
  const flagged = command === "fail";
  if (!run || !tag || (flagged && !["true", "false"].includes(flag))) {
    console.error("usage: release-failed.mjs fail <tag> <built: true|false> | restore <tag> | relabel <tag> | close <tag>");
    process.exit(2);
  }
  run().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
