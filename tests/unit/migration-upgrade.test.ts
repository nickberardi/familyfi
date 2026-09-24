import { describe, expect, it } from "vitest";
import {
  OLDEST_SUPPORTED_RELEASE,
  SCRATCH_PREFIX,
  parseArgs,
  parseReleaseTags,
  scratchDatabaseName,
  supportedReleases,
} from "../../scripts/check-migration-upgrade.mjs";

const LS_REMOTE = [
  "aaa1\trefs/tags/v0.1.0",
  "aaa2\trefs/tags/v0.1.0^{}",
  "bbb\trefs/tags/v0.10.0",
  "ccc\trefs/tags/v0.2.0",
  "ddd\trefs/tags/v0.3.0-rc.1",
  "eee\trefs/tags/v0.9.1",
].join("\n");

describe("parseReleaseTags", () => {
  it("orders releases by version, reads the peeled commit, and drops pre-release tags", () => {
    expect(parseReleaseTags(LS_REMOTE)).toEqual([
      { tag: "v0.1.0", sha: "aaa2" },
      { tag: "v0.2.0", sha: "ccc" },
      { tag: "v0.9.1", sha: "eee" },
      { tag: "v0.10.0", sha: "bbb" },
    ]);
  });
});

describe("supportedReleases", () => {
  const releases = parseReleaseTags(LS_REMOTE);

  it("starts at the oldest supported release and leaves out the release at HEAD", () => {
    expect(supportedReleases(releases, "bbb", "v0.2.0")).toEqual(["v0.2.0", "v0.9.1"]);
  });

  it("covers every release from the supported floor by default", () => {
    expect(OLDEST_SUPPORTED_RELEASE).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(supportedReleases(releases, "head")).toEqual(["v0.1.0", "v0.2.0", "v0.9.1", "v0.10.0"]);
  });
});

describe("parseArgs", () => {
  it("defaults to every supported release", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("takes a start release as --from, --from= or a bare tag", () => {
    expect(parseArgs(["--from", "v0.5.0"])).toEqual({ from: "v0.5.0" });
    expect(parseArgs(["--from=v0.5.0"])).toEqual({ from: "v0.5.0" });
    expect(parseArgs(["v0.5.0"])).toEqual({ from: "v0.5.0" });
    expect(parseArgs(["--latest"])).toEqual({ latest: true });
  });

  it("rejects anything that is not a release tag", () => {
    expect(() => parseArgs(["--from"])).toThrow(/release tag/);
    expect(() => parseArgs(["0.5"])).toThrow(/release tag/);
    expect(() => parseArgs(["--from", "v0.5.0", "--latest"])).toThrow(/not both/);
    expect(() => parseArgs(["--all"])).toThrow(/Unknown option/);
  });
});

describe("scratchDatabaseName", () => {
  it("gives each start release its own scratch database under the one droppable prefix", () => {
    expect(scratchDatabaseName("v0.5.0")).toBe(`${SCRATCH_PREFIX}v0_5_0`);
    expect(scratchDatabaseName("v0.5.0")).not.toBe(scratchDatabaseName("v0.5.1"));
    expect(scratchDatabaseName("v1.20.3")).toMatch(/^[a-z0-9_]+$/);
  });
});
