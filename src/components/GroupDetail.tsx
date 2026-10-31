"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GROUP_DETAIL_COPY, GROUP_EDIT_COPY, groupDetailSub, rulesNeedDevice } from "@/lib/group-form";
import { runGroupCardAction, type GroupCardRun } from "@/lib/group-writes";
import { groupStatus, groupStatusColor } from "@/lib/group-actions";
import type { GroupSheetTarget } from "@/lib/group-pause-sheet";
import { groupCardControls } from "@/ui/group-card-controls";
import { deviceName } from "@/lib/device-assign";
import { DeviceLink } from "@/components/DeviceLink";
import { internetRulesForGroup, internetWindowsForGroup } from "@/lib/rules";
import { cardNoteLine, deviceKindLabel } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import { GroupFilterMarks } from "@/components/FilterMarks";
import { PauseSheet } from "@/components/PauseSheet";
import { useFilterCatalog } from "@/components/GroupGrid";
import { GROUP_SCHEDULE_COPY, GroupSchedule } from "@/ui/GroupSchedule";
import { InternetPresets } from "@/ui/InternetPresets";
import { GroupEditSheet } from "@/components/GroupEditSheet";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { DeviceMark } from "@/ui/DeviceMark";
import type { Device, Group } from "@/lib/types";

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
    return <p className="p-6 text-[14px] text-[var(--ff-muted)]">{GROUP_DETAIL_COPY.notFound}</p>;
  }
  const members = devices.filter((device) => device.groupId === id);
  const timezone = household?.timezone ?? "America/New_York";
  const now = new Date();
  const windows = internetWindowsForGroup(rules, group.id, now);
  const status = groupStatus(group, rules, timezone, now);
  const run = (tap: GroupCardRun) => runGroupCardAction(store.mutate, group, tap, setSheet);
  const header = groupCardControls(group, rules, timezone, now, run, !busy);

  return (
    <>
      <PageHeader title={group.name} sub={groupDetailSub(group)} actionLabel={GROUP_EDIT_COPY.open} onAction={(event) => setEditing(event.currentTarget)} />
      {/* 960px of content, as the design has it, plus the page padding either side. */}
      <div className="flex max-w-[992px] flex-col gap-[18px] p-4 md:max-w-[1008px] md:p-6">
        <Link href={kind === "family" ? "/family" : "/things"} className="w-fit text-[14px] font-semibold text-[var(--ff-accent)]">
          ← {kind === "family" ? "Family" : "Things"}
        </Link>
        <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
          <div className="flex items-start gap-3 px-[18px] pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-[14px] font-normal" style={{ color: groupStatusColor(status.tone) }}>
                <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: groupStatusColor(status.tone) }} />
                {status.label}
              </h2>
              <p className="mt-0.5 text-[14px] text-[var(--ff-ink-3)]">{cardNoteLine(group, windows)}</p>
              {header.more ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={header.more.onPress}
                  data-testid={header.more.testID}
                  className="mt-1 text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-50"
                >
                  {header.more.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={header.action.onPress}
              data-testid={header.action.testID}
              className="shrink-0 rounded-[8px] bg-[var(--ff-accent)] px-2.5 py-1.5 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-50"
            >
              {header.action.label}
            </button>
          </div>
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
        <GroupDevices group={group} members={members} />
      </div>
      {sheet ? <PauseSheet group={group} target={sheet} timezone={timezone} onClose={() => setSheet(null)} /> : null}
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

/** The group's devices as the Devices page lists them: type, name and kind, then their addresses, each row opening the device. */
function GroupDevices({ group, members }: { group: Group; members: Device[] }) {
  const assignHref = `/devices?assign=${group.id}`;
  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <h2 className="flex-1 text-[14px] font-semibold">{GROUP_DETAIL_COPY.devices[group.kind]}</h2>
        <Link href={assignHref} className="text-[14px] font-semibold text-[var(--ff-accent)]">
          {GROUP_DETAIL_COPY.assignDevices}
        </Link>
      </div>
      {members.length === 0 ? (
        <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
          {GROUP_DETAIL_COPY.noDevices}
          {rulesNeedDevice(group) ? (
            <>
              {" "}
              {GROUP_DETAIL_COPY.rulesNeedDevice.before}{" "}
              <Link href={assignHref} className="font-semibold text-[var(--ff-accent)]">
                {GROUP_DETAIL_COPY.rulesNeedDevice.link}
              </Link>
              {GROUP_DETAIL_COPY.rulesNeedDevice.after}
            </>
          ) : null}
        </p>
      ) : (
        <>
          <div className="ff-group-device-grid grid items-center gap-3.5 bg-[var(--ff-field-soft)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)]">
            <div>{GROUP_DETAIL_COPY.deviceColumns.device}</div>
            <div className="hidden md:block">{GROUP_DETAIL_COPY.deviceColumns.address}</div>
            <div className="hidden md:block">{GROUP_DETAIL_COPY.deviceColumns.hardware}</div>
            <div aria-hidden="true" />
          </div>
          {members.map((device) => (
            <DeviceLink
              key={device.mac}
              device={device}
              fromGroupId={group.id}
              className="ff-group-device-grid grid items-center gap-3.5 border-t border-[var(--ff-hairline)] px-[18px] py-2.5 text-[var(--ff-ink)] hover:bg-[var(--ff-field-soft)]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <DeviceMark hostname={device.hostname} />
                <div className="min-w-0">
                  <div className="truncate text-[14px]">{deviceName(device)}</div>
                  <div className="truncate text-[14px] text-[var(--ff-muted)]">
                    {deviceKindLabel(device.hostname)}
                    {/* The address columns hide on a phone, so the MAC tells unnamed devices apart there. */}
                    <span className="font-mono md:hidden"> · {device.mac.toUpperCase()}</span>
                  </div>
                </div>
              </div>
              <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] md:block">{device.ip ?? "—"}</div>
              <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] md:block">{device.mac.toUpperCase()}</div>
              <span aria-hidden="true" className="flex text-[var(--ff-chevron)]">
                <Icon name="caret-right" size={14} />
              </span>
            </DeviceLink>
          ))}
        </>
      )}
    </section>
  );
}

export function GroupDetailPage({ kind, params, demo = false }: { kind: "family" | "things"; params: Promise<{ id: string }>; demo?: boolean }) {
  const { id } = use(params);
  return <GroupDetail kind={kind} id={id} demo={demo} />;
}
