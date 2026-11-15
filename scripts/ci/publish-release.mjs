// What .github/workflows/publish.yml does, through actions/github-script's Octokit: publish the
// GitHub Release for a vX.Y.Z tag at a commit on main, then start release.yml for the tag. A tag
// created with the workflow's own token starts no workflow, so release.yml is started by dispatch.
// familyfi-mobile's publish.yml runs this file from vendor/familyfi.
//
// Returns the release's URL, or throws an Error saying why nothing was published.

export async function publishRelease({
  github,
  owner,
  repo,
  tag,
  target,
  notes,
}) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? ""))
    throw new Error(`${tag} is not vX.Y.Z`);
  if (!target) throw new Error("No target commit");

  // The target must be main or behind it: compare reads "ahead" or "identical" then.
  const { data: compare } = await github.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${target}...main`,
  });
  if (!["ahead", "identical"].includes(compare.status)) {
    throw new Error(`${target} is not a commit on main (${compare.status})`);
  }
  const sha = compare.base_commit.sha;

  const existing = await github.rest.git
    .getRef({ owner, repo, ref: `tags/${tag}` })
    .catch((error) => {
      if (error.status === 404) return null;
      throw error;
    });
  if (existing) throw new Error(`${tag} already exists`);

  // GitHub runs release.yml as it is at the tag, so the target must have its dispatch trigger.
  const { data: file } = await github.rest.repos.getContent({
    owner,
    repo,
    path: ".github/workflows/release.yml",
    ref: sha,
  });
  if (
    !/^ {2}workflow_dispatch:/m.test(
      Buffer.from(file.content, "base64").toString(),
    )
  ) {
    throw new Error(
      `release.yml at ${sha} cannot be dispatched; publish this one on GitHub's release page`,
    );
  }

  const { data: release } = await github.rest.repos.createRelease({
    owner,
    repo,
    tag_name: tag,
    target_commitish: sha,
    name: tag,
    body: notes ?? "",
    make_latest: "true",
  });

  try {
    await github.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: "release.yml",
      ref: tag,
    });
  } catch (error) {
    // Nothing will build this release, so take it and its tag back rather than leave it Latest.
    const removed = await github.rest.repos
      .deleteRelease({ owner, repo, release_id: release.id })
      .then(() =>
        github.rest.git.deleteRef({ owner, repo, ref: `tags/${tag}` }),
      )
      .then(
        () => "the release and tag were removed",
        (cleanup) =>
          `removing the release and tag failed too (${cleanup.message}), so delete them by hand`,
      );
    throw new Error(
      `Could not start release.yml for ${tag}: ${error.message}; ${removed}`,
    );
  }
  return release.html_url;
}
