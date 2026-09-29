import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "@/lib/release-notes";

describe("parseReleaseNotes", () => {
  it("groups bullets under their headings and ignores everything else", () => {
    const body = [
      "## New",
      "- Pair Device page",
      "* Remote access",
      "",
      "Some prose that is not a bullet.",
      "### Fixed",
      "- The quarantine pill names its state",
      "",
      "**Full Changelog**: https://github.com/nickberardi/familyfi/compare/v1...v2",
    ].join("\r\n");
    expect(parseReleaseNotes(body)).toEqual([
      { title: "New", items: ["Pair Device page", "Remote access"] },
      { title: "Fixed", items: ["The quarantine pill names its state"] },
    ]);
  });

  it("drops empty sections and files headingless bullets under Changes", () => {
    expect(parseReleaseNotes("## Empty\n\n- loose")).toEqual([{ title: "Empty", items: ["loose"] }]);
    expect(parseReleaseNotes("- loose")).toEqual([{ title: "Changes", items: ["loose"] }]);
    expect(parseReleaseNotes("## Nothing here")).toEqual([]);
  });

  it("returns no sections without a body", () => {
    expect(parseReleaseNotes(null)).toEqual([]);
    expect(parseReleaseNotes("")).toEqual([]);
  });
});
