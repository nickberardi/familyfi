"use client";

import { use, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { daysLabel, windowTimes } from "@/lib/display";
import { ruleActionSpecs, ruleStateLine } from "@/lib/rule-actions";
import { CURATED_CATEGORY_SLOTS, rulePaused, ruleBlocksLabel, windowSegments, type Rule, type RuleWindow } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { useFilterCatalog } from "@/components/GroupGrid";
import { RulePauseSheet } from "@/components/PauseSheet";
import { PageHeader } from "@/components/PageHeader";
import { CategoryGlyph } from "@/components/ui/CategoryGlyph";
import { Icon } from "@/components/ui/Icon";
import { TogglePill } from "@/components/ui/Controls";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Every rule in the household: what it blocks, when, and for whom. Internet rules lead
 * with a square globe and the accent; category, app and website rules take the round
 * mark and the rule verdict's lighter treatment, so the two never read alike.
 */
export function RulesList({ searchParams }: { searchParams: Promise<{ group?: string | string[] }> }) {
  const scope = one(use(searchParams).group) ?? null;
  const { rules, groups, unifi, household, mutate } = useAppData();
  const [sheet, setSheet] = useState<{ rule: Rule; mode: "pause" | "extend" } | null>(null);
  const timezone = household?.timezone ?? "America/New_York";
  const now = new Date();
  const { catalogNames } = useFilterCatalog();
  const scoped = scope ? groups.find((group) => group.id === scope) : undefined;
  const list = scoped ? rules.filter((rule) => rule.groupIds.includes(scoped.id)) : rules;
  const covered = new Set(rules.flatMap((rule) => rule.groupIds));
  const chips = groups.filter((group) => covered.has(group.id));
  const unruled = groups.filter((group) => !covered.has(group.id)).map((group) => group.name);
  const nameOf = (id: string) => groups.find((group) => group.id === id)?.name ?? "Deleted group";
  const networkOf = (id: string) => unifi?.networks.find((network) => network.id === id)?.name ?? "Network";
  const newHref = scoped ? `/rules/new?group=${scoped.id}` : "/rules/new";

  const toggle = (rule: Rule) =>
    void mutate(
      () => api<{ rule: Rule }>(`/api/v1/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) }),
      undefined,
      { notice: `${rule.name} turned ${rule.enabled ? "off" : "on"}. FamilyFi writes it to the gateway next.` },
    );

  const run = (rule: Rule, action: "pause" | "resume" | "extend" | "allow") => {
    if (action === "pause" || action === "extend") return setSheet({ rule, mode: action });
    void mutate(() => api(`/api/v1/rules/${rule.id}/${action}`, { method: "POST", body: action === "allow" ? "{}" : undefined }));
  };

  return (
    <>
      <PageHeader title="Rules" sub="What is blocked, when, and for whom" actionHref={newHref} actionLabel="New rule" />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {chips.length ? (
          <nav aria-label="Show rules for" className="flex flex-wrap gap-1.5">
            {[{ id: null, name: "All" }, ...chips].map((chip) => {
              const on = (scoped?.id ?? null) === chip.id;
              return (
                <Link
                  key={chip.id ?? "all"}
                  href={chip.id ? `/rules?group=${chip.id}` : "/rules"}
                  aria-current={on ? "page" : undefined}
                  className="rounded-full border px-3 py-1.5 text-[14px] font-semibold"
                  style={{
                    background: on ? "var(--ff-accent-fill)" : "var(--ff-card)",
                    color: on ? "var(--ff-accent-hover)" : "var(--ff-ink)",
                    borderColor: on ? "var(--ff-accent-line)" : "var(--ff-hairline-card)",
                  }}
                >
                  {chip.name}
                </Link>
              );
            })}
          </nav>
        ) : null}

        {scoped && list.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px] text-[14px]">
            <span className="flex-1">
              No rules for {scoped.name} yet. {scoped.kind === "things" ? "Its devices" : "Their devices"} stay online and unfiltered.
            </span>
            <Link href={newHref} className="rounded-lg bg-[var(--ff-accent)] px-3 py-1.5 font-semibold text-[var(--ff-ink-on-fill)]">
              New rule
            </Link>
          </div>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]">
          {list.map((rule) => (
            <article
              key={rule.id}
              className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]"
              style={{ opacity: rule.enabled && !rulePaused(rule, now) ? 1 : 0.7 }}
            >
              <div className="flex items-start gap-3 p-4 pb-3">
                <RuleMark rule={rule} />
                <Link href={`/rules/${rule.id}`} className="min-w-0 flex-1">
                  <h2 className="m-0 text-[16px] font-semibold tracking-tight">{rule.name}</h2>
                  <p className="mt-0.5 text-[14px] text-[var(--ff-ink-2)]">{ruleBlocksLabel(rule, catalogNames)}</p>
                </Link>
                <TogglePill on={rule.enabled} onToggle={() => toggle(rule)} label={rule.name} />
              </div>
              <Link href={`/rules/${rule.id}`} className="block px-4 pb-4">
                <RuleBar rule={rule} />
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[14px]">
                  <dt className="text-[var(--ff-ink-3)]">When</dt>
                  <dd className="m-0 flex flex-col gap-0.5">
                    {rule.mode === "always" ? (
                      <span>Always</span>
                    ) : (
                      rule.windows.map((window) => (
                        <span key={window.id}>
                          {rule.windows.length > 1 && window.name ? `${window.name} · ` : ""}
                          {windowTimes(window.start, window.end)}
                          <span className="text-[var(--ff-ink-2)]"> · {daysLabel(window.days)}</span>
                        </span>
                      ))
                    )}
                  </dd>
                  <dt className="text-[var(--ff-ink-3)]">Applies to</dt>
                  <dd className="m-0 flex flex-wrap gap-1">
                    {(rule.scope === "network" ? rule.networkIds.map(networkOf) : rule.groupIds.map(nameOf)).map((name) => (
                      <span key={name} className="rounded-[6px] bg-[var(--ff-field)] px-2 py-0.5">
                        {name}
                      </span>
                    ))}
                  </dd>
                </dl>
              </Link>
              <RuleActions rule={rule} timezone={timezone} now={now} run={run} />
            </article>
          ))}
        </div>

        {sheet ? <RulePauseSheet rule={sheet.rule} mode={sheet.mode} timezone={timezone} onClose={() => setSheet(null)} /> : null}

        {!scoped && unruled.length ? (
          <p className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px] text-[14px]">
            No rules: {unruled.join(", ")}. They stay online and unfiltered.{" "}
            <Link href="/rules/new" className="font-semibold text-[var(--ff-accent)]">
              New rule
            </Link>
          </p>
        ) : null}

        <p className="max-w-[70ch] text-[14px] leading-5 text-[var(--ff-ink-2)]">
          Each window is its own UniFi policy. Edits are desired configuration, written to UniFi on the next reconcile; Sync
          shows whether the gateway accepted them.
        </p>
      </div>
    </>
  );
}

/** A paused rule says so and who paused it; the actions follow. Nothing shows while it is off. */
function RuleActions({
  rule,
  timezone,
  now,
  run,
}: {
  rule: Rule;
  timezone: string;
  now: Date;
  run: (rule: Rule, action: "pause" | "resume" | "extend" | "allow") => void;
}) {
  const state = ruleStateLine(rule, timezone, now);
  const actions = ruleActionSpecs(rule, timezone, now);
  if (!state && actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ff-line)] px-4 py-3">
      {state ? <span className="mr-auto text-[14px] text-[var(--ff-ink-2)]">{state}</span> : <span className="mr-auto" />}
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => run(rule, action.run)}
          className={
            action.strong
              ? "rounded-lg bg-[var(--ff-accent)] px-3 py-1.5 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
              : "rounded-lg border border-[var(--ff-hairline-card)] px-3 py-1.5 text-[14px] font-semibold"
          }
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/** The rule's kind at a glance: a square globe for all internet, a round mark for anything narrower. */
export function RuleMark({ rule }: { rule: Pick<Rule, "kind" | "targetIds"> }) {
  if (rule.kind === "internet") {
    return (
      <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] bg-[var(--ff-accent)] text-[var(--ff-ink-on-fill)]">
        <Icon name="globe-simple" size={17} />
      </span>
    );
  }
  const slot = rule.kind === "category" ? CURATED_CATEGORY_SLOTS.find((item) => rule.targetIds.includes(item.categoryId)) : undefined;
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
      style={{ background: "var(--ff-verdict-rule-fill)", color: "var(--ff-verdict-rule-ink)" }}
    >
      {slot ? (
        <CategoryGlyph slot={slot.slot} size={15} />
      ) : (
        <Icon name={rule.kind === "app" ? "app-window" : rule.kind === "domain" ? "link-simple" : "prohibit"} size={16} />
      )}
    </span>
  );
}

/** The rule's windows on a 24-hour bar, any day. */
export function RuleBar({ rule }: { rule: { kind: Rule["kind"]; mode: Rule["mode"]; windows: Pick<RuleWindow, "start" | "end">[] } }) {
  const internet = rule.kind === "internet";
  const style = internet
    ? { background: "var(--ff-accent)", opacity: 0.85 }
    : { background: "var(--ff-verdict-rule-fill)", boxShadow: "inset 0 0 0 1px var(--ff-verdict-rule-line)" };
  const bands = rule.mode === "always" ? [{ from: 0, to: 1440 }] : rule.windows.flatMap(windowSegments);
  const pct = (minutes: number) => `${((minutes / 1440) * 100).toFixed(3)}%`;
  return (
    <div aria-hidden>
      <div className="relative h-[16px] overflow-hidden rounded-[5px] bg-[var(--ff-well)]">
        {bands.map((band, index) => (
          <div key={index} className="absolute top-0 bottom-0" style={{ left: pct(band.from), width: pct(band.to - band.from), ...style }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[14px] text-[var(--ff-muted)]">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>NOON</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
    </div>
  );
}
