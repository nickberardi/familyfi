"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import {
  D6_CATEGORY_SLOTS,
  appRulesForGroup,
  categoryRuleForSlot,
  glyphForAppName,
  parentFacingRuleLabel,
  type FamRule,
  type D6Slot,
} from "@/lib/fam-rules";
import { useAppData } from "./AppDataProvider";
import type { Group } from "@/lib/types";

type DpiItem = { id: number; name: string };

type FilterSheetState =
  | {
      kind: "category";
      name: string;
      categoryId: number;
      rule: FamRule | undefined;
    }
  | {
      kind: "app";
      name: string;
      rule: FamRule;
    };

function CategoryGlyph({ slot }: { slot: D6Slot }) {
  if (slot === "video") {
    return (
      <span
        aria-hidden
        className="block h-0 w-0 border-y-[5px] border-y-transparent border-l-[8px] border-l-current"
        style={{ marginLeft: 1.5 }}
      />
    );
  }
  if (slot === "social") {
    return (
      <span aria-hidden className="relative block h-[10px] w-[15px]">
        <span className="absolute left-0 top-0 h-[10px] w-[10px] rounded-full border-[1.4px] border-current" />
        <span className="absolute right-0 top-0 h-[10px] w-[10px] rounded-full border-[1.4px] border-current" />
      </span>
    );
  }
  return (
    <span aria-hidden className="relative block h-[11px] w-[17px] rounded-[4px] border-[1.4px] border-current">
      <span className="absolute left-[3px] top-[2.8px] h-[2.5px] w-[2.5px] rounded-full bg-current" />
      <span className="absolute right-[3px] top-[2.8px] h-[2.5px] w-[2.5px] rounded-full bg-current" />
    </span>
  );
}

function MarkButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-12 flex-col items-center gap-1"
      aria-label={`${label} ${on ? "On" : "Off"}`}
    >
      <div
        className="flex h-[30px] w-[30px] items-center justify-center rounded-full"
        style={
          on
            ? { background: "var(--ff-accent)", color: "#fff" }
            : { background: "rgba(120,120,128,.12)", color: "rgba(60,60,67,.6)" }
        }
      >
        {children}
      </div>
      <div className="text-center text-[9.5px] leading-tight text-[rgba(60,60,67,.7)]">{label}</div>
      <div
        className="text-[8.5px] font-semibold"
        style={{ color: on ? "var(--ff-accent)" : "rgba(60,60,67,.6)" }}
      >
        {on ? "On" : "Off"}
      </div>
    </button>
  );
}

