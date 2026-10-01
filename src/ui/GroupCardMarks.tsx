"use client";

import { StyleSheet, View } from "react-native";

import type { CardMarks } from "@/lib/category-marks";
import type { InternetWindow } from "@/lib/rule-windows";
import { appRulesForGroup, glyphForAppName, parentFacingRuleLabel, type Rule } from "@/lib/rules";
import type { Group } from "@/lib/types";
import { appMarkState, ruleActivelyBlocking } from "@/lib/upstream";

import { AddAppMark, AppMark, CategoryMark, MoreMark, SectionLabel } from "./CategoryMarks";
import { InternetMark } from "./InternetMark";
import { useUI } from "./UIContext";

/**
 * A group card's marks, shared by every client. Closed: the Internet mark, a divider, then its
 * categories with FamilyFi's own rules first, and More. Open: the other categories, then its app
 * rules. Every mark says what tapping it does through the callbacks, since each client opens its
 * own sheet.
 */
export function GroupCardMarks({
  group,
  windows,
  timezone,
  now,
  rules,
  catalogNames,
  open,
  marks,
  more,
  onOpen,
  onToggleMore,
  onApp,
  onAddApp,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  now: Date;
  rules: Rule[];
  catalogNames: Map<string, string>;
  open: boolean;
  /** `cardMarks(...)` for this card. */
  marks: CardMarks;
  more: boolean;
  /** Opens the card, focused on a category when one was tapped. */
  onOpen: (slot?: string) => void;
  onToggleMore: () => void;
  onApp: (rule: Rule, name: string) => void;
  /** Blocks another app for the group: an Add tile after the app marks, on the group's own page only. */
  onAddApp?: () => void;
}) {
  const ui = useUI();
  const apps = open ? appRulesForGroup(rules, group.id) : [];
  return (
    <View testID={`filter-marks-${group.id}`}>
      {open ? (
        <View style={styles.heading}>
          <SectionLabel>Other categories</SectionLabel>
        </View>
      ) : null}
      <View style={styles.row}>
        {open ? null : (
          <>
            <InternetMark group={group} windows={windows} timezone={timezone} now={now} onPress={() => onOpen()} />
            <View aria-hidden style={[styles.divider, { backgroundColor: ui.color("hairline-strong") }]} />
          </>
        )}
        {marks.shown.map((item) => (
          <CategoryMark key={item.key} item={item} onPress={() => onOpen(item.key)} testID={`mark-${item.key}-${group.id}`} />
        ))}
        {marks.hidden ? <MoreMark more={more} total={marks.ordered.length} hidden={marks.hidden} onPress={onToggleMore} /> : null}
      </View>
      {apps.length || (open && onAddApp) ? (
        <View style={[styles.apps, { borderTopColor: ui.color("hairline") }]}>
          <SectionLabel>App rules</SectionLabel>
          <View style={styles.appMarks}>
            {apps.map((rule) => {
              const name = parentFacingRuleLabel(rule, catalogNames);
              return (
                <AppMark
                  key={rule.id}
                  label={name}
                  glyph={glyphForAppName(name)}
                  state={appMarkState(ruleActivelyBlocking(rule, timezone))}
                  onPress={() => onApp(rule, name)}
                />
              );
            })}
            {open && onAddApp ? <AddAppMark onPress={onAddApp} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { paddingHorizontal: 18, paddingTop: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 12, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 14 },
  divider: { width: 1, alignSelf: "stretch", marginTop: 2, marginBottom: 14 },
  apps: { borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 14 },
  appMarks: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 8 },
});
