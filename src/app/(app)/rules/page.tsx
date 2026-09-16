"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { initials } from "@/lib/display";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { D6_CATEGORY_SLOTS, parentFacingRuleLabel } from "@/lib/fam-rules";
import type { Group } from "@/lib/types";

type FamRule = {
  id: string;
  kind: "category" | "app";
  scope: "group" | "network";
  groupId: string | null;
  networkIds: string[];
  targetIds: number[];
  enabled: boolean;
  mode: "always" | "scheduled";
  schedule: { enabled: boolean; days: number[]; start: string | null; end: string | null };
  internet: false;
};

type DpiItem = { id: number; name: string };

type D6Slot = {
  slot: "video" | "social" | "gaming";
  label: string;
  categoryId: number;
  catalogName: string;
};

const DAYS = [
  { value: 0, label: "S" },
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
];

function asHm(value: string) {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function RuleMark({ group }: { group: Group }) {
  if (group.kind === "things") {
    const mark = (group.monogram ?? group.name.slice(0, 2)).slice(0, 4);
    return (
      <div
        className="flex h-6 w-6 flex-none items-center justify-center rounded-[6px] bg-[var(--ff-mark)] font-bold text-white"
        style={{ fontSize: mark.length > 2 ? 8 : 9 }}
      >
        {mark}
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[rgba(52,199,89,.16)] text-[11px] font-semibold text-[var(--ff-on)]">
      {initials(group.name).slice(0, 1)}
    </div>
  );
}

function NestedRuleRow({
  rule,
  label,
  onChanged,
}: {
  rule: FamRule;
  label: string;
  onChanged: () => void;
}) {
  const { mutate } = useAppData();
  async function turnOff() {
    await mutate(() => api(`/api/v1/rules/${rule.id}/off`, { method: "POST", body: "{}" }));
    onChanged();
  }
  async function remove() {
    await mutate(() => api(`/api/v1/rules/${rule.id}`, { method: "DELETE" }));
    onChanged();
  }
  return (
    <div className="flex items-center gap-3 border-t border-[rgba(60,60,67,.08)] bg-[rgba(120,120,128,.04)] px-4 py-2.5 md:px-[18px] md:pl-12">
      <div className="min-w-0 flex-1 truncate text-[13px] text-[var(--ff-muted)]">
        <span className="font-semibold text-[var(--ff-ink)]">{rule.kind === "category" ? "Category" : "App"}</span>
        <span className="mx-1.5">·</span>
        <span>{label}</span>
        {!rule.enabled ? <span className="ml-2 text-[12px] font-semibold text-[var(--ff-muted)]">Off</span> : null}
      </div>
      <div className="flex flex-none gap-2">
        {rule.enabled ? (
          <button type="button" onClick={() => void turnOff()} className="text-[13px] font-semibold text-[var(--ff-muted)]">
            Turn off
          </button>
        ) : null}
        <button type="button" onClick={() => void remove()} aria-label={`Delete ${label}`} className="text-[13px] font-semibold text-[var(--ff-danger,#ff3b30)]">
          ×
        </button>
      </div>
    </div>
  );
}

function RuleRow({ group, childRules, labels, onRulesChanged }: { group: Group; childRules: FamRule[]; labels: Map<string, string>; onRulesChanged: () => void }) {
  return (
    <RuleRowForm
      key={`${group.id}:${group.mode}:${group.schedule.enabled}:${group.schedule.start}:${group.schedule.end}:${group.schedule.days.join(",")}`}
      group={group}
      childRules={childRules}
      labels={labels}
      onRulesChanged={onRulesChanged}
    />
  );
}

function RuleRowForm({
  group,
  childRules,
  labels,
  onRulesChanged,
}: {
  group: Group;
  childRules: FamRule[];
  labels: Map<string, string>;
  onRulesChanged: () => void;
}) {
  const { mutate } = useAppData();
  const scheduled = group.mode === "scheduled" || group.schedule.enabled;
  const [enabled, setEnabled] = useState(scheduled);
  const [start, setStart] = useState(asHm(group.schedule.start ?? "21:00"));
  const [end, setEnd] = useState(asHm(group.schedule.end ?? "07:00"));
  const [days, setDays] = useState<number[]>(
    group.schedule.days.length ? group.schedule.days : [0, 1, 2, 3, 4, 5, 6],
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function persist(next: { enabled: boolean; days: number[]; start: string; end: string }) {
    const startHm = asHm(next.start);
    const endHm = asHm(next.end);
    if (next.enabled && startHm === endHm) return;
    if (next.enabled && next.days.length === 0) return;
    await mutate(() =>
      api(`/api/v1/groups/${group.id}/schedule`, {
        method: "PUT",
        body: JSON.stringify({ enabled: next.enabled, days: next.days, start: startHm, end: endHm }),
      }),
    );
  }

  function queueTime(nextStart: string, nextEnd: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void persist({ enabled: true, days, start: nextStart, end: nextEnd });
    }, 400);
  }

  function toggleDay(day: number) {
    if (!enabled) return;
    const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort();
    if (next.length === 0) return;
    setDays(next);
    void persist({ enabled: true, days: next, start, end });
  }

  function setMode(nextEnabled: boolean) {
    if (nextEnabled === enabled) return;
    const nextDays = nextEnabled && days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
    setEnabled(nextEnabled);
    setDays(nextDays);
    void persist({ enabled: nextEnabled, days: nextDays, start, end });
  }

  const identity = (
    <div className="flex min-w-0 items-center gap-2.5">
      <RuleMark group={group} />
      <span className="min-w-0 truncate text-[14px] font-semibold">{group.name}</span>
      <span className="flex-none text-[14px] text-[var(--ff-muted)]">Internet</span>
    </div>
  );

  const times = (
    <>
      <label className="flex min-w-0 flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)] md:block md:font-normal">
        <span className="md:sr-only">Offline</span>
        <input
          type="time"
          aria-label="Offline"
          disabled={!enabled}
          className="w-full rounded-[7px] border border-[rgba(60,60,67,.22)] px-2 py-1.5 text-[16px] disabled:cursor-not-allowed disabled:opacity-40 md:w-[118px] md:text-[14px]"
          value={start}
          onChange={(event) => {
            const value = asHm(event.target.value);
            setStart(value);
            queueTime(value, end);
          }}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[14px] font-semibold text-[var(--ff-muted)] md:block md:font-normal">
        <span className="md:sr-only">Back on</span>
        <input
          type="time"
          aria-label="Back on"
          disabled={!enabled}
          className="w-full rounded-[7px] border border-[rgba(60,60,67,.22)] px-2 py-1.5 text-[16px] disabled:cursor-not-allowed disabled:opacity-40 md:w-[118px] md:text-[14px]"
          value={end}
          onChange={(event) => {
            const value = asHm(event.target.value);
            setEnd(value);
            queueTime(start, value);
          }}
        />
      </label>
    </>
  );

  const dayToggles = (
    <div className={`flex min-w-0 flex-nowrap gap-1 ${enabled ? "" : "pointer-events-none opacity-40"}`}>
      {DAYS.map((day, index) => {
        const on = days.includes(day.value);
        return (
          <button
            key={`${day.value}-${index}`}
            type="button"
            aria-pressed={on}
            aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day.value]}
            disabled={!enabled}
            onClick={() => toggleDay(day.value)}
            className="flex h-8 w-8 items-center justify-center rounded-[7px] border text-[14px] font-semibold disabled:cursor-not-allowed"
            style={{
              background: on ? "var(--ff-accent)" : "#fff",
              color: on ? "#fff" : "var(--ff-muted)",
              borderColor: on ? "var(--ff-accent)" : "rgba(60,60,67,.2)",
            }}
          >
            {day.label}
          </button>
        );
      })}
    </div>
  );

  const modeControl = (
    <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5" role="group" aria-label="Internet rule mode">
      <button
        type="button"
        aria-pressed={!enabled}
        onClick={() => setMode(false)}
        className="rounded-[6px] px-2.5 py-1.5 text-[13px] font-semibold"
        style={
          !enabled
            ? { background: "#fff", color: "var(--ff-ink)", boxShadow: "0 0 0 1px rgba(60,60,67,.12)" }
            : { background: "transparent", color: "var(--ff-muted)" }
        }
      >
        Always
      </button>
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => setMode(true)}
        className="rounded-[6px] px-2.5 py-1.5 text-[13px] font-semibold"
        style={
          enabled
            ? { background: "#fff", color: "var(--ff-ink)", boxShadow: "0 0 0 1px rgba(60,60,67,.12)" }
            : { background: "transparent", color: "var(--ff-muted)" }
        }
      >
        Scheduled
      </button>
    </div>
  );

  return (
    <div id={`group-${group.id}`} className="scroll-mt-24 border-t border-[rgba(60,60,67,.12)]">
      <div className="flex flex-col gap-3 p-4 md:hidden">
        <div className="flex items-center gap-3">
          {identity}
          <div className="ml-auto flex-none">{modeControl}</div>
        </div>
        {enabled ? (
          <>
            <div className="grid grid-cols-2 gap-3">{times}</div>
            {dayToggles}
          </>
        ) : null}
      </div>
      <div className="hidden items-center gap-3.5 px-[18px] py-2.5 md:grid md:grid-cols-[minmax(200px,1.5fr)_118px_118px_minmax(248px,1fr)_160px]">
        {identity}
        {enabled ? times : <><div /><div /></>}
        {enabled ? dayToggles : <div />}
        <div className="flex justify-end">{modeControl}</div>
      </div>
      {childRules.map((rule) => (
        <NestedRuleRow
          key={rule.id}
          rule={rule}
          label={parentFacingRuleLabel(rule, labels)}
          onChanged={onRulesChanged}
        />
      ))}
    </div>
  );
}

