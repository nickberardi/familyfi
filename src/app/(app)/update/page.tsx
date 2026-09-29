"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { useUpdateCheck } from "@/components/UpdateAlert";
import { Icon } from "@/components/ui/Icon";
import { parseReleaseNotes } from "@/lib/release-notes";
import { appVersionLabel } from "@/lib/version";

/** What an in-app install will do, in order. Shown as a preview: there is no installer yet. */
const INSTALL_STEPS = [
  "Back up the database",
  "Download the new release",
  "Apply database changes",
  "Restart FamilyFi",
  "Reconcile app-owned policies",
];

const CARD = "overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]";

export default function UpdatePage() {
  const update = useUpdateCheck();
  const latest = update?.available && update.latestVersion ? appVersionLabel(update.latestVersion) : null;
  const sections = parseReleaseNotes(update?.releaseNotes ?? null);

  return (
    <>
      <PageHeader title="Update" sub="Release notes and installation." />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {!latest ? (
          <p className={`${CARD} p-[18px] text-[14px] text-[var(--ff-muted)]`}>
            {!update || update.status === "pending"
              ? "Checking for updates…"
              : update.status === "error"
                ? "Update check unavailable."
                : `FamilyFi ${appVersionLabel(update.currentVersion)} is up to date.`}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-4">
            <section className={CARD} aria-label="Release notes">
              <div className="flex flex-wrap items-baseline gap-2.5 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
                <h2 className="text-[14px] font-semibold">Release notes</h2>
                <span className="font-mono text-[14px] text-[var(--ff-muted)]">{latest}</span>
                <span className="flex-1" />
                {update?.releaseUrl ? (
                  <a
                    href={update.releaseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[14px] font-semibold"
                  >
                    View on GitHub
                    <Icon name="arrow-square-out" size={14} />
                  </a>
                ) : null}
              </div>
              {sections.length === 0 ? (
                <p className="px-[18px] py-3.5 text-[14px] text-[var(--ff-muted)]">
                  This release has no notes. See the full release on GitHub.
                </p>
              ) : (
                sections.map((section, index) => (
                  <div
                    key={section.title}
                    className="px-[18px] py-3.5"
                    style={{ borderTop: index ? "1px solid var(--ff-hairline)" : undefined }}
                  >
                    <h3 className="text-[14px] font-semibold tracking-wide text-[var(--ff-muted)] uppercase">
                      {section.title}
                    </h3>
                    <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-[18px] text-[14px] leading-5 text-pretty">
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <section className={CARD} aria-label={`Install ${latest}`}>
              <div className="border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
                <h2 className="text-[14px] font-semibold">Install {latest}</h2>
                <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-muted)]">
                  In-app install is coming soon. Until then, pull the new image and restart FamilyFi. It applies
                  database changes on start, and your UniFi policies stay in place meanwhile.
                </p>
              </div>
              {INSTALL_STEPS.map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-3 px-[18px] py-[11px] text-[14px]"
                  style={{ borderTop: index ? "1px solid var(--ff-hairline)" : undefined }}
                >
                  <span
                    className="h-[22px] w-[22px] flex-none rounded-full bg-[var(--ff-field)]"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 text-[var(--ff-muted)]">{step}</span>
                </div>
              ))}
              <div className="flex flex-wrap justify-end gap-2 px-[18px] py-3.5">
                <Link
                  href="/family"
                  className="rounded-lg border border-[var(--ff-control-line)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-muted)]"
                >
                  Not now
                </Link>
                <button
                  type="button"
                  disabled
                  className="rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-40"
                >
                  Install {latest} · coming soon
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  );
}
