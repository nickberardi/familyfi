"use client";

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { categoryRuleWhen, UPSTREAM_VERDICT_WORDS, type CategorySlotState } from "@/lib/category-marks";
import type { TimelineBand } from "@/lib/day-timeline";
import { internetDayBands, localWeekday } from "@/lib/rule-windows";
import { internetWindowsForGroup, ruleDayBands, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";

import { CategoryMarkGlyph, useMarkColors } from "./CategoryMarks";
import { DayTimeline } from "./DayTimeline";
import { Fold, FoldCaret } from "./Fold";
import { ZoneHeading, type ZoneFold } from "./InternetZone";
import { PRESS_OPACITY, useUI } from "./UIContext";

/**
 * The focused category on an open card, shared by every client: a FamilyFi rule's windows over the
 * group's faded internet time, or, with no rule, what the resolver reports and a way to add one.
 * The caller supplies "Edit rule" (`editRule`), since each platform navigates its own way. With
 * `fold`, a rule's heading opens and closes its timeline, and Edit rule sits under it.
 */
export function CategoryZone({
  group,
  item,
  rules,
  timezone,
  now,
  onAddRule,
  editRule,
  fold,
}: {
  group: Group;
  item: CategorySlotState;
  rules: Rule[];
  timezone: string;
  now: Date;
  onAddRule: () => void;
  editRule: ReactNode;
  fold?: ZoneFold;
}) {
  const ui = useUI();
  const colors = useMarkColors(item.state);
  // The web's 14px text takes the page's 1.5 line height (21); only the "when" line is 20.
  const text = { fontFamily: ui.font, fontSize: 14, lineHeight: 21 };
  const rule = item.rule?.enabled ? item.rule : undefined;

  if (!rule) {
    return (
      <View style={[styles.row, styles.plain, { backgroundColor: ui.color("field-soft") }]}>
        <View aria-hidden style={[styles.badge, { backgroundColor: colors.fill }]}>
          <CategoryMarkGlyph item={item} size={14} color={colors.ink} />
        </View>
        <Text style={[text, styles.grow, { color: ui.color("ink") }]}>
          <Text style={{ fontWeight: "600" }}>{item.label}</Text>
          <Text style={{ color: ui.color("ink-2") }}> · no rule · {UPSTREAM_VERDICT_WORDS[item.state]}</Text>
        </Text>
        <Pressable role="button" onPress={onAddRule} style={({ pressed }) => [styles.add, pressed && { opacity: PRESS_OPACITY }]}>
          <ui.Icon name="plus" size={14} color={ui.color("accent")} />
          <Text style={[text, { fontWeight: "600", color: ui.color("accent") }]}>Add rule</Text>
        </Pressable>
      </View>
    );
  }

  const weekday = localWeekday(now, timezone);
  const internet = internetWindowsForGroup(rules, group.id, now);
  const faded = internetDayBands({ suspension: { active: false, until: null }, allowance: { active: false, until: null } }, internet, now, timezone);
  const bands: TimelineBand[] = [
    ...faded.map((band) => ({ ...band, kind: "faded" as const })),
    ...ruleDayBands(rule, weekday).map((band) => ({
      kind: "category" as const,
      from: band.from,
      to: band.to,
      label: `${item.label} blocked`,
      source: `${rule.name} rule${band.window.name.trim() && rule.mode === "scheduled" ? ` · ${band.window.name.trim()}` : ""}`,
    })),
  ];
  const badge = item.blocking
    ? { box: ui.color("verdict-rule-ink"), ink: ui.color("ink-on-fill") }
    : { box: ui.color("verdict-rule-fill"), ink: ui.color("verdict-rule-ink") };

  const timeline = (
    <>
      <DayTimeline bands={bands} timezone={timezone} now={now} label={`${group.name}’s ${item.label} today`} />
      {internet.length ? <Text style={[text, { color: ui.color("ink-2") }]}>No-internet time also covers {item.label}.</Text> : null}
    </>
  );
  return (
    <View style={[styles.zone, { backgroundColor: ui.color(item.blocking ? "verdict-rule-fill" : "field-soft") }]}>
      <ZoneHeading fold={fold} style={[styles.row, styles.top]}>
        <View aria-hidden style={[styles.badge, { backgroundColor: badge.box }]}>
          <CategoryMarkGlyph item={item} size={14} color={badge.ink} />
        </View>
        <View style={styles.heading}>
          <Text role="heading" aria-level={3} style={[text, { fontWeight: "600", color: ui.color("ink") }]}>
            {item.label} · {item.blocking ? "blocked" : "allowed now"}
          </Text>
          <Text style={[text, styles.sub, { lineHeight: 20, color: ui.color("ink-2") }]}>{categoryRuleWhen(rule)} Everything else stays on.</Text>
        </View>
        {fold ? (
          <View aria-hidden style={styles.caret}>
            <FoldCaret open={fold.open} color={ui.color("ink-3")} />
          </View>
        ) : (
          editRule
        )}
      </ZoneHeading>
      {fold ? (
        <Fold open={fold.open}>
          <View style={styles.body}>
            {timeline}
            <View style={styles.edit}>{editRule}</View>
          </View>
        </Fold>
      ) : (
        timeline
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  plain: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  grow: { flex: 1, minWidth: 0 },
  add: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  zone: { gap: 10, borderRadius: 10, padding: 12 },
  top: { flexWrap: "wrap", alignItems: "flex-start" },
  heading: { flex: 1, minWidth: 140 },
  sub: { marginTop: 2 },
  caret: { alignSelf: "center", flexShrink: 0 },
  body: { gap: 10 },
  edit: { alignSelf: "flex-end" },
});
