"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { internetWindowsForGroup } from "@/lib/rules";
import { accessColor, cardNoteLine, cardStateLabel } from "@/lib/display";
import { useAppData } from "@/components/AppDataProvider";
import { GroupFilterMarks } from "@/components/FilterMarks";
import { PauseSheet } from "@/components/PauseSheet";
import { FilterSchedule } from "@/components/GroupCard";
import { useFilterCatalog } from "@/components/GroupGrid";
import { InternetZone } from "@/components/InternetZone";
import { GroupResolverCard } from "@/components/upstream/GroupResolverCard";
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
    <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <h2 className="border-b border-[var(--ff-hairline-card)] px-[18px] py-4 text-[14px] font-semibold">Edit</h2>
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
  const { groups, devices, rules, household, mutate, reload, loading } = useAppData();
  const [groupResolver, setGroupResolver] = useState<{ source: "doh" | "dhcp" | "unknown"; networks: { id: string; name: string; servers: string[]; reason: string | null }[]; reason: string | null } | null>(null);
  const group = groups.find((item) => item.id === id);
  const [sheet, setSheet] = useState<"pause" | "extend" | null>(null);
  const { catalogNames, upstreamCategories } = useFilterCatalog();

  // The effective source may be this group's DoH override or its devices' networks.
  useEffect(() => {
    const start = window.setTimeout(() => {
      void api<{ resolver: NonNullable<typeof groupResolver> }>(`/api/v1/groups/${id}/resolver`)
        .then((res) => setGroupResolver(res.resolver))
        .catch(() => setGroupResolver(null));
    }, 0);
    return () => window.clearTimeout(start);
  }, [id]);

  if (!group) {
    if (loading) return null;
    return <p className="p-6 text-[14px] text-[var(--ff-muted)]">Group not found.</p>;
  }
  const members = devices.filter((device) => device.groupId === id);
  const timezone = household?.timezone ?? "America/New_York";
  const windows = internetWindowsForGroup(rules, group.id);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <header>
        <Link href={kind === "family" ? "/family" : "/things"} className="text-[14px] font-semibold text-[var(--ff-accent)]">
          Back
        </Link>
        <h1 className="mt-2 text-[21px] font-bold tracking-tight">{group.name}</h1>
        <p className="mt-1 text-[14px]" style={{ color: accessColor(group.access) }}>
          {cardStateLabel(group, windows, timezone, new Date())}
        </p>
      </header>
      <GroupEditForm key={group.id} group={group} />
      <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
        <div className="flex items-baseline border-b border-[var(--ff-hairline-card)] px-[18px] py-4">
          <h2 className="flex-1 text-[14px] font-semibold">Current state</h2>
          <Link href={`/rules?group=${group.id}`} className="text-[14px] font-semibold text-[var(--ff-accent)]">
            Rules
          </Link>
        </div>
        <div className="p-3">
          <p className="mb-3 px-1.5 text-[14px] text-[var(--ff-muted)]">{cardNoteLine(group, windows)}</p>
          <InternetZone
            group={group}
            windows={windows}
            timezone={timezone}
            surface="web"
            onPause={() => setSheet("pause")}
            onExtend={() => setSheet("extend")}
          />
        </div>
        {!group.protected ? (
          <>
            <GroupFilterMarks
              group={group}
              rules={rules}
              catalogNames={catalogNames}
              upstreamCategories={upstreamCategories}
              timezone={timezone}
              showAppAdd
              onRulesChanged={() => void reload()}
            />
            <FilterSchedule group={group} rules={rules} catalogNames={catalogNames} timezone={timezone} />
          </>
        ) : null}
      </section>
      <GroupResolverCard
        groupId={group.id}
        groupName={group.name}
        dohOverrideUrl={group.dohOverrideUrl ?? null}
        resolver={groupResolver}
        onChanged={() => {
          void reload();
          void api<{ resolver: NonNullable<typeof groupResolver> }>(`/api/v1/groups/${id}/resolver`)
            .then((res) => setGroupResolver(res.resolver))
            .catch(() => setGroupResolver(null));
        }}
      />
      <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
        <h2 className="border-b border-[var(--ff-hairline-card)] px-[18px] py-4 text-[14px] font-semibold">Devices</h2>
        {members.length === 0 ? (
          <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
            No devices assigned.
            {group.internetRuleIds.length || group.suspension.active ? (
              <>
                {" "}
                Its rules cannot apply on UniFi until you{" "}
                <Link href={`/devices?assign=${id}`} className="font-semibold text-[var(--ff-accent)]">
                  assign a device
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : (
          members.map((device) => (
            <div key={device.mac} className="flex items-center gap-3 border-t border-[var(--ff-hairline-card)] px-[18px] py-3">
              <Link href={`/devices/${encodeURIComponent(device.mac)}`} className="min-w-0 flex-1 text-[14px] text-[var(--ff-accent)]">{device.hostname ?? "Unnamed device"}</Link>
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
