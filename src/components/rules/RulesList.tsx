"use client";

import { use, useState } from "react";
import Link from "next/link";
import { runRuleAction, toggleRuleEnabled } from "@/lib/group-writes";
import { ruleActionSpecs, ruleGroupStateLines, ruleStateLine } from "@/lib/rule-actions";
import {
  RULE_BAR_TICKS,
  RULES_COPY as COPY,
  noRulesFor,
  ruleAppliesTo,
  ruleBarBands,
  ruleCardDimmed,
  ruleHref,
  ruleMarkSpec,
  rulesListView,
  rulesScopeHref,
  ruleWhenLines,
  unruledLine,
} from "@/lib/rule-list";
import { ruleBlocksLabel, type Rule, type RuleWindow } from "@/lib/rules";
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
  const { rules, groups, unifi, household, store } = useAppData();
  const [sheet, setSheet] = useState<{ rule: Rule; mode: "pause" | "extend" } | null>(null);
  const groupNames = Object.fromEntries(groups.map((group) => [group.id, group.name]));
  const timezone = household?.timezone ?? "America/New_York";
  const now = new Date();
  const { catalogNames } = useFilterCatalog();
  const { scoped, list, chips, unruled, newHref } = rulesListView(rules, groups, scope);
  const networks = unifi?.networks ?? [];

  const toggle = (rule: Rule) => void toggleRuleEnabled(store.mutate, rule);

  const run = (rule: Rule, action: "pause" | "resume" | "extend" | "allow" | "disallow") => {
    if (action === "pause" || action === "extend") return setSheet({ rule, mode: action });
    void runRuleAction(store.mutate, rule, action);
  };

  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.subtitle} actionHref={newHref} actionLabel={COPY.newRule} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {chips.length ? (
          <nav aria-label={COPY.scopeLabel} className="flex flex-wrap gap-1.5">
            {[{ id: null, name: COPY.all }, ...chips].map((chip) => {
              const on = (scoped?.id ?? null) === chip.id;
              return (
                <Link
                  key={chip.id ?? "all"}
                  href={rulesScopeHref(chip.id)}
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
            <span className="flex-1">{noRulesFor(scoped)}</span>
            <Link href={newHref} className="rounded-lg bg-[var(--ff-accent)] px-3 py-1.5 font-semibold text-[var(--ff-ink-on-fill)]">
              {COPY.newRule}
            </Link>
          </div>
        ) : null}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]">
          {list.map((rule) => (
            <article
              key={rule.id}
              className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]"
              style={{ opacity: ruleCardDimmed(rule, now) ? 0.7 : 1 }}
            >
              <div className="flex items-start gap-3 p-4 pb-3">
                <RuleMark rule={rule} />
                <Link href={ruleHref(rule)} className="min-w-0 flex-1">
                  <h2 className="m-0 text-[16px] font-semibold tracking-tight">{rule.name}</h2>
                  <p className="mt-0.5 text-[14px] text-[var(--ff-ink-2)]">{ruleBlocksLabel(rule, catalogNames)}</p>
                </Link>
                <TogglePill on={rule.enabled} onToggle={() => toggle(rule)} label={rule.name} />
              </div>
              <Link href={ruleHref(rule)} className="block px-4 pb-4">
                <RuleBar rule={rule} />
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[14px]">
                  <dt className="text-[var(--ff-ink-3)]">{COPY.when}</dt>
                  <dd className="m-0 flex flex-col gap-0.5">
                    {ruleWhenLines(rule).map((line) => (
                      <span key={line.key}>
                        {line.times}
                        {line.days ? <span className="text-[var(--ff-ink-2)]"> · {line.days}</span> : null}
                      </span>
                    ))}
                  </dd>
                  <dt className="text-[var(--ff-ink-3)]">{COPY.appliesTo}</dt>
                  <dd className="m-0 flex flex-wrap gap-1">
                    {ruleAppliesTo(rule, groups, networks).map((name) => (
                      <span key={name} className="rounded-[6px] bg-[var(--ff-field)] px-2 py-0.5">
                        {name}
                      </span>
                    ))}
                  </dd>
                </dl>
              </Link>
              <RuleActions rule={rule} timezone={timezone} now={now} groupNames={groupNames} run={run} />
            </article>
          ))}
        </div>

        {sheet ? <RulePauseSheet rule={sheet.rule} mode={sheet.mode} timezone={timezone} onClose={() => setSheet(null)} /> : null}

        {!scoped && unruled.length ? (
          <p className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px] text-[14px]">
            {unruledLine(unruled)}{" "}
            <Link href="/rules/new" className="font-semibold text-[var(--ff-accent)]">
              {COPY.newRule}
            </Link>
          </p>
        ) : null}

        <p className="max-w-[70ch] text-[14px] leading-5 text-[var(--ff-ink-2)]">
          {COPY.footnote}
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
  groupNames,
  run,
}: {
  rule: Rule;
  timezone: string;
  now: Date;
  groupNames: Record<string, string>;
  run: (rule: Rule, action: "pause" | "resume" | "extend" | "allow" | "disallow") => void;
}) {
  const state = ruleStateLine(rule, timezone, now);
  const actions = ruleActionSpecs(rule, timezone, now);
  const overrides = ruleGroupStateLines(rule, groupNames, timezone, now);
  if (!state && overrides.length === 0 && actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ff-line)] px-4 py-3">
      <div className="mr-auto flex flex-col text-[14px] text-[var(--ff-ink-2)]">
        {[...(state ? [state] : []), ...overrides].map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
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
  const mark = ruleMarkSpec(rule);
  if (mark.shape === "square") {
    return (
      <span aria-hidden className="flex h-8 w-8 flex-none items-center justify-center rounded-[8px] bg-[var(--ff-accent)] text-[var(--ff-ink-on-fill)]">
        <Icon name={mark.icon} size={17} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
      style={{ background: "var(--ff-verdict-rule-fill)", color: "var(--ff-verdict-rule-ink)" }}
    >
      {mark.slot ? <CategoryGlyph slot={mark.slot} size={15} /> : <Icon name={mark.icon} size={16} />}
    </span>
  );
}

/** The rule's windows on a 24-hour bar, any day. */
export function RuleBar({ rule }: { rule: { kind: Rule["kind"]; mode: Rule["mode"]; windows: Pick<RuleWindow, "start" | "end">[] } }) {
  const internet = rule.kind === "internet";
  const style = internet
    ? { background: "var(--ff-accent)", opacity: 0.85 }
    : { background: "var(--ff-verdict-rule-fill)", boxShadow: "inset 0 0 0 1px var(--ff-verdict-rule-line)" };
  const bands = ruleBarBands(rule);
  const pct = (minutes: number) => `${((minutes / 1440) * 100).toFixed(3)}%`;
  return (
    <div aria-hidden>
      <div className="relative h-[16px] overflow-hidden rounded-[5px] bg-[var(--ff-well)]">
        {bands.map((band, index) => (
          <div key={index} className="absolute top-0 bottom-0" style={{ left: pct(band.from), width: pct(band.to - band.from), ...style }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[14px] text-[var(--ff-muted)]">
        {RULE_BAR_TICKS.map((tick, index) => (
          <span key={index}>{tick}</span>
        ))}
      </div>
    </div>
  );
}
