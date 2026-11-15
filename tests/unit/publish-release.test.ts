import { describe, expect, it, vi } from "vitest";
import { publishRelease } from "../../scripts/ci/publish-release.mjs";

const sha = "674ffd73c42afb2c06829c4070551ba962855b1e";
const dispatchable =
  'on:\n  push:\n    tags:\n      - "v*"\n  workflow_dispatch:\n';

function notFound() {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

function fakeGitHub({
  status = "ahead",
  tagExists = false,
  workflow = dispatchable,
  dispatch = async () => ({}),
}: {
  status?: string;
  tagExists?: boolean;
  workflow?: string;
  dispatch?: () => Promise<unknown>;
} = {}) {
  return {
    rest: {
      repos: {
        compareCommitsWithBasehead: vi.fn(async () => ({
          data: { status, base_commit: { sha } },
        })),
        getContent: vi.fn(async () => ({
          data: { content: Buffer.from(workflow).toString("base64") },
        })),
        createRelease: vi.fn(async () => ({
          data: { id: 7, html_url: "https://example.test/v1.2.1" },
        })),
        deleteRelease: vi.fn(async () => ({})),
      },
      git: {
        getRef: vi.fn(async () => {
          if (tagExists) return { data: {} };
          throw notFound();
        }),
        deleteRef: vi.fn(async () => ({})),
      },
      actions: { createWorkflowDispatch: vi.fn(dispatch) },
    },
  };
}

const args = {
  owner: "o",
  repo: "r",
  tag: "v1.2.1",
  target: "674ffd7",
  notes: "Notes",
};

describe("scripts/ci/publish-release.mjs", () => {
  it("publishes a full release at the target's full SHA, then starts release.yml for the tag", async () => {
    const github = fakeGitHub();
    await expect(publishRelease({ github, ...args })).resolves.toBe(
      "https://example.test/v1.2.1",
    );
    expect(github.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith(
      expect.objectContaining({ basehead: "674ffd7...main" }),
    );
    expect(github.rest.repos.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tag_name: "v1.2.1",
        target_commitish: sha,
        body: "Notes",
        make_latest: "true",
      }),
    );
    expect(github.rest.actions.createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_id: "release.yml", ref: "v1.2.1" }),
    );
    expect(
      github.rest.repos.createRelease.mock.invocationCallOrder[0],
    ).toBeLessThan(
      github.rest.actions.createWorkflowDispatch.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ["a tag that is not vX.Y.Z", { tag: "1.2.1" }, {}, /not vX\.Y\.Z/],
    ["a pre-release tag", { tag: "v1.2.1-rc1" }, {}, /not vX\.Y\.Z/],
    ["a target off main", {}, { status: "diverged" }, /not a commit on main/],
    [
      "a target ahead of main",
      {},
      { status: "behind" },
      /not a commit on main/,
    ],
    ["a tag that exists", {}, { tagExists: true }, /already exists/],
    [
      "a target whose release.yml cannot be dispatched",
      {},
      { workflow: 'on:\n  push:\n    tags:\n      - "v*"\n' },
      /cannot be dispatched/,
    ],
  ])("publishes nothing for %s", async (_name, input, options, message) => {
    const github = fakeGitHub(options);
    await expect(publishRelease({ github, ...args, ...input })).rejects.toThrow(
      message,
    );
    expect(github.rest.repos.createRelease).not.toHaveBeenCalled();
    expect(github.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });

  it("removes the release and its tag when release.yml cannot be started", async () => {
    const github = fakeGitHub({
      dispatch: async () => Promise.reject(new Error("Unexpected inputs")),
    });
    await expect(publishRelease({ github, ...args })).rejects.toThrow(
      /Unexpected inputs; the release and tag were removed/,
    );
    expect(github.rest.repos.deleteRelease).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: 7 }),
    );
    expect(github.rest.git.deleteRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "tags/v1.2.1" }),
    );
  });

  it("says when removing them failed too", async () => {
    const github = fakeGitHub({
      dispatch: async () => Promise.reject(new Error("Unexpected inputs")),
    });
    github.rest.repos.deleteRelease.mockRejectedValueOnce(
      new Error("Forbidden"),
    );
    await expect(publishRelease({ github, ...args })).rejects.toThrow(
      /removing the release and tag failed too \(Forbidden\)/,
    );
  });
});
