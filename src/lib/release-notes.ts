/** A run of an item's words; with `href`, a link (a pull request, an issue or a GitHub user). */
export type ReleaseNotesPart = { text: string; href?: string };
export type ReleaseNotesSection = { title: string; items: ReleaseNotesPart[][] };

// A pull request or issue URL, an @mention (a bot's ends "[bot]"), or a Markdown link. A mention
// needs a space or the line's start before it and no "/" after it, so "@node-rs/argon2" stays text.
const REFERENCE =
  /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|issues)\/(\d+)(?:[/#][^\s)]*[^\s).,;:!?])?|(?<![\w/@])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(\[bot\])?(?![\w/-])|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * Splits an item into words and links: a pull request or issue URL reads "pull #21" or
 * "issue #21", and "@login" links to that GitHub profile (a bot's to its app page).
 */
export function releaseNoteParts(item: string): ReleaseNotesPart[] {
  const parts: ReleaseNotesPart[] = [];
  let at = 0;
  for (const match of item.matchAll(REFERENCE)) {
    if (match.index > at) parts.push({ text: item.slice(at, match.index) });
    const [whole, kind, number, login, bot, label, url] = match;
    if (kind) parts.push({ text: `${kind === "pull" ? "pull" : "issue"} #${number}`, href: whole });
    else if (login) parts.push({ text: `@${login}${bot ?? ""}`, href: bot ? `https://github.com/apps/${login}` : `https://github.com/${login}` });
    else parts.push({ text: label!, href: url! });
    at = match.index + whole.length;
  }
  if (at < item.length) parts.push({ text: item.slice(at) });
  return parts;
}

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
      current.items.push(releaseNoteParts(bullet[1]!));
    }
  }
  return sections.filter((section) => section.items.length > 0);
}

/** How many items the release notes show until "Show all changes" opens them. */
export const RELEASE_NOTES_COLLAPSED_ITEMS = 4;

/**
 * The first `limit` items, in their sections, and how many are left out. Collapsed notes leave the
 * rest out rather than clipping them, so no hidden link takes focus or reaches a screen reader.
 */
export function collapseReleaseNotes(sections: ReleaseNotesSection[], limit = RELEASE_NOTES_COLLAPSED_ITEMS): { sections: ReleaseNotesSection[]; hidden: number } {
  const shown: ReleaseNotesSection[] = [];
  let left = limit;
  let hidden = 0;
  for (const section of sections) {
    if (left > 0) shown.push({ title: section.title, items: section.items.slice(0, left) });
    hidden += Math.max(0, section.items.length - left);
    left = Math.max(0, left - section.items.length);
  }
  return { sections: shown, hidden };
}
