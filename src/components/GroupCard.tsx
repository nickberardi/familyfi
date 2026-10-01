"use client";

import { useState } from "react";
import Link from "next/link";
import { GROUP_CARD_COPY } from "@/lib/group-page";
import { cardMarks, categorySheet, categorySlotStates } from "@/lib/category-marks";
import { internetWindowsForGroup, type Rule } from "@/lib/rules";
import type { UpstreamCategoryRow } from "@/lib/upstream";
import type { Group } from "@/lib/types";
import { CategoryZone } from "@/ui/CategoryZone";
import { GroupCardMarks } from "@/ui/GroupCardMarks";
import { FilterSheet, type FilterSheetState } from "./filters/FilterSheet";
import { InternetZone } from "./InternetZone";
import { GroupCardFrame } from "@/ui/GroupCardFrame";

export type CardAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  strong?: boolean;
};

/**
 * A person or group of things, as the Family and Things pages show it.
 *
 * Closed, the card is its state and one row of marks: the Internet mark (all internet on
 * every device), a divider, then its categories with FamilyFi's own rules first. Opening
 * it — the header, or any mark — shows the internet zone with today's no-internet time
 * and its controls, one focused category in the rule's lighter treatment, and the other
 * categories. Device-wide and category controls never share a zone.
 */
export function GroupCard({
  group,
  href,
  timezone,
  rules,
  catalogNames,
  upstreamCategories,
  onPause,
  onExtend,
  onRulesChanged,
}: {
  group: Group;
  href: string;
  timezone: string;
  rules: Rule[];
  catalogNames: Map<string, string>;
  upstreamCategories: UpstreamCategoryRow[];
  onPause: () => void;
  onExtend: () => void;
  onRulesChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState<FilterSheetState | null>(null);

  const now = new Date();
  const windows = internetWindowsForGroup(rules, group.id, now);

  const marks = cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open, focus, more });
  const { focused } = marks;

  const openOn = (slot?: string) => {
    if (slot) setFocus(slot);
    setOpen(true);
  };

  return (
    <GroupCardFrame group={group} windows={windows} timezone={timezone} now={now} open={open} onToggle={() => setOpen(!open)}>

      {open ? (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <InternetZone
            group={group}
            windows={windows}
            timezone={timezone}
            surface="web"
            onPause={onPause}
            onExtend={onExtend}
            editHref={`/rules?group=${group.id}`}
          />
          {focused ? (
            <CategoryZone
              group={group}
              item={focused}
              rules={rules}
              timezone={timezone}
              now={now}
              onAddRule={() => setSheet(categorySheet(focused))}
              editRule={
                focused.rule ? (
                  <Link
                    href={`/rules/${focused.rule.id}?group=${group.id}`}
                    className="rounded-[8px] bg-[var(--ff-card)] px-2.5 py-1.5 text-[14px] font-semibold text-[var(--ff-accent)] shadow-[inset_0_0_0_1px_var(--ff-control-line)]"
                  >
                    {GROUP_CARD_COPY.editRule}
                  </Link>
                ) : null
              }
            />
          ) : null}
        </div>
      ) : null}

      <GroupCardMarks
        group={group}
        windows={windows}
        timezone={timezone}
        now={now}
        rules={rules}
        catalogNames={catalogNames}
        open={open}
        marks={marks}
        more={more}
        onOpen={openOn}
        onToggleMore={() => setMore(!more)}
        onApp={(rule, name) => setSheet({ kind: "app", name, rule })}
      />

      {open ? (
        <ActionRow
          actions={[
            { label: GROUP_CARD_COPY.rules, href: `/rules?group=${group.id}` },
            { label: GROUP_CARD_COPY.details, href },
          ]}
        />
      ) : null}

      {sheet ? (
        <FilterSheet group={group} state={sheet} onClose={() => setSheet(null)} onChanged={onRulesChanged} />
      ) : null}
    </GroupCardFrame>
  );
}

function ActionRow({ actions }: { actions: CardAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex border-t border-[var(--ff-hairline-strong)]">
      {actions.map((action, index) => {
        const className =
          "flex-1 py-3 text-center text-[16px] md:py-2.5 md:text-[14px] " +
          (action.strong ? "font-semibold text-[var(--ff-accent)]" : "font-medium text-[var(--ff-accent)]");
        const style = { borderLeft: index ? "1px solid var(--ff-hairline-strong)" : undefined };
        if (action.href) {
          return (
            <Link key={action.label} href={action.href} className={className} style={style}>
              {action.label}
            </Link>
          );
        }
        return (
          <button key={action.label} type="button" onClick={action.onClick} className={className} style={style}>
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
