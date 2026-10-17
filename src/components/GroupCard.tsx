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
import { CategoryZone } from "@/ui/CategoryZone";
import { groupCardControls } from "@/ui/group-card-controls";
import { GroupCardMarks } from "@/ui/GroupCardMarks";
import { useAppData } from "./AppDataProvider";
import { FilterSheet, type FilterSheetState } from "./filters/FilterSheet";
import { InternetZone } from "./InternetZone";
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
 * corner, and shows the internet zone with today's no-internet time, one focused category in
 * the rule's lighter treatment, and the other categories; each zone's Pause or Resume acts for
 * this group alone. Device-wide and category controls never share a zone. Show less closes it.
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
  /** Opens a sheet for this group: its block, its unblock, or a zone's pause. */
  onSheet: (target: GroupSheetTarget) => void;
  onRulesChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [sheet, setSheet] = useState<FilterSheetState | null>(null);
  const { store } = useAppData();

  const now = new Date();
  const windows = internetWindowsForGroup(rules, group.id, now);

  const marks = cardMarks(categorySlotStates(group, rules, upstreamCategories, timezone), { open, focus, more });
  const { focused } = marks;
  const controls = groupCardControls(group, rules, focused ?? null, timezone, now, (tap) =>
    runGroupCardAction(store.mutate, group, tap, onSheet),
  );

  const openOn = (slot?: string) => {
    if (slot) setFocus(slot);
    setOpen(true);
  };

  return (
    <GroupCardFrame
      group={group}
      rules={rules}
      windows={windows}
      timezone={timezone}
      now={now}
      open={open}
      onToggle={() => setOpen(!open)}
      action={controls.header.action}
      more={controls.header.more}
    >

      {open ? (
        <div className="flex flex-col gap-2.5 px-3 pb-3">
          <InternetZone
            group={group}
            windows={windows}
            timezone={timezone}
            controls={controls.internet}
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
              action={controls.category?.action}
              more={controls.category?.more}
              paused={controls.category?.paused}
              editRule={
                focused.rule ? (
                  <Link href={`/rules/${focused.rule.id}?group=${group.id}`} className="text-[14px] font-semibold text-[var(--ff-accent)]">
                    {GROUP_CARD_COPY.editRule(focused.label)}
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
