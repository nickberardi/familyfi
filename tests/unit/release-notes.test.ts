import { describe, expect, it } from "vitest";
import { parseReleaseNotes, releaseNoteParts } from "@/lib/release-notes";

const words = (...texts: string[]) => texts.map((text) => [{ text }]);

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
      { title: "New", items: words("Pair Device page", "Remote access") },
      { title: "Fixed", items: words("The quarantine pill names its state") },
    ]);
  });

  it("drops empty sections and files headingless bullets under Changes", () => {
    expect(parseReleaseNotes("## Empty\n\n- loose")).toEqual([{ title: "Empty", items: words("loose") }]);
    expect(parseReleaseNotes("- loose")).toEqual([{ title: "Changes", items: words("loose") }]);
    expect(parseReleaseNotes("## Nothing here")).toEqual([]);
  });

  it("returns no sections without a body", () => {
    expect(parseReleaseNotes(null)).toEqual([]);
    expect(parseReleaseNotes("")).toEqual([]);
  });

  it("shortens pull request and issue links and links GitHub users", () => {
    expect(releaseNoteParts("Split Settings into tabs by @nickberardi in https://github.com/nickberardi/familyfi/pull/237")).toEqual([
      { text: "Split Settings into tabs by " },
      { text: "@nickberardi", href: "https://github.com/nickberardi" },
      { text: " in " },
      { text: "pull #237", href: "https://github.com/nickberardi/familyfi/pull/237" },
    ]);
    expect(releaseNoteParts("Closes https://github.com/nickberardi/familyfi/issues/211.")).toEqual([
      { text: "Closes " },
      { text: "issue #211", href: "https://github.com/nickberardi/familyfi/issues/211" },
      { text: "." },
    ]);
    expect(releaseNoteParts("Bump pg by @dependabot[bot] in x")).toContainEqual({ text: "@dependabot[bot]", href: "https://github.com/apps/dependabot" });
    expect(releaseNoteParts("See [the guide](https://example.com/guide)")).toEqual([{ text: "See " }, { text: "the guide", href: "https://example.com/guide" }]);
  });

  it("leaves package names and addresses that look like mentions as words", () => {
    expect(releaseNoteParts("Bump @node-rs/argon2 from 2.2.1 to 2.2.2")).toEqual([{ text: "Bump @node-rs/argon2 from 2.2.1 to 2.2.2" }]);
    expect(releaseNoteParts("Mail nick@example.com")).toEqual([{ text: "Mail nick@example.com" }]);
  });
});
