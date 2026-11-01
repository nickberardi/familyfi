import Link from "next/link";

/**
 * The way back from a detail page, under its header: "← Rules for Betsy", "← All devices". One
 * look on every page: a typed arrow, 14px semibold, in the accent.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="w-fit self-start text-[14px] leading-5 font-semibold text-[var(--ff-accent)]">
      ← {label}
    </Link>
  );
}

/** A detail page's body column: 960px of content, or 760px for an editor, plus the page padding. */
export const DETAIL_PAGE = "flex max-w-[992px] flex-col gap-4 p-4 md:max-w-[1008px] md:p-6";
export const EDITOR_PAGE = "flex max-w-[792px] flex-col gap-4 p-4 md:max-w-[808px] md:p-6";