function NewRuleModal({
  onClose,
  groups,
  onCreated,
}: {
  onClose: () => void;
  groups: Group[];
  onCreated: () => void;
}) {
  const { mutate, unifi } = useAppData();
  const [scope, setScope] = useState<"member" | "network">("member");
  const [targetType, setTargetType] = useState<"category" | "app">("category");
  const [enforcement, setEnforcement] = useState<"always" | "scheduled">("always");
  const [targetId, setTargetId] = useState("");
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<DpiItem[]>([]);
  const [curatedSlots, setCuratedSlots] = useState<D6Slot[]>([]);
  const [selectedDpiId, setSelectedDpiId] = useState<number | "">("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedTargetId = groups.some((g) => g.id === targetId) ? targetId : (groups[0]?.id ?? "");

  const managedNetworks = (() => {
    if (!unifi) return [];
    if (unifi.manageAllNetworks) return unifi.networks ?? [];
    const allowed = new Set(unifi.managedNetworkIds ?? []);
    return (unifi.networks ?? []).filter((n) => allowed.has(n.id));
  })();
  const networkScopeAvailable = managedNetworks.length > 0;

  useEffect(() => {
    let cancelled = false;
    if (targetType === "category") {
      void api<{ categories?: DpiItem[]; d6?: { status: string; candidates: D6Slot[] } }>("/api/v1/dpi/categories")
        .then((res) => {
          if (cancelled) return;
          setCuratedSlots(res.d6?.candidates ?? []);
          setCatalog(res.categories ?? []);
          setError("");
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setCuratedSlots([]);
          setCatalog([]);
          setError(err.message || "Could not load DPI categories.");
        });
    } else {
      const path = `/api/v1/dpi/applications${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
      void api<{ applications?: DpiItem[] }>(path)
        .then((res) => {
          if (cancelled) return;
          setCatalog(res.applications ?? []);
          setError("");
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setCatalog([]);
          setError(err.message || "Could not load DPI catalog.");
        });
    }
    return () => {
      cancelled = true;
    };
  }, [targetType, filter]);

  const seg = (active: boolean) =>
    active
      ? { background: "#fff", color: "var(--ff-ink)", boxShadow: "0 0 0 1px rgba(60,60,67,.12)" }
      : { background: "transparent", color: "var(--ff-muted)" };

  function toggleNetwork(id: string) {
    setSelectedNetworkIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const canCreate =
    !busy &&
    selectedDpiId !== "" &&
    (scope === "member"
      ? Boolean(selectedTargetId)
      : networkScopeAvailable && selectedNetworkIds.length > 0);

  async function create() {
    if (!canCreate || typeof selectedDpiId !== "number") return;
    const dpiId = selectedDpiId;
    setBusy(true);
    setError("");
    try {
      await mutate(() =>
        api("/api/v1/rules", {
          method: "POST",
          body: JSON.stringify({
            kind: targetType,
            scope: scope === "network" ? "network" : "group",
            ...(scope === "network"
              ? { networkIds: selectedNetworkIds }
              : { groupId: selectedTargetId }),
            targetIds: [dpiId],
            mode: enforcement,
            ...(enforcement === "scheduled"
              ? { schedule: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: "21:00", end: "07:00" } }
              : {}),
          }),
        }),
      );
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/32 p-6" role="dialog" aria-modal="true" aria-labelledby="new-rule-title">
      <div className="w-full max-w-[420px] overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(0,0,0,.28)]">
        <div className="px-5 pt-[18px] pb-1">
          <h2 id="new-rule-title" className="text-[17px] font-bold tracking-tight">
            New rule
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-[var(--ff-muted)]">
            Blocks a category or app for one person, group, or managed network.
          </p>
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">Applies to</div>
            <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5">
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(scope === "member")} onClick={() => setScope("member")}>
                Person / group
              </button>
              <button
                type="button"
                className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={seg(scope === "network")}
                disabled={!networkScopeAvailable}
                aria-disabled={!networkScopeAvailable}
                onClick={() => networkScopeAvailable && setScope("network")}
              >
                Network
              </button>
            </div>
            {!networkScopeAvailable ? (
              <p className="mt-1.5 text-[13px] text-[var(--ff-muted)]" data-testid="network-scope-empty-helper">
                No managed networks in Settings — pick VLANs (or Watch every network) before using Network scope.
              </p>
            ) : null}
          </div>
          {scope === "member" ? (
            <select className="w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]" value={selectedTargetId} onChange={(e) => setTargetId(e.target.value)}>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          ) : networkScopeAvailable ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Managed networks">
              {managedNetworks.map((network) => {
                const active = selectedNetworkIds.includes(network.id);
                return (
                  <button
                    key={network.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleNetwork(network.id)}
                    className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
                    style={
                      active
                        ? { borderColor: "var(--ff-accent)", background: "rgba(0,122,255,.12)", color: "var(--ff-ink)" }
                        : { borderColor: "var(--ff-line)", background: "#fff", color: "var(--ff-muted)" }
                    }
                  >
                    {network.name}
                    <span className="ml-1 text-[11px] font-normal opacity-70">VLAN {network.vlanId}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[13px] text-[var(--ff-muted)]">
              No managed networks in Settings — Network scope is empty until you select VLANs (or enable manage-all).
            </p>
          )}
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">Target type</div>
            <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5">
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(targetType === "category")} onClick={() => { setTargetType("category"); setSelectedDpiId(""); }}>
                Category
              </button>
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(targetType === "app")} onClick={() => { setTargetType("app"); setSelectedDpiId(""); }}>
                App
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">{targetType === "category" ? "Category" : "App"}</div>
            {targetType === "category" ? (
              <>
                <div className="flex flex-col gap-1.5" role="group" aria-label="Curated category slots">
                  {curatedSlots.map((slot) => {
                    const active = selectedDpiId === slot.categoryId;
                    return (
                      <button
                        key={slot.slot}
                        type="button"
                        onClick={() => setSelectedDpiId(slot.categoryId)}
                        className="rounded-lg border px-3 py-2.5 text-left text-[15px] font-semibold"
                        style={
                          active
                            ? { borderColor: "var(--ff-accent)", background: "rgba(0,122,255,.08)", color: "var(--ff-ink)" }
                            : { borderColor: "var(--ff-line)", background: "#fff", color: "var(--ff-ink)" }
                        }
                      >
                        {slot.label}
                        <span className="ml-2 text-[12px] font-normal text-[var(--ff-muted)]">
                          {slot.catalogName}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[12px] text-[var(--ff-muted)]">
                  Curated slots: Video, Social, Gaming (confirmed D6). Integer UniFi DPI ids only — no free-text names in policy bodies.
                </p>
              </>
            ) : (
              <>
                <input
                  type="search"
                  placeholder="Search catalog"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="mb-2 w-full rounded-lg border border-[var(--ff-line)] px-3 py-2 text-[15px]"
                />
                <select
                  className="w-full rounded-lg border border-[var(--ff-line)] px-3 py-2.5 text-[16px]"
                  value={selectedDpiId === "" ? "" : String(selectedDpiId)}
                  onChange={(e) => setSelectedDpiId(e.target.value ? Number(e.target.value) : "")}
                  aria-label="DPI application"
                >
                  <option value="">Select…</option>
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[12px] text-[var(--ff-muted)]">
                  Integer UniFi DPI ids only — no free-text names in policy bodies.
                </p>
              </>
            )}
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">Enforcement</div>
            <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5">
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(enforcement === "always")} onClick={() => setEnforcement("always")}>
                Always
              </button>
              <button type="button" className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold" style={seg(enforcement === "scheduled")} onClick={() => setEnforcement("scheduled")}>
                Scheduled
              </button>
            </div>
          </div>
          {error ? <p className="text-[13px] text-[var(--ff-danger,#ff3b30)]">{error}</p> : null}
        </div>
        <div className="flex border-t border-[rgba(60,60,67,.14)]">
          <button type="button" onClick={onClose} className="flex-1 py-3 text-center text-[14px] text-[var(--ff-muted)]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void create()}
            className="flex-1 border-l border-[rgba(60,60,67,.14)] py-3 text-center text-[14px] font-semibold disabled:cursor-not-allowed disabled:text-[rgba(60,60,67,.35)]"
            style={canCreate ? { color: "var(--ff-accent)" } : undefined}
          >
            Create rule
          </button>
        </div>
      </div>
    </div>
  );
}

function NetworkRuleRow({
  rule,
  label,
  networkLabel,
  onChanged,
}: {
  rule: FamRule;
  label: string;
  networkLabel: string;
  onChanged: () => void;
}) {
  const { mutate } = useAppData();
  async function turnOff() {
    await mutate(() => api(`/api/v1/rules/${rule.id}/off`, { method: "POST", body: "{}" }));
    onChanged();
  }
  async function remove() {
    await mutate(() => api(`/api/v1/rules/${rule.id}`, { method: "DELETE" }));
    onChanged();
  }
  return (
    <div
      id={`net-rule-${rule.id}`}
      className="flex flex-col gap-2 border-t border-[rgba(60,60,67,.12)] p-4 md:flex-row md:items-center md:gap-3.5 md:px-[18px] md:py-2.5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex h-6 flex-none items-center justify-center rounded-[6px] bg-[rgba(0,122,255,.14)] px-1.5 text-[10px] font-bold tracking-wide text-[var(--ff-accent)]">
          NET
        </div>
        <div className="min-w-0 truncate text-[14px]">
          <span className="font-semibold">{networkLabel}</span>
          <span className="mx-1.5 text-[var(--ff-muted)]">·</span>
          <span className="text-[var(--ff-muted)]">
            {rule.kind === "category" ? "Category" : "App"} · {label}
          </span>
          {!rule.enabled ? <span className="ml-2 text-[12px] font-semibold text-[var(--ff-muted)]">Off</span> : null}
        </div>
      </div>
      <div className="flex flex-none gap-2 md:justify-end">
        {rule.enabled ? (
          <button type="button" onClick={() => void turnOff()} className="text-[13px] font-semibold text-[var(--ff-muted)]">
            Turn off
          </button>
        ) : null}
        <button type="button" onClick={() => void remove()} aria-label={`Delete network rule ${label}`} className="text-[13px] font-semibold text-[var(--ff-danger,#ff3b30)]">
          ×
        </button>
      </div>
    </div>
  );
}

export default function RulesPage() {
  const { groups, unifi } = useAppData();
  const rows = groups.filter((group) => !group.protected);
  const [newRuleOpen, setNewRuleOpen] = useState(false);
  const [rules, setRules] = useState<FamRule[]>([]);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());

  const networkNameById = new Map((unifi?.networks ?? []).map((n) => [n.id, n.name]));

  async function loadRules() {
    try {
      const [{ rules: next }, cats, apps] = await Promise.all([
        api<{ rules: FamRule[] }>("/api/v1/rules"),
        api<{ categories: DpiItem[] }>("/api/v1/dpi/categories").catch(() => ({ categories: [] as DpiItem[] })),
        api<{ applications: DpiItem[] }>("/api/v1/dpi/applications").catch(() => ({ applications: [] as DpiItem[] })),
      ]);
      setRules(next);
      const map = new Map<string, string>();
      for (const item of cats.categories) map.set(`category:${item.id}`, item.name);
      for (const item of apps.applications) map.set(`app:${item.id}`, item.name);
      for (const slot of D6_CATEGORY_SLOTS) map.set(`category:${slot.categoryId}`, slot.label);
      setLabels(map);
    } catch {
      setRules([]);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadRules();
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [rows]);

  const groupRules = rules.filter((rule) => rule.scope !== "network");
  const networkRules = rules.filter((rule) => rule.scope === "network");

  return (
    <>
      <PageHeader
        title="Rules"
        sub="Internet rules — desired configuration, applied on the next Sync."
        actionLabel="New rule"
        onAction={() => setNewRuleOpen(true)}
      />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {rows.length === 0 && networkRules.length === 0 ? (
          <p className="rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white p-[18px] text-[14px] text-[var(--ff-muted)]">
            Add a Family or Things group first. Protected groups have no FamilyFi Internet rules.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-[rgba(60,60,67,.14)] bg-white md:overflow-x-auto">
            <div className="md:min-w-[960px]">
              <div className="hidden grid-cols-[minmax(200px,1.5fr)_118px_118px_minmax(248px,1fr)_160px] items-center gap-3.5 bg-[rgba(120,120,128,.06)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)] md:grid">
                <div>Member</div>
                <div>Offline</div>
                <div>Back on</div>
                <div>Days</div>
                <div className="text-right">Mode</div>
              </div>
              {rows.map((group) => (
                <RuleRow
                  key={group.id}
                  group={group}
                  childRules={groupRules.filter((rule) => rule.groupId === group.id)}
                  labels={labels}
                  onRulesChanged={() => void loadRules()}
                />
              ))}
              {networkRules.map((rule) => {
                const networkLabel =
                  rule.networkIds
                    .map((id) => networkNameById.get(id) ?? id.slice(0, 8))
                    .join(", ") || "Network";
                return (
                  <NetworkRuleRow
                    key={rule.id}
                    rule={rule}
                    networkLabel={networkLabel}
                    label={parentFacingRuleLabel(rule, labels)}
                    onChanged={() => void loadRules()}
                  />
                );
              })}
            </div>
          </div>
        )}
        <p className="max-w-[70ch] text-[14px] leading-5 text-[var(--ff-muted)]">
          Each member row is the Internet parent for that Family or Things group. NET rows are network-scoped category/app
          rules on Settings-managed VLANs (UniFi source NETWORK). Nested filters use UniFi DPI integer ids. Always keeps the
          block on until you turn it off; Scheduled uses Offline / Back on times. Edits are desired configuration — Sync
          writes them to UniFi. Internet rows are not deletable.
        </p>
      </div>
      {newRuleOpen ? (
        <NewRuleModal
          key="new-rule"
          onClose={() => setNewRuleOpen(false)}
          groups={rows}
          onCreated={() => void loadRules()}
        />
      ) : null}
    </>
  );
}