function FilterSheet({
  group,
  state,
  onClose,
  onChanged,
}: {
  group: Group;
  state: FilterSheetState;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { mutate } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const on = Boolean(state.rule?.enabled);

  async function turnOff() {
    if (!state.rule || busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate(() => api(`/api/v1/rules/${state.rule!.id}/off`, { method: "POST", body: "{}" }));
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn off.");
    } finally {
      setBusy(false);
    }
  }

  async function createOrEnable() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (state.rule && !state.rule.enabled) {
        await mutate(() =>
          api(`/api/v1/rules/${state.rule!.id}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: true }),
          }),
        );
      } else if (state.kind === "category" && !state.rule) {
        await mutate(() =>
          api("/api/v1/rules", {
            method: "POST",
            body: JSON.stringify({
              kind: "category",
              scope: "group",
              groupId: group.id,
              targetIds: [state.categoryId],
              mode: "always",
            }),
          }),
        );
      } else {
        setError("Nothing to create.");
        setBusy(false);
        return;
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create policy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center bg-black/32 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="filter-sheet-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(0,0,0,.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        {on ? (
          <div className="flex flex-col gap-2.5 p-5">
            <h2 id="filter-sheet-title" className="text-[16px] font-bold tracking-tight">
              {state.name} · blocked
            </h2>
            <p className="text-[13px] leading-snug text-[var(--ff-muted)]">
              Its own policy, its own controls — scoped to {state.name} only.
            </p>
            {error ? <p className="text-[13px] text-[var(--ff-danger,#ff3b30)]">{error}</p> : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void turnOff()}
              className="mt-1 rounded-[9px] bg-[rgba(255,59,48,.1)] py-2.5 text-center text-[14px] font-semibold text-[#ff3b30] disabled:opacity-50"
            >
              Turn off
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 p-5">
            <h2 id="filter-sheet-title" className="text-[16px] font-bold tracking-tight">
              Nothing&apos;s blocking {state.name} yet
            </h2>
            <p className="text-[13px] leading-snug text-[var(--ff-muted)]">
              Create a FamilyFi policy? Pausable and schedulable afterward, same as Internet.
            </p>
            {error ? <p className="text-[13px] text-[var(--ff-danger,#ff3b30)]">{error}</p> : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void createOrEnable()}
              className="mt-1 rounded-[9px] bg-[var(--ff-accent)] py-2.5 text-center text-[14px] font-semibold text-white disabled:opacity-50"
            >
              Create policy
            </button>
          </div>
        )}
        <button
          type="button"
          className="w-full border-t border-[rgba(60,60,67,.14)] py-3 text-center text-[14px] text-[var(--ff-muted)]"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddAppSheet({
  group,
  onClose,
  onCreated,
}: {
  group: Group;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { mutate } = useAppData();
  const [filter, setFilter] = useState("");
  const [catalog, setCatalog] = useState<DpiItem[]>([]);
  const [selectedDpiId, setSelectedDpiId] = useState<number | "">("");
  const [enforcement, setEnforcement] = useState<"always" | "scheduled">("always");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const path = `/api/v1/dpi/applications${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
    void api<{ applications?: DpiItem[] }>(path)
      .then((res) => {
        if (!cancelled) {
          setCatalog(res.applications ?? []);
          setError("");
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setCatalog([]);
          setError(err.message || "Could not load DPI catalog.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const seg = (active: boolean) =>
    active
      ? { background: "#fff", color: "var(--ff-ink)", boxShadow: "0 0 0 1px rgba(60,60,67,.12)" }
      : { background: "transparent", color: "var(--ff-muted)" };

  async function create() {
    if (selectedDpiId === "" || busy) return;
    setBusy(true);
    setError("");
    try {
      await mutate(() =>
        api("/api/v1/rules", {
          method: "POST",
          body: JSON.stringify({
            kind: "app",
            scope: "group",
            groupId: group.id,
            targetIds: [selectedDpiId],
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
    <div
      className="fixed inset-0 z-[81] flex items-center justify-center bg-black/32 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-app-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(0,0,0,.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 pt-[18px] pb-1">
          <h2 id="add-app-title" className="text-[17px] font-bold tracking-tight">
            Add app filter
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-[var(--ff-muted)]">
            Blocks an app for {group.name}. Integer UniFi DPI ids only.
          </p>
        </div>
        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">App</div>
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
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--ff-muted)]">Enforcement</div>
            <div className="flex gap-0.5 rounded-[8px] bg-[rgba(120,120,128,.12)] p-0.5">
              <button
                type="button"
                className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold"
                style={seg(enforcement === "always")}
                onClick={() => setEnforcement("always")}
              >
                Always
              </button>
              <button
                type="button"
                className="flex-1 rounded-[6px] py-1.5 text-center text-[13px] font-semibold"
                style={seg(enforcement === "scheduled")}
                onClick={() => setEnforcement("scheduled")}
              >
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
            disabled={busy || selectedDpiId === ""}
            onClick={() => void create()}
            className="flex-1 border-l border-[rgba(60,60,67,.14)] py-3 text-center text-[14px] font-semibold disabled:cursor-not-allowed disabled:text-[rgba(60,60,67,.35)]"
            style={selectedDpiId !== "" && !busy ? { color: "var(--ff-accent)" } : undefined}
          >
            Create policy
          </button>
        </div>
      </div>
    </div>
  );
}

export function GroupFilterMarks({
  group,
  rules,
  catalogNames,
  showAppAdd,
  onRulesChanged,
}: {
  group: Group;
  rules: FamRule[];
  catalogNames: Map<string, string>;
  /** App + tile — GroupDetail only (A5). */
  showAppAdd?: boolean;
  onRulesChanged: () => void;
}) {
  const [sheet, setSheet] = useState<FilterSheetState | null>(null);
  const [addApp, setAddApp] = useState(false);

  if (group.protected) return null;

  const apps = appRulesForGroup(rules, group.id);

  return (
    <>
      <div
        className="border-t border-[rgba(60,60,67,.1)] px-[18px] pb-2.5 pt-2"
        data-testid={`filter-marks-${group.id}`}
      >
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[rgba(60,60,67,.55)]">
          Category Rules
        </div>
        <div className="flex flex-wrap gap-3 py-2">
          {D6_CATEGORY_SLOTS.map((slot) => {
            const rule = categoryRuleForSlot(rules, group.id, slot.categoryId);
            const on = Boolean(rule?.enabled);
            return (
              <MarkButton
                key={slot.slot}
                label={slot.label}
                on={on}
                onClick={() =>
                  setSheet({
                    kind: "category",
                    name: slot.label,
                    categoryId: slot.categoryId,
                    rule,
                  })
                }
              >
                <CategoryGlyph slot={slot.slot} />
              </MarkButton>
            );
          })}
        </div>
        <div className="border-t border-[rgba(60,60,67,.1)] pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[rgba(60,60,67,.55)]">
          App Rules
        </div>
        <div className="flex flex-wrap gap-3 py-2 pb-1">
          {apps.map((rule) => {
            const name = parentFacingRuleLabel(rule, catalogNames);
            const on = rule.enabled;
            return (
              <MarkButton
                key={rule.id}
                label={name}
                on={on}
                onClick={() => setSheet({ kind: "app", name, rule })}
              >
                <span className="text-[8px] font-bold">{glyphForAppName(name)}</span>
              </MarkButton>
            );
          })}
          {showAppAdd ? (
            <button
              type="button"
              onClick={() => setAddApp(true)}
              className="flex w-12 flex-col items-center gap-1"
              aria-label="Add app filter"
            >
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-[1.5px] border-dashed border-[rgba(60,60,67,.35)] text-[15px] font-light leading-none text-[var(--ff-accent)]">
                +
              </div>
              <div className="text-center text-[9.5px] font-semibold leading-tight text-[var(--ff-accent)]">Add</div>
            </button>
          ) : null}
        </div>
      </div>
      {sheet ? (
        <FilterSheet
          group={group}
          state={sheet}
          onClose={() => setSheet(null)}
          onChanged={onRulesChanged}
        />
      ) : null}
      {addApp ? (
        <AddAppSheet group={group} onClose={() => setAddApp(false)} onCreated={onRulesChanged} />
      ) : null}
    </>
  );
}
