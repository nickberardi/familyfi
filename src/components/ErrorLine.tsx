import type { ErrorNotice } from "@/lib/api-client";
import { Icon } from "@/components/ui/Icon";

/**
 * A failed action's message on a web-only card, in the caller's danger style, with the error's link
 * beneath it when it has one, such as the demo's "Set up your own".
 */
export function ErrorLine({ notice, className }: { notice: ErrorNotice; className: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-1">
      <p className={className}>{notice.text}</p>
      {notice.link ? (
        <a href={notice.link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[14px] font-semibold text-[var(--ff-accent)]">
          {notice.link.label}
          <Icon name="arrow-square-out" size={14} />
        </a>
      ) : null}
    </div>
  );
}
