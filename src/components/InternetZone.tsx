"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { internetZoneText } from "@/lib/internet-zone";
import { internetRulePresets, type InternetRulePreset } from "@/lib/rules";
import type { InternetWindow } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";
import { Icon } from "@/components/ui/Icon";
import { InternetZone as SharedInternetZone } from "@/ui/InternetZone";
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
  /** Where "Edit internet rule" goes; omitted where the page already links to rules. */
  editHref?: string;
}) {
  const { store } = useAppData();
  const actions = groupActions(group, surface, onPause, onExtend, store.mutate).flatMap((action) =>
    action.onClick ? [{ label: action.label, onPress: action.onClick, strong: action.strong }] : [],
  );
  const now = new Date();
  const noRule = internetZoneText(group, windows, timezone, now).tone === "no_rule";
  const footer = noRule ? (
    <Presets group={group} />
  ) : editHref ? (
    <Link href={editHref} className="self-end text-[14px] font-semibold text-[var(--ff-accent)]">
      Edit internet rule
    </Link>
  ) : null;
  return (
    <SharedInternetZone group={group} windows={windows} timezone={timezone} now={now} actions={actions} footer={footer} />
  );
}

/** One tap to a common internet rule; anything else goes to the rule editor. */
function Presets({ group }: { group: Group }) {
  const { mutate } = useAppData();
  const presets = internetRulePresets(group);
  const add = (preset: InternetRulePreset) =>
    void mutate(
      () =>
        api("/api/v1/rules", {
          method: "POST",
          body: JSON.stringify({
            name: preset.name,
            kind: "internet",
            groupIds: [group.id],
            mode: "scheduled",
            windows: [{ name: preset.name, days: preset.days, start: preset.start, end: preset.end }],
          }),
        }),
      undefined,
      { notice: `${preset.name} added for ${group.name}. FamilyFi writes it to the gateway next.` },
    );
  const chip =
    "inline-flex items-center gap-1 rounded-full border border-[var(--ff-accent-line)] bg-[var(--ff-card)] px-2.5 py-1.5 text-[14px] font-semibold text-[var(--ff-accent)]";
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => (
        <button key={preset.name} type="button" className={chip} onClick={() => add(preset)}>
          <Icon name="plus" size={12} />
          {preset.label}
        </button>
      ))}
      <Link className={chip} href={`/rules/new?kind=internet&group=${group.id}`}>
        <Icon name="plus" size={12} />
        Custom schedule
      </Link>
    </div>
  );
}
