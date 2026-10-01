"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api";
import { loadGroupResolver, type GroupResolver } from "@/lib/group-resolver";
import { FAMILY_ROLES, GROUP_DETAIL_COPY, MONOGRAM_MAX, groupEditBody, groupEditDraft, roleLocked, rulesNeedDevice, type FamilyRole } from "@/lib/group-form";
import { deleteGroup, updateGroup } from "@/lib/group-writes";
import { internetWindowsForGroup } from "@/lib/rules";
import { accessColor, cardNoteLine, cardStateLabel } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import { GroupFilterMarks } from "@/components/FilterMarks";
import { PauseSheet } from "@/components/PauseSheet";
import { useFilterCatalog } from "@/components/GroupGrid";
import { InternetZone } from "@/components/InternetZone";
import { GroupResolverCard } from "@/components/upstream/GroupResolverCard";
import type { Group } from "@/lib/types";

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
          Name
          <input required className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {group.kind === "family" ? (
          <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
            Role
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
            Monogram
            <input maxLength={MONOGRAM_MAX} className={FIELD} value={monogram} onChange={(e) => setMonogram(e.target.value)} />
          </label>
        )}
        <button
          type="submit"
          disabled={busy || !canSave}
          className="self-start rounded-[9px] bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-ink-on-fill)] disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </section>
  );
}

export function GroupDetail({ kind, id }: { kind: "family" | "things"; id: string }) {
  const router = useRouter();
  const { groups, devices, rules, household, store, reload, loading } = useAppData();
  const [groupResolver, setGroupResolver] = useState<GroupResolver | null>(null);
  const group = groups.find((item) => item.id === id);
  const [sheet, setSheet] = useState<"pause" | "extend" | null>(null);
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
    return <p className="p-6 text-[14px] text-[var(--ff-muted)]">Group not found.</p>;
  }
  const members = devices.filter((device) => device.groupId === id);
  const timezone = household?.timezone ?? "America/New_York";
  const windows = internetWindowsForGroup(rules, group.id, new Date());

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header>
        <Link href={kind === "family" ? "/family" : "/things"} className="w-fit text-[14px] font-semibold text-[var(--ff-accent)]">
          ← Back to {kind === "family" ? "Family" : "Things"}
        </Link>
        <h1 className="mt-2 text-[21px] font-bold tracking-tight">{group.name}</h1>
      </header>
      <div className="grid grid-cols-1 items-start gap-[18px] md:grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <div className="flex min-w-0 flex-col gap-[18px]">
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
          <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
            <h2 className="border-b border-[var(--ff-hairline-card)] px-[18px] py-4 text-[14px] font-semibold">Devices</h2>
            {members.length === 0 ? (
              <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
                {GROUP_DETAIL_COPY.noDevices}
                {rulesNeedDevice(group) ? (
                  <>
                    {" "}
                    {GROUP_DETAIL_COPY.rulesNeedDevice.before}{" "}
                    <Link href={`/devices?assign=${id}`} className="font-semibold text-[var(--ff-accent)]">
                      {GROUP_DETAIL_COPY.rulesNeedDevice.link}
                    </Link>
                    {GROUP_DETAIL_COPY.rulesNeedDevice.after}
                  </>
                ) : null}
              </p>
            ) : (
              members.map((device) => (
                <div key={device.mac} className="flex items-center gap-3 border-t border-[var(--ff-hairline-card)] px-[18px] py-3">
                  <Link href={`/devices/${encodeURIComponent(device.mac)}?from=${encodeURIComponent(id)}`} className="min-w-0 flex-1 text-[14px] text-[var(--ff-accent)]">{device.hostname ?? "Unnamed device"}</Link>
                  <div className="font-mono text-[14px] text-[var(--ff-muted)]">{device.mac}</div>
                </div>
              ))
            )}
          </section>
          <button
            type="button"
            className="self-start text-[14px] font-semibold text-[var(--ff-danger)]"
            onClick={() =>
              void deleteGroup(store.mutate, group).then((result) => {
                if (result) router.replace(kind === "family" ? "/family" : "/things");
              })
            }
          >
            Delete group (devices become quarantined)
          </button>
        </div>
        <div className="flex min-w-0 flex-col gap-[18px]">
          <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
            <div className="px-[18px] pt-4 pb-3">
              <h2 className="flex items-center gap-1.5 text-[14px] font-normal" style={{ color: accessColor(group.access) }}>
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: accessColor(group.access) }} />
                {cardStateLabel(group, windows, timezone, new Date())}
              </h2>
              <p className="mt-0.5 text-[14px] text-[var(--ff-ink-3)]">{cardNoteLine(group, windows)}</p>
            </div>
            <div className="px-3 pb-3">
              <InternetZone
                group={group}
                windows={windows}
                timezone={timezone}
                surface="web"
                onPause={() => setSheet("pause")}
                onExtend={() => setSheet("extend")}
                editHref={`/rules?group=${group.id}`}
              />
            </div>
            <GroupFilterMarks
              group={group}
              rules={rules}
              catalogNames={catalogNames}
              upstreamCategories={upstreamCategories}
              timezone={timezone}
              showAppAdd
              onRulesChanged={() => void reload()}
            />
          </section>
        </div>
      </div>
      {sheet ? <PauseSheet group={group} mode={sheet} timezone={timezone} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

export function GroupDetailPage({ kind, params }: { kind: "family" | "things"; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GroupDetail kind={kind} id={id} />;
}
