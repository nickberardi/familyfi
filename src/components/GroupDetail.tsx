"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { accessColor, cardNoteLine, cardStateLabel } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import { PauseSheet } from "@/components/PauseSheet";
import { ScheduleBar } from "@/components/GroupCard";
import { groupActions } from "@/components/group-actions";
import type { Group } from "@/lib/types";

const FIELD = "rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]";

function GroupEditForm({ group }: { group: Group }) {
  const { mutate, busy, accounts } = useAppData();
  const lockedRole = Boolean(accounts.find((account) => !account.recovery && account.groupId === group.id));
  const [name, setName] = useState(group.name);
  const [familyRole, setFamilyRole] = useState<"child" | "teen" | "adult">(group.familyRole ?? "child");
  const [monogram, setMonogram] = useState(group.monogram ?? "");
  const [prot, setProt] = useState(group.protected);

  const trimmed = name.trim();
  const nextMonogram = monogram.trim() || null;
  const dirty =
    trimmed !== group.name ||
    prot !== group.protected ||
    (group.kind === "family" ? familyRole !== group.familyRole : nextMonogram !== group.monogram);

  async function onSave() {
    if (!trimmed || !dirty) return;
    await mutate(() =>
      api<{ group: Group; change: { changeId: string } }>(`/api/v1/groups/${group.id}`, {
        method: "PUT",
        body: JSON.stringify(
          group.kind === "family"
            ? { name: trimmed, familyRole, protected: prot }
            : { name: trimmed, monogram: nextMonogram, protected: prot },
        ),
      }),
    );
  }

  return (
    <section className="overflow-hidden rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white">
      <h2 className="border-b border-[rgba(60,60,67,.14)] px-[18px] py-4 text-[14px] font-semibold">Edit</h2>
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
                const role = e.target.value as "child" | "teen" | "adult";
                if (lockedRole && role !== "adult") return;
                setFamilyRole(role);
              }}
            >
              <option value="child" disabled={lockedRole}>
                Child
              </option>
              <option value="teen" disabled={lockedRole}>
                Teen
              </option>
              <option value="adult">Adult</option>
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)]">
            Monogram
            <input maxLength={4} className={FIELD} value={monogram} onChange={(e) => setMonogram(e.target.value)} />
          </label>
        )}
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={prot} onChange={(e) => setProt(e.target.checked)} />
          Protected — FamilyFi will not block this group
        </label>
        <button
          type="submit"
          disabled={busy || !dirty || !trimmed}
          className="self-start rounded-[9px] bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-white disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </section>
  );
}

export function GroupDetail({ kind, id }: { kind: "family" | "things"; id: string }) {
  const router = useRouter();
  const { groups, devices, household, mutate, loading } = useAppData();
  const group = groups.find((item) => item.id === id);
  const [sheet, setSheet] = useState<"pause" | "extend" | null>(null);
  if (!group) {
    if (loading) return null;
    return <p className="p-6 text-[14px] text-[var(--ff-muted)]">Group not found.</p>;
  }
  const members = devices.filter((device) => device.groupId === id);
  const timezone = household?.timezone ?? "America/New_York";
  const enabled = group.schedule.enabled && group.schedule.start && group.schedule.end;
  const actions = groupActions(
    group,
    "web",
    () => setSheet("pause"),
    () => setSheet("extend"),
    mutate,
  );

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <header>
        <Link href={kind === "family" ? "/family" : "/things"} className="text-[14px] font-semibold text-[var(--ff-accent)]">
          Back
        </Link>
        <h1 className="mt-2 text-[21px] font-bold tracking-tight">{group.name}</h1>
        <p className="mt-1 text-[14px]" style={{ color: accessColor(group.access) }}>
          {cardStateLabel(group, timezone)}
        </p>
      </header>
      <GroupEditForm key={group.id} group={group} />
      <section className="overflow-hidden rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white">
        <h2 className="border-b border-[rgba(60,60,67,.14)] px-[18px] py-4 text-[14px] font-semibold">Current state</h2>
        <div className="p-[18px]">
          <p className="text-[14px] text-[var(--ff-muted)]">{cardNoteLine(group)}</p>
          <div className="mt-3">
            <ScheduleBar
              start={enabled ? group.schedule.start : null}
              end={enabled ? group.schedule.end : null}
              timezone={timezone}
            />
          </div>
          {group.protected ? (
            <p className="mt-3 text-[14px] text-[var(--ff-muted)]">Protected groups do not use Pause or bedtime.</p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {actions.map((action) => {
                const className = action.strong
                  ? "rounded-lg bg-[var(--ff-accent)] px-3.5 py-2 text-[14px] font-semibold text-white"
                  : "rounded-lg border border-[var(--ff-line)] px-3.5 py-2 text-[14px] font-semibold text-[var(--ff-accent)]";
                if (action.href && action.label !== "Detail" && action.label !== "View devices") {
                  return (
                    <Link key={action.label} href={action.href} className={className}>
                      {action.label === "Rules" ? "Rules" : action.label}
                    </Link>
                  );
                }
                if (action.onClick) {
                  return (
                    <button key={action.label} type="button" className={className} onClick={action.onClick}>
                      {action.label === "Pause"
                        ? group.mode === "always"
                          ? "Pause"
                          : "Pause schedule"
                        : action.label === "Resume"
                          ? group.mode === "always"
                            ? "Resume"
                            : "Resume schedule"
                          : action.label}
                    </button>
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>
      </section>
      <section className="overflow-hidden rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white">
        <h2 className="border-b border-[rgba(60,60,67,.14)] px-[18px] py-4 text-[14px] font-semibold">Devices</h2>
        {members.length === 0 ? (
          <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
            No devices assigned.
            {group.mode === "always" || group.schedule.enabled ? (
              <>
                {" "}
                {group.mode === "always" ? "Always On" : "Bedtime"} cannot apply on UniFi until you{" "}
                <Link href={`/devices?assign=${id}`} className="font-semibold text-[var(--ff-accent)]">
                  assign a device
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : (
          members.map((device) => (
            <div key={device.mac} className="flex items-center gap-3 border-t border-[rgba(60,60,67,.14)] px-[18px] py-3">
              <div className="min-w-0 flex-1 text-[14px]">{device.hostname ?? "Unnamed device"}</div>
              <div className="font-mono text-[14px] text-[var(--ff-muted)]">{device.mac}</div>
            </div>
          ))
        )}
      </section>
      <button
        type="button"
        className="self-start text-[14px] font-semibold text-[var(--ff-danger)]"
        onClick={() =>
          void mutate(async () => {
            const result = await api<{ change: { changeId: string } }>(`/api/v1/groups/${id}`, { method: "DELETE" });
            router.replace(kind === "family" ? "/family" : "/things");
            return { ...result, removedGroupId: id };
          })
        }
      >
        Delete group (devices become quarantined)
      </button>
      {sheet ? <PauseSheet group={group} mode={sheet} timezone={timezone} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

export function GroupDetailPage({ kind, params }: { kind: "family" | "things"; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GroupDetail kind={kind} id={id} />;
}
