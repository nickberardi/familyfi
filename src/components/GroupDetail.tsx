"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api";
import { loadGroupResolver, type GroupResolver } from "@/lib/group-resolver";
import { FAMILY_ROLES, GROUP_DETAIL_COPY, MONOGRAM_MAX, groupDetailSub, groupEditBody, groupEditDraft, roleLocked, rulesNeedDevice, type FamilyRole } from "@/lib/group-form";
import { deleteGroup, runGroupCardAction, updateGroup, type GroupCardRun } from "@/lib/group-writes";
import { groupStatus, groupStatusColor } from "@/lib/group-actions";
import type { GroupSheetTarget } from "@/lib/group-pause-sheet";
import { groupCardControls } from "@/ui/group-card-controls";
import { deviceName } from "@/lib/device-assign";
import { deviceHref } from "@/lib/device-detail";
import { internetRulesForGroup, internetWindowsForGroup } from "@/lib/rules";
import { cardNoteLine, deviceKindLabel } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import { GroupFilterMarks } from "@/components/FilterMarks";
import { PauseSheet } from "@/components/PauseSheet";
import { useFilterCatalog } from "@/components/GroupGrid";
import { GROUP_SCHEDULE_COPY, GroupSchedule } from "@/ui/GroupSchedule";
import { InternetPresets } from "@/ui/InternetPresets";
import { GroupResolverCard } from "@/components/upstream/GroupResolverCard";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { DeviceMark } from "@/ui/DeviceMark";
import type { Device, Group } from "@/lib/types";

const FIELD = "rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]";

function GroupEditForm({ group }: { group: Group }) {
  const { store, busy, accounts } = useAppData();
  const lockedRole = roleLocked(group, accounts);
  const initial = groupEditDraft(group);
  const [name, setName] = useState(initial.name);
  const [familyRole, setFamilyRole] = useState<FamilyRole>(initial.familyRole);
  const [monogram, setMonogram] = useState(initial.monogram);

  const draft = { name, familyRole, monogram };
  const canSave = groupEditBody(group, draft) !== null;

  async function onSave() {
    if (!canSave) return;
    await updateGroup(store.mutate, group, draft);
  }

  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <h2 className="border-b border-[var(--ff-hairline-card)] px-[18px] py-4 text-[14px] font-semibold">{GROUP_DETAIL_COPY.edit}</h2>
      <form
        className="flex flex-col gap-3 p-[18px]"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
      >
        <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
          {GROUP_DETAIL_COPY.name}
          <input required className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {group.kind === "family" ? (
          <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
            {GROUP_DETAIL_COPY.role}
            <select
              className={FIELD}
              value={familyRole}
              disabled={lockedRole && familyRole === "adult"}
              onChange={(e) => {
                const role = e.target.value as FamilyRole;
                if (lockedRole && role !== "adult") return;
                setFamilyRole(role);
              }}
            >
              {FAMILY_ROLES.map((role) => (
                <option key={role.value} value={role.value} disabled={lockedRole && role.value !== "adult"}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
            {GROUP_DETAIL_COPY.monogram}
            <input maxLength={MONOGRAM_MAX} className={FIELD} value={monogram} onChange={(e) => setMonogram(e.target.value)} />
          </label>
        )}
        <button
          type="submit"
          disabled={busy || !canSave}
          className="self-start rounded-[9px] bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-50"
        >
          {GROUP_DETAIL_COPY.save}
        </button>
      </form>
    </section>
  );
}

export function GroupDetail({ kind, id }: { kind: "family" | "things"; id: string }) {
  const router = useRouter();
  const { groups, devices, rules, household, store, reload, loading, busy } = useAppData();
  const [groupResolver, setGroupResolver] = useState<GroupResolver | null>(null);
  const group = groups.find((item) => item.id === id);
  const [sheet, setSheet] = useState<GroupSheetTarget | null>(null);
  const { catalogNames, upstreamCategories } = useFilterCatalog();

  // The effective source may be this group's DoH override or its devices' networks.
  useEffect(() => {
    const start = window.setTimeout(() => {
      void loadGroupResolver(request, id).then(setGroupResolver);
    }, 0);
    return () => window.clearTimeout(start);
  }, [id]);

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
      <PageHeader title={group.name} sub={groupDetailSub(group)} />
      {/* 960px of content, as the design has it, plus the page padding either side. */}
      <div className="flex max-w-[992px] flex-col gap-[18px] p-4 md:max-w-[1008px] md:p-6">
        <Link href={kind === "family" ? "/family" : "/things"} className="w-fit text-[14px] font-semibold text-[var(--ff-accent)]">
          ← Back to {kind === "family" ? "Family" : "Things"}
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
        <GroupEditForm key={group.id} group={group} />
        <GroupResolverCard
          groupId={group.id}
          groupName={group.name}
          dohOverrideUrl={group.dohOverrideUrl ?? null}
          resolver={groupResolver}
          onChanged={() => {
            void reload();
            void loadGroupResolver(request, id).then(setGroupResolver);
          }}
        />
        {/* Disabled while a write is in flight, which the store would otherwise drop without a word. */}
        <button
          type="button"
          disabled={busy}
          className="self-start text-[14px] font-semibold text-[var(--ff-danger)] disabled:opacity-50"
          onClick={() =>
            void deleteGroup(store.mutate, group, () => router.replace(kind === "family" ? "/family" : "/things"))
          }
        >
          Delete group (devices become quarantined)
        </button>
      </div>
      {sheet ? <PauseSheet group={group} target={sheet} timezone={timezone} onClose={() => setSheet(null)} /> : null}
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
            <Link
              key={device.mac}
              href={deviceHref(device, group.id)}
              className="ff-group-device-grid grid items-center gap-3.5 border-t border-[var(--ff-hairline)] px-[18px] py-2.5 text-[var(--ff-ink)] hover:bg-[var(--ff-field-soft)]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <DeviceMark hostname={device.hostname} />
                <div className="min-w-0">
                  <div className="truncate text-[14px]">{deviceName(device)}</div>
                  <div className="truncate text-[14px] text-[var(--ff-muted)]">{deviceKindLabel(device.hostname)}</div>
                </div>
              </div>
              <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] md:block">{device.ip ?? "—"}</div>
              <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] md:block">{device.mac.toUpperCase()}</div>
              <span aria-hidden="true" className="flex text-[var(--ff-chevron)]">
                <Icon name="caret-right" size={14} />
              </span>
            </Link>
          ))}
        </>
      )}
    </section>
  );
}

export function GroupDetailPage({ kind, params }: { kind: "family" | "things"; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GroupDetail kind={kind} id={id} />;
}
