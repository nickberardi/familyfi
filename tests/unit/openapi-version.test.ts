import { describe, expect, it } from "vitest";
import {
  bumpKind,
  checkVersion,
  classifyChange,
  compareSemver,
  parseSemver,
} from "../../scripts/check-openapi-version.mjs";

type Spec = Record<string, unknown>;

function spec(version: string, extra: Spec = {}): Spec {
  return {
    openapi: "3.1.0",
    info: { title: "FamilyFi API", version, description: "The household API." },
    paths: {
      "/api/v1/health": {
        get: { summary: "Health", responses: { "200": { description: "OK" } } },
      },
    },
    components: {
      schemas: {
        Category: {
          type: "object",
          description: "A domain list.",
          properties: { name: { type: "string" }, description: { type: "string" } },
        },
      },
    },
    ...extra,
  };
}

function withPath(base: Spec): Spec {
  const copy = structuredClone(base) as { paths: Record<string, unknown> };
  copy.paths["/api/v1/connection/tunnel"] = { get: { responses: { "200": { description: "OK" } } } };
  return copy;
}

function reworded(base: Spec): Spec {
  const copy = structuredClone(base) as {
    info: { description: string };
    paths: { "/api/v1/health": { get: { summary: string } } };
  };
  copy.info.description = "The household's API.";
  copy.paths["/api/v1/health"].get.summary = "Liveness and version";
  return copy;
}

const semver = (text: string) => {
  const parsed = parseSemver(text);
  if (!parsed) throw new Error(`not semver: ${text}`);
  return parsed;
};

describe("parseSemver and compareSemver", () => {
  it("accepts MAJOR.MINOR.PATCH with an optional prerelease and rejects the rest", () => {
    expect(parseSemver("0.8.0")).toEqual({ major: 0, minor: 8, patch: 0, prerelease: [] });
    expect(parseSemver("1.0.0-rc.1")?.prerelease).toEqual(["rc", "1"]);
    for (const bad of ["0.8", "v0.8.0", "01.0.0", "0.8.0-", "", "latest"]) expect(parseSemver(bad)).toBeNull();
  });

  it("orders by semver precedence, numerically, with a prerelease below its release", () => {
    const ordered = ["0.7.0", "0.7.1", "0.10.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-rc.2", "1.0.0-rc.10", "1.0.0"];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareSemver(semver(ordered[i - 1]), semver(ordered[i]))).toBeLessThan(0);
      expect(compareSemver(semver(ordered[i]), semver(ordered[i - 1]))).toBeGreaterThan(0);
    }
    expect(compareSemver(semver("0.8.0"), semver("0.8.0"))).toBe(0);
  });

  it("names the largest part that increased", () => {
    expect(bumpKind(semver("0.7.0"), semver("1.0.0"))).toBe("major");
    expect(bumpKind(semver("0.7.3"), semver("0.8.0"))).toBe("minor");
    expect(bumpKind(semver("0.7.0"), semver("0.7.1"))).toBe("patch");
    expect(bumpKind(semver("1.0.0-rc.1"), semver("1.0.0"))).toBe("patch");
  });
});

describe("classifyChange", () => {
  it("sees no change in an identical document", () => {
    expect(classifyChange(spec("0.7.0"), spec("0.7.0"))).toBe("none");
  });

  it("tells a version-only change from description and summary edits", () => {
    expect(classifyChange(spec("0.7.0"), spec("0.7.1"))).toBe("version");
    expect(classifyChange(spec("0.7.0"), reworded(spec("0.7.1")))).toBe("prose");
  });

  it("treats a new path as a contract change", () => {
    expect(classifyChange(spec("0.7.0"), withPath(spec("0.8.0")))).toBe("contract");
  });

  it("treats a schema field named description as contract, not prose", () => {
    const head = spec("0.7.1") as { components: { schemas: { Category: { properties: Spec } } } };
    delete head.components.schemas.Category.properties.description;
    expect(classifyChange(spec("0.7.0"), head)).toBe("contract");
  });
});

describe("checkVersion", () => {
  it("passes an unchanged document whatever its version", () => {
    expect(checkVersion({ baseSpec: spec("0.7.0"), headSpec: spec("0.7.0") }).ok).toBe(true);
  });

  it("fails a contract change that keeps the version, naming the next minor", () => {
    const outcome = checkVersion({ baseSpec: spec("0.7.0"), headSpec: withPath(spec("0.7.0")) });
    expect(outcome.ok).toBe(false);
    expect(outcome.change).toBe("contract");
    expect(outcome.message).toContain("0.7.0 to 0.7.0");
  });

  it("fails a version that goes down", () => {
    expect(checkVersion({ baseSpec: spec("0.7.0"), headSpec: withPath(spec("0.6.9")) }).ok).toBe(false);
  });

  it("fails a version that is not semver", () => {
    const outcome = checkVersion({ baseSpec: spec("0.7.0"), headSpec: withPath(spec("0.8")) });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not semver");
  });

  it("needs a minor increase for a contract change, and names it", () => {
    const patch = checkVersion({ baseSpec: spec("0.7.0"), headSpec: withPath(spec("0.7.1")) });
    expect(patch.ok).toBe(false);
    expect(patch.message).toContain("0.8.0");
    expect(checkVersion({ baseSpec: spec("0.7.0"), headSpec: withPath(spec("0.8.0")) }).ok).toBe(true);
  });

  it("allows a patch increase for prose-only edits", () => {
    const outcome = checkVersion({ baseSpec: spec("0.7.0"), headSpec: reworded(spec("0.7.1")) });
    expect(outcome).toMatchObject({ ok: true, change: "prose", from: "0.7.0", to: "0.7.1" });
  });

  it("passes a version-only increase", () => {
    expect(checkVersion({ baseSpec: spec("0.7.0"), headSpec: spec("0.8.0") })).toMatchObject({ ok: true, change: "version" });
  });

  it("fails prose-only edits that keep the version", () => {
    expect(checkVersion({ baseSpec: spec("0.7.0"), headSpec: reworded(spec("0.7.0")) }).ok).toBe(false);
  });

  it("allows a major increase only with the breaking_api label", () => {
    const head = withPath(spec("1.0.0"));
    const unlabelled = checkVersion({ baseSpec: spec("0.7.0"), headSpec: head });
    expect(unlabelled.ok).toBe(false);
    expect(unlabelled.message).toContain("breaking_api");
    expect(checkVersion({ baseSpec: spec("0.7.0"), headSpec: head, breakingApproved: true }).ok).toBe(true);
  });

  it("lets a minor increase carry an approved break before 1.0.0", () => {
    expect(checkVersion({ baseSpec: spec("0.7.0"), headSpec: withPath(spec("0.8.0")), breakingApproved: true }).ok).toBe(true);
  });

  it("needs a major increase for an approved break from 1.0.0 on", () => {
    expect(checkVersion({ baseSpec: spec("1.2.0"), headSpec: withPath(spec("1.3.0")), breakingApproved: true }).ok).toBe(false);
    expect(checkVersion({ baseSpec: spec("1.2.0"), headSpec: withPath(spec("2.0.0")), breakingApproved: true }).ok).toBe(true);
  });
});
