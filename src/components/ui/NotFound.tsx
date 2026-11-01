"use client";

import { PageHeader } from "@/components/PageHeader";
import { EmptyCard } from "@/ui/EmptyCard";

import { BackLink, DETAIL_PAGE } from "./BackLink";

/**
 * A detail page whose item isn't there: the header says so, the way back stays where it always
 * is, and one plain line says why.
 */
export function NotFound({ title, line, back }: { title: string; line: string; back: { href: string; label: string } }) {
  return (
    <>
      <PageHeader title={title} />
      <div className={DETAIL_PAGE}>
        <BackLink href={back.href} label={back.label} />
        <EmptyCard text={line} />
      </div>
    </>
  );
}
