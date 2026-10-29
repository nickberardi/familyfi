/**
 * `scripts/ci/check-openapi-floors.mjs` decides from oasdiff's findings whether `info.x-min-app-api`
 * and `info.x-min-server-api` had to rise (docs/api.md, "Versioning the contract"). The findings
 * are given here; CI's `contract` job runs the pinned oasdiff for them.
 */
import { describe, expect, it } from "vitest";
import { checkFloors, SERVER_FLOOR_IDS } from "../../scripts/ci/check-openapi-floors.mjs";

const spec = (version: string, client: string, server: string) => ({
  info: { version, "x-min-app-api": client, "x-min-server-api": server },
});

const base = spec("0.41.0", "0.36.0", "0.36.0");
const none = { breaking: [] as string[], requiredAdded: [] as string[] };

describe("OpenAPI floors", () => {
  it("leave both floors alone for an additive change", () => {
    expect(checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.36.0", "0.36.0"), ...none })).toEqual({ ok: true, problems: [] });
  });

  it("raise x-min-app-api to the new version for a change that breaks old apps", () => {
    // The 0.34 change that crashed release 0.30: the quarantine rule stopped sending groupIds.
    const breaking = ["GET /api/v1/rules  the response property `rules/items/groupIds` became optional for the status `200`"];
    const forgot = checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.36.0", "0.36.0"), breaking, requiredAdded: [] });
    expect(forgot.ok).toBe(false);
    expect(forgot.problems[0]).toContain("breaks apps built from older contracts");
    expect(forgot.problems[0]).toContain(breaking[0]);
    expect(forgot.problems[0]).toContain("Set  x-min-app-api: 0.42.0  (now 0.36.0) next to version: 0.42.0.");
    expect(checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.42.0", "0.36.0"), breaking, requiredAdded: [] }).ok).toBe(true);
  });

  it("raise x-min-server-api to the new version when a response gains a required field", () => {
    // The 0.36 change that crashed release 0.37 against a 0.34 server: Checkup findings' message.
    const requiredAdded = ["GET /api/v1/checkup  added the required property `checkup/findings/items/message` to the response with the `200` status"];
    const forgot = checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.36.0", "0.36.0"), breaking: [], requiredAdded });
    expect(forgot.problems).toEqual([expect.stringContaining("Set  x-min-server-api: 0.42.0  (now 0.36.0)")]);
    expect(checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.36.0", "0.42.0"), breaking: [], requiredAdded }).ok).toBe(true);
  });

  it("list ten findings and count the rest", () => {
    const breaking = Array.from({ length: 13 }, (_, index) => `finding ${index}`);
    const [problem] = checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.36.0", "0.36.0"), breaking, requiredAdded: [] }).problems;
    expect(problem).toContain("finding 9");
    expect(problem).not.toContain("finding 10");
    expect(problem).toContain("and 3 more");
  });

  it("never go backwards or past info.version", () => {
    expect(checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.35.0", "0.36.0"), ...none }).problems).toEqual([
      "info.x-min-app-api went backwards, from 0.36.0 to 0.35.0: a floor only rises.",
    ]);
    expect(checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.36.0", "0.43.0"), ...none }).problems).toEqual([
      "info.x-min-server-api 0.43.0 is newer than info.version 0.42.0.",
    ]);
  });

  it("may rise on purpose without a finding", () => {
    expect(checkFloors({ baseSpec: base, headSpec: spec("0.42.0", "0.42.0", "0.42.0"), ...none }).ok).toBe(true);
  });

  it("must be present and semver, and start from a base without them", () => {
    expect(checkFloors({ baseSpec: base, headSpec: { info: { version: "0.42.0" } }, ...none }).problems).toEqual([
      'info.x-min-app-api "" is not semver MAJOR.MINOR.PATCH.',
      'info.x-min-server-api "" is not semver MAJOR.MINOR.PATCH.',
    ]);
    expect(checkFloors({ baseSpec: { info: { version: "0.40.0" } }, headSpec: spec("0.41.0", "0.36.0", "0.36.0"), ...none }).ok).toBe(true);
  });

  it("count only fields an older server doesn't send toward the server floor", () => {
    expect([...SERVER_FLOOR_IDS].sort()).toEqual(["response-property-became-required", "response-required-property-added"]);
  });
});
