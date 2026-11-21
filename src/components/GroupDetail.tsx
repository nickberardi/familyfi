"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GROUP_DETAIL_COPY, GROUP_EDIT_COPY, groupDetailSub } from "@/lib/group-form";
import { runGroupCardAction, type GroupCardRun } from "@/lib/group-writes";
import { groupBadge, groupDetailColor, groupStatusParts } from "@/lib/group-actions";
import { StatusBadge } from "@/ui/StatusBadge";
import type { GroupSheetTarget } from "@/lib/group-pause-sheet";
import { groupCardControls } from "@/ui/group-card-controls";
import { AskStrip } from "@/ui/AskStrip";
import { CardMenuButton } from "@/ui/CardActions";
import { internetRulesForGroup, internetWindowsForGroup } from "@/lib/rules";
import { cardNoteLine } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import { GroupFilterMarks } from "@/components/FilterMarks";
import { PauseSheet } from "@/components/PauseSheet";
import { useFilterCatalog } from "@/components/GroupGrid";
import { GROUP_SCHEDULE_COPY, GroupSchedule } from "@/ui/GroupSchedule";
import { InternetPresets } from "@/ui/InternetPresets";
import { GroupEditSheet } from "@/components/GroupEditSheet";
import { PageHeader } from "@/components/PageHeader";
import { GroupDevicesCard } from "@/ui/GroupDevicesCard";
import { GroupChildPhones } from "@/components/GroupChildPhones";
import { PRIMARY_BUTTON } from "@/components/ui/buttons";
import { BackLink } from "@/components/ui/BackLink";
import { NotFound } from "@/components/ui/NotFound";

export function GroupDetail({ kind, id, demo = false }: { kind: "family" | "things"; id: string; demo?: boolean }) {
  const router = useRouter();
  const { groups, devices, rules, household, store, loading, busy } = useAppData();
  const group = groups.find((item) => item.id === id);
  const [sheet, setSheet] = useState<GroupSheetTarget | null>(null);
  // The Edit button that opened the sheet, kept from its click: Safari never focuses a clicked button.
  const [editing, setEditing] = useState<HTMLElement | null>(null);
  const { catalogNames, upstreamCategories } = useFilterCatalog();

  if (!group) {
    if (loading) return null;
    const section = kind === "family" ? { href: "/family", label: "Family" } : { href: "/things", label: "Things" };
    return <NotFound title={GROUP_DETAIL_COPY.notFoundTitle} line={GROUP_DETAIL_COPY.notFoundLine} back={section} />;
  }
  const members = devices.filter((device) => device.groupId === id);
  const timezone = household?.timezone ?? "America/New_York";
  const now = new Date();
  const windows = internetWindowsForGroup(rules, group.id, now);
  const status = groupStatusParts(group, rules, timezone, now);
  const run = (tap: GroupCardRun) => runGroupCardAction(store.mutate, group, tap, setSheet);
  const header = groupCardControls(group, rules, timezone, now, run, !busy);

  return (
    <>
      <PageHeader title={group.name} sub={groupDetailSub(group)} actionLabel={GROUP_EDIT_COPY.open} onAction={(event) => setEditing(event.currentTarget)} />
      {/* 960px of content, as the design has it, plus the page padding either side. */}
      <div className="flex max-w-[992px] flex-col gap-[18px] p-4 md:max-w-[1008px] md:p-6">
        <BackLink href={kind === "family" ? "/family" : "/things"} label={kind === "family" ? "Family" : "Things"} />
        <section className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
          <div className="relative z-20 flex items-start gap-3 px-[18px] pt-4 pb-3">
            <div className="min-w-0 flex-1">
              {/* One name for the heading, "Blocked, Until 1:26 PM by Nick", not the badge and line run together. */}
              <h2
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] font-normal"
                aria-label={status.detail ? `${groupBadge(status.badge).label}, ${status.detail}` : groupBadge(status.badge).label}
              >
                <StatusBadge badge={status.badge} />
                {status.detail ? <span style={{ color: groupDetailColor(status.change) }}>{status.detail}</span> : null}
              </h2>
              <p className="mt-0.5 text-[14px] text-[var(--ff-ink-3)]">{cardNoteLine(group, windows)}</p>
            </div>
            {header.pageMenu.length ? (
              // Its rules each have their own Pause below, so the dropdown holds only More time and Block internet.
              <CardMenuButton action={header.action} menu={header.pageMenu} menuLabel={`More choices for ${group.name}`} />
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={header.action.onPress}
                data-testid={header.action.testID}
                className={`shrink-0 ${PRIMARY_BUTTON}`}
              >
                {header.action.label}
              </button>
            )}
          </div>
          {header.ask ? <AskStrip ask={header.ask} /> : null}
          <div className="px-3 pb-3">
            <GroupSchedule
              group={group}
              rules={rules}
              catalogNames={catalogNames}
              timezone={timezone}
              now={now}
              variant="details"
              onRun={run}
              enabled={!busy}
              footer={
                <div className="flex flex-col gap-2.5">
                  {internetRulesForGroup(rules, group.id).length === 0 ? <InternetPresets group={group} mutate={store.mutate} disabled={busy} /> : null}
                  <Link href={`/rules/new?group=${group.id}`} className="self-start text-[14px] font-semibold text-[var(--ff-accent)]" data-testid={`schedule-add-${group.id}`}>
                    {GROUP_SCHEDULE_COPY.add}
                  </Link>
                </div>
              }
            />
          </div>
          <GroupFilterMarks
            group={group}
            rules={rules}
            catalogNames={catalogNames}
            upstreamCategories={upstreamCategories}
            timezone={timezone}
            showAppAdd
          />
        </section>
        <GroupDevicesCard group={group} members={members} />
        {group.kind === "family" && !demo ? <GroupChildPhones group={group} /> : null}
      </div>
      {sheet ? <PauseSheet group={group} target={sheet} timezone={timezone} onOpen={setSheet} onClose={() => setSheet(null)} /> : null}
      {editing ? (
        <GroupEditSheet
          key={group.id}
          group={group}
          demo={demo}
          opener={editing}
          onClose={() => setEditing(null)}
          onDeleted={() => router.replace(kind === "family" ? "/family" : "/things")}
        />
      ) : null}
    </>
  );
}

export function GroupDetailPage({ kind, params, demo = false }: { kind: "family" | "things"; params: Promise<{ id: string }>; demo?: boolean }) {
  const { id } = use(params);
  return <GroupDetail kind={kind} id={id} demo={demo} />;
}
