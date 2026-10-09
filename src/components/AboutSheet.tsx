"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { PRIMARY_BUTTON } from "@/components/pair/SheetFrame";
import { appVersionLabel } from "@/lib/version";

export const SOURCE_URL = "https://github.com/nickberardi/familyfi";

type AboutTab = "about" | "start";

const TABS = [
  { value: "about", label: "About" },
  { value: "start", label: "Get started" },
] as const;

/**
 * What FamilyFi is, its licence and who made it, opened from the lockup or the "About
 * FamilyFi" row in the navigation. The hosted demo adds a "Get started" tab, because a
 * visitor there has no household of their own yet and needs to know how to install one.
 */
export function AboutSheet({ demo, onClose }: { demo: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<AboutTab>("about");
  const done = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus goes back to whatever opened About, when it is still on the page (the drawer's row is not).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    done.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  const shown = demo ? tab : "about";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-4 md:p-6"
      style={{ background: "var(--ff-scrim)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="my-auto grid w-full max-w-[520px] gap-3.5 rounded-[14px] p-[18px]"
        style={{ background: "var(--ff-card)", boxShadow: "var(--ff-shadow-sheet)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 id="about-title" className="m-0 text-[17px] font-semibold tracking-tight text-[var(--ff-ink)]">
            About FamilyFi
          </h2>
          <p className="mt-1 mb-0 text-[14px] leading-5 text-pretty text-[var(--ff-muted)]">
            Family internet controls for a UniFi gateway. One deployment, one household.
          </p>
        </div>

        {demo ? <Segmented name="About sections" value={tab} segments={TABS} onChange={setTab} grow /> : null}

        {shown === "about" ? (
          <div className={`flex flex-col gap-3.5 ${demo ? "min-h-[236px]" : ""}`}>
            <p className="m-0 text-[14px] leading-[1.5] text-pretty text-[var(--ff-ink)]">
              UniFi gives you firewall policies and client lists, but bedtime, homework hours and &ldquo;who owns this
              new iPad?&rdquo; are still rules you have to remember. FamilyFi is the household layer: groups of people
              and things, rules and their schedules, and quarantined unknowns. Your own UniFi policies are never
              touched.
            </p>
            <div className="flex flex-col gap-0.5 rounded-[10px] border border-[var(--ff-hairline-card)] px-3.5 py-3">
              <span className="text-[14px] font-semibold text-[var(--ff-ink)]">Business Source License 1.1</span>
              <span className="text-[14px] leading-[1.5] text-pretty text-[var(--ff-muted)]">
                Source-available. Free for one household&rsquo;s UniFi network. Hosting or reselling it for others
                needs a commercial license. Each version becomes GPL v3 four years after it is published.
              </span>
            </div>
            <p className="m-0 text-[14px] leading-[1.5] text-pretty text-[var(--ff-muted)]">
              FamilyFi is independent and not affiliated with Ubiquiti, Inc. UniFi is a trademark of Ubiquiti, Inc.
            </p>
          </div>
        ) : (
          <div className="flex min-h-[236px] flex-col gap-3">
            <p className="m-0 text-[14px] leading-[1.5] text-pretty text-[var(--ff-ink)]">
              This is a demo. To run FamilyFi for your household, install it with Docker on a machine on your network,
              not on the gateway.
            </p>
            <pre
              className="m-0 overflow-x-auto rounded-[10px] px-3.5 py-3 font-mono text-[14px] leading-[1.7] whitespace-pre-wrap text-[var(--ff-ink)]"
              style={{ background: "var(--ff-field)" }}
            >
              {"cp .env.example .env\n# Set POSTGRES_PASSWORD.\nmake docker-up     # pulls ghcr.io/nickberardi/familyfi"}
            </pre>
            <p className="m-0 text-[14px] leading-[1.5] text-pretty text-[var(--ff-muted)]">
              Starts the published image with PostgreSQL. Open <code className="font-mono">http://localhost:7001</code>{" "}
              and sign in as admin with the recovery password from <code className="font-mono">make docker-logs</code>.
              Then paste a UniFi Network Integration API key in Settings.
            </p>
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="font-mono text-[14px] text-[var(--ff-muted)]">{appVersionLabel()}</span>
          <span className="text-[14px] text-[var(--ff-muted)]">
            Made by <span className="font-semibold text-[var(--ff-ink)]">Nick Berardi</span>
          </span>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[14px] font-semibold whitespace-nowrap text-[var(--ff-accent)]"
          >
            <Icon name="github-logo" size={15} />
            View source
          </a>
          <div className="flex-1" />
          <button ref={done} type="button" onClick={onClose} className={PRIMARY_BUTTON}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
