export type ReleaseNotesSection = { title: string; items: string[] };

/**
 * Turns a GitHub release body into titled bullet lists: `##`/`###` headings start a
 * section (the design's "New", "Improved", "Fixed") and `-`/`*` lines are its items.
 * Anything else — links, prose, a "Full Changelog" footer — is dropped, and so is a
 * section left with no items, so the page only ever shows what it can lay out.
 */
export function parseReleaseNotes(markdown: string | null): ReleaseNotesSection[] {
  if (!markdown) return [];
  const sections: ReleaseNotesSection[] = [];
  let current: ReleaseNotesSection | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{2,3}\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      current = { title: heading[1]!, items: [] };
      sections.push(current);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!current) {
        current = { title: "Changes", items: [] };
        sections.push(current);
      }
      current.items.push(bullet[1]!);
    }
  }
  return sections.filter((section) => section.items.length > 0);
}
