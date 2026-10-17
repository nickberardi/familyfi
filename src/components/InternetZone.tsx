"use client";

import type { InternetWindow } from "@/lib/rule-windows";
import type { Group } from "@/lib/types";
import type { ZoneControls } from "@/ui/group-card-controls";
import { InternetZone as SharedInternetZone } from "@/ui/InternetZone";
import { InternetZoneFooter } from "@/ui/InternetZoneFooter";
import { useAppData } from "./AppDataProvider";

/**
 * The group's device-wide controls: the shared component (`src/ui/InternetZone.tsx`, rendered
 * here through react-native-web and natively in the app), with its Pause or Resume for the group
 * (`controls`, from `groupCardControls`), presets and rule link.
 */
export function InternetZone({
  group,
  windows,
  timezone,
  controls,
  editHref,
}: {
  group: Group;
  windows: InternetWindow[];
  timezone: string;
  controls: ZoneControls;
  /**
   * Given, the footer offers "Edit internet rule" (to the group's rules, `InternetZoneFooter`);
   * omitted where the page already links to rules. The no-rule presets show either way.
   */
  editHref?: string;
}) {
  const { store } = useAppData();
  const now = new Date();
  const footer = (
    <InternetZoneFooter
      group={group}
      windows={windows}
      timezone={timezone}
      now={now}
      mutate={store.mutate}
      showEdit={Boolean(editHref)}
      more={controls.more}
      paused={controls.paused}
    />
  );
  return (
    <SharedInternetZone
      group={group}
      windows={windows}
      timezone={timezone}
      now={now}
      action={controls.action}
      paused={controls.paused}
      footer={footer}
    />
  );
}
