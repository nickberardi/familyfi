"use client";

import { use, useState } from "react";
import { runRuleAction, toggleRuleEnabled } from "@/lib/group-writes";
import { RULES_COPY as COPY, rulesListView } from "@/lib/rule-list";
import type { Rule } from "@/lib/rules";
import { useAppData } from "@/components/AppDataProvider";
import { useFilterCatalog } from "@/components/GroupGrid";
import { RulePauseSheet } from "@/components/PauseSheet";
import { PageHeader } from "@/components/PageHeader";
import { RuleCard, type RuleCardAction } from "@/ui/RuleCard";
import { NoRulesCard, RuleScopeChips, RulesFootnote, UnruledNote } from "@/ui/RulesListParts";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Every rule in the household: what it blocks, when, and for whom. The cards and their parts are
 * shared with the native app (`src/ui/RuleCard.tsx`); the grid and the pause dialog are the web's.
 */
export function RulesList({ searchParams }: { searchParams: Promise<{ group?: string | string[] }> }) {
  const scope = one(use(searchParams).group) ?? null;
  const { rules, groups, unifi, household, store } = useAppData();
  const [sheet, setSheet] = useState<{ rule: Rule; mode: "pause" | "extend" } | null>(null);
  const timezone = household?.timezone ?? "America/New_York";
  const now = new Date();
  const { catalogNames } = useFilterCatalog();
  const { scoped, list, chips, unruled, newHref } = rulesListView(rules, groups, scope);
  const networks = unifi?.networks ?? [];

  const run = (rule: Rule, action: RuleCardAction) => {
    if (action === "pause" || action === "extend") return setSheet({ rule, mode: action });
    void runRuleAction(store.mutate, rule, action);
  };

  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.subtitle} actionHref={newHref} actionLabel={COPY.newRule} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {chips.length ? <RuleScopeChips chips={chips} scopedId={scoped?.id ?? null} /> : null}

        {scoped && list.length === 0 ? <NoRulesCard group={scoped} newHref={newHref} /> : null}

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]">
          {list.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              groups={groups}
              networks={networks}
              catalogNames={catalogNames}
              timezone={timezone}
              now={now}
              onToggle={() => void toggleRuleEnabled(store.mutate, rule)}
              onAction={(action) => run(rule, action)}
            />
          ))}
        </div>

        {sheet ? <RulePauseSheet rule={sheet.rule} mode={sheet.mode} timezone={timezone} onClose={() => setSheet(null)} /> : null}

        {!scoped && unruled.length ? <UnruledNote names={unruled} /> : null}

        <RulesFootnote />
      </div>
    </>
  );
}
