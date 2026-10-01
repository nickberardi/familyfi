"use client";

import type { InternetWindow } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";
import { InternetZone as SharedInternetZone } from "@/ui/InternetZone";
import { InternetZoneFooter } from "@/ui/InternetZoneFooter";
import { useAppData } from "./AppDataProvider";
import { groupActions } from "./group-actions";

/**
 * The group's device-wide controls: the shared component (`src/ui/InternetZone.tsx`, rendered
 * here through react-native-web and natively in the app), wired to this app's actions, presets
 * and rule links.
 */
export function InternetZone({
  group,
  windows,
  timezone,
  surface,
  onPause,
  onExtend,
  editHref,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  surface: "phone" | "web";
  onPause: () => void;
  onExtend: () => void;
  /**
   * Given, the footer offers "Edit internet rule" (to the group's rules, `InternetZoneFooter`);
   * omitted where the page already links to rules. The no-rule presets show either way.
   */
  editHref?: string;
}) {
  const { store } = useAppData();
  const actions = groupActions(group, surface, onPause, onExtend, store.mutate).flatMap((action) =>
    action.onClick ? [{ label: action.label, onPress: action.onClick, strong: action.strong }] : [],
  );
  const now = new Date();
  const footer = <InternetZoneFooter group={group} windows={windows} timezone={timezone} now={now} mutate={store.mutate} showEdit={Boolean(editHref)} />;
  return (
    <SharedInternetZone group={group} windows={windows} timezone={timezone} now={now} actions={actions} footer={footer} />
  );
}
