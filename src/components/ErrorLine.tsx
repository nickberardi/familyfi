"use client";

import type { ErrorNotice } from "@/lib/api-client";
import { ExternalLink } from "@/ui/ExternalLink";
import { useUI } from "@/ui/UIContext";

/**
 * A failed action's message on a web-only card, in the caller's danger style, with the error's link
 * beneath it when it has one, such as the demo's "Set up your own": the shared `ExternalLink`, as
 * `ErrorNote` draws it on shared cards.
 */
export function ErrorLine({ notice, className }: { notice: ErrorNotice; className: string }) {
  const ui = useUI();
  return (
    <div role="alert" className="flex flex-col items-start gap-1">
      <p className={className}>{notice.text}</p>
      {notice.link ? (
        <ExternalLink
          href={notice.link.url}
          style={{ fontFamily: ui.font, fontSize: 14, lineHeight: 20, fontWeight: "600", color: ui.color("accent") }}
          color={ui.color("accent")}
          testID="error-link"
        >
          {notice.link.label}
        </ExternalLink>
      ) : null}
    </div>
  );
}
