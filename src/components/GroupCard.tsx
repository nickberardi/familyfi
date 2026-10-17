"use client";

import { useState } from "react";
import Link from "next/link";
import { GROUP_CARD_COPY } from "@/lib/group-page";
import type { GroupSheetTarget } from "@/lib/group-pause-sheet";
import { runGroupCardAction } from "@/lib/group-writes";
import { cardMarks, categorySheet, categorySlotStates } from "@/lib/category-marks";
import { internetWindowsForGroup, type Rule } from "@/lib/rules";
import type { UpstreamCategoryRow } from "@/lib/upstream";
import type { Group } from "@/lib/types";
import { groupCardControls } from "@/ui/group-card-controls";
import { GroupCardMarks } from "@/ui/GroupCardMarks";
import { GROUP_SCHEDULE_COPY, GroupSchedule } from "@/ui/GroupSchedule";
import { useAppData } from "./AppDataProvider";
import { FilterSheet, type FilterSheetState } from "./filters/FilterSheet";
import { GroupCardFrame } from "@/ui/GroupCardFrame";

export type CardAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  strong?: boolean;
  testID?: string;
};

/**
 * A person or group of things, as the Family and Things pages show it.
 *
 * Closed, the card is its state and one row of marks: the Internet mark (all internet on
 * every device), a divider, then its categories with FamilyFi's own rules first. Opening
 * it — the header, or any mark — puts the group's Block, Unblock or Resume in the header's
 * corner, and shows its schedule (every rule on one bar, and today's windows), its categories
 * and app rules. Pausing one rule for the group happens on its page, which the schedule links
 * to; the card's only button is the group's own. Show less closes it.
 */
export function GroupCard({
  group,
  href,
  timezone,
  rules,
  catalogNames,
  upstreamCategories,
  onSheet,
  onRulesChanged,
}: {
  group: Group;
  href: string;
  timezone: string;
  rules: Rule[];
  catalogNames: Map<string, string>;
  upstreamCategories: UpstreamCategoryRow[];
  /** Opens the group's block or unblock sheet. */
  onSheet: (target: GroupSheetTarget) => void;
  onRulesChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState<FilterSheetState | null>(null);
  const { store, busy } = useAppData();

  const now = new Date();
  const windows = internetWindowsForGroup(rules, group.id, now);

  const marks = cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open, more });
  const header = groupCardControls(group, rules, timezone, now, (tap) => runGroupCardAction(store.mutate, group, tap, onSheet), !busy);

  return (
    <GroupCardFrame
      group={group}
      rules={rules}
      windows={windows}
      timezone={timezone}
      now={now}
      open={open}
      onToggle={() => setOpen(!open)}
      action={header.action}
      more={header.more}
    >

      {open ? (
        <div className="px-3 pb-3">
          <GroupSchedule
            group={group}
            rules={rules}
            catalogNames={catalogNames}
            timezone={timezone}
            now={now}
            variant="card"
            footer={
              <Link href={href} className="self-end text-[14px] font-semibold text-[var(--ff-accent)]" data-testid={`schedule-details-${group.id}`}>
                {GROUP_SCHEDULE_COPY.details}
              </Link>
            }
          />
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
        onOpen={() => setOpen(true)}
        onCategory={(item) => setSheet(categorySheet(item))}
        onToggleMore={() => setMore(!more)}
        onApp={(rule, name) => setSheet({ kind: "app", name, rule })}
      />

      {open ? (
        <ActionRow
          actions={[
            { label: GROUP_CARD_COPY.details, href },
            { label: GROUP_CARD_COPY.showLess, onClick: () => setOpen(false), testID: `group-show-less-${group.id}` },
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
          <button key={action.label} type="button" onClick={action.onClick} className={className} style={style} data-testid={action.testID}>
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
