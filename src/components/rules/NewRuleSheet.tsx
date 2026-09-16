"use client";

/**
 * New rule sheet — scope, target, category/app, enforcement.
 *
 * Scope and kind pickers are the shared Segmented control rather than three more
 * copies of the same inline-styled ternary.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import { Segmented } from "@/components/ui/Segmented";
import { DayPicker } from "@/components/ui/DayPicker";
import { TimeField } from "@/components/ui/Controls";
import { D6_CATEGORY_SLOTS } from "@/lib/rules";
import type { Group } from "@/lib/types";

type DpiItem = { id: number; name: string };

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold" style={{ color: "var(--ff-ink-3)" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function NewRuleSheet({
  groups,
  onClose,
  onCreated,
}: {
  groups: Group[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { mutate, unifi } = useAppData();
  const [scope, setScope] = useState<"member" | "network">("member");
  const [targetType, setTargetType] = useState<"category" | "app">("category");
  const [enforcement, setEnforcement] = useState<"always" | "scheduled">("always");
  const [targetId, setTargetId] = useState("");
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<DpiItem[]>([]);
  const [selectedDpiId, setSelectedDpiId] = useState<number | "">("");
  const [filter, setFilter] = useState("");
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [start, setStart] = useState("21:00");
  const [end, setEnd] = useState("07:00");
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
    const path =
      targetType === "category"
        ? "/api/v1/dpi/categories"
        : `/api/v1/dpi/applications${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;

    void api<{ categories?: DpiItem[]; applications?: DpiItem[] }>(path)
      .then((res) => {
        if (cancelled) return;
        setCatalog(res.categories ?? res.applications ?? []);
        setError("");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setCatalog([]);
        setError(err.message || "Could not load the DPI catalog.");
      });

    return () => {
      cancelled = true;
    };
  }, [targetType, filter]);

  const canCreate =
    !busy &&
    selectedDpiId !== "" &&
    (scope === "member"
      ? Boolean(selectedTargetId)
      : networkScopeAvailable && selectedNetworkIds.length > 0);

  async function create() {
    if (!canCreate || typeof selectedDpiId !== "number") return;
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
            targetIds: [selectedDpiId],
            mode: enforcement,
            ...(enforcement === "scheduled"
              ? { schedule: { enabled: true, days, start, end } }
              : {}),
          }),
        }),
      );
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "var(--ff-scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-rule-title"
    >
      <div
        className="max-h-full w-full max-w-[420px] overflow-y-auto rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "var(--ff-shadow-sheet)" }}
      >
        <div className="px-5 pb-1 pt-[18px]">
          <h2 id="new-rule-title" className="text-[17px] font-bold tracking-tight">
            New rule
          </h2>
          <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            Blocks a category or app for one person, group, or managed network.
          </p>
        </div>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <Field label="Applies to">
            <Segmented
              name="Rule scope"
              grow
              value={scope}
              onChange={setScope}
              segments={[
                { value: "member", label: "Person / group" },
                { value: "network", label: "Network", disabled: !networkScopeAvailable },
              ]}
            />
            {!networkScopeAvailable ? (
              <p
                className="mt-1.5 text-[13px]"
                style={{ color: "var(--ff-ink-3)" }}
                data-testid="network-scope-empty-helper"
              >
                No managed networks in Settings — pick VLANs (or Watch every network) before using
                Network scope.
              </p>
            ) : null}
          </Field>

          {scope === "member" ? (
            <select
              className="w-full rounded-lg border px-3 py-2.5 text-[16px]"
              style={{ borderColor: "var(--ff-line)" }}
              aria-label="Person or group"
              value={selectedTargetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Managed networks">
              {managedNetworks.map((network) => {
                const active = selectedNetworkIds.includes(network.id);
                return (
                  <button
                    key={network.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setSelectedNetworkIds((prev) =>
                        prev.includes(network.id)
                          ? prev.filter((x) => x !== network.id)
                          : [...prev, network.id],
                      )
                    }
                    className="rounded-full border px-3 py-1.5 text-[13px] font-semibold"
                    style={{
                      borderColor: active ? "var(--ff-accent)" : "var(--ff-line)",
                      background: active ? "var(--ff-accent-tint)" : "var(--ff-card)",
                      color: active ? "var(--ff-ink)" : "var(--ff-ink-3)",
                    }}
                  >
                    {network.name}
                    <span className="ml-1 text-[11px] font-normal opacity-70">
                      VLAN {network.vlanId}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <Field label="Target type">
            <Segmented
              name="Target type"
              grow
              value={targetType}
              onChange={(next) => {
                setTargetType(next);
                setSelectedDpiId("");
              }}
              segments={[
                { value: "category", label: "Category" },
                { value: "app", label: "App" },
              ]}
            />
          </Field>

          <Field label={targetType === "category" ? "Category" : "App"}>
            {targetType === "category" ? (
              <>
                <div className="flex flex-col gap-1.5" role="group" aria-label="Curated category slots">
                  {D6_CATEGORY_SLOTS.map((slot) => {
                    const active = selectedDpiId === slot.categoryId;
                    return (
                      <button
                        key={slot.slot}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedDpiId(slot.categoryId)}
                        className="rounded-lg border px-3 py-2.5 text-left text-[15px] font-semibold"
                        style={{
                          borderColor: active ? "var(--ff-accent)" : "var(--ff-line)",
                          background: active ? "var(--ff-accent-tint)" : "var(--ff-card)",
                        }}
                      >
                        {slot.label}
                        <span
                          className="ml-2 text-[12px] font-normal"
                          style={{ color: "var(--ff-ink-3)" }}
                        >
                          {slot.catalogName}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[12px]" style={{ color: "var(--ff-ink-3)" }}>
                  Curated slots: Video, Social, Gaming.
                </p>
              </>
            ) : (
              <>
                <input
                  type="search"
                  placeholder="Search catalog"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="mb-2 w-full rounded-lg border px-3 py-2 text-[15px]"
                  style={{ borderColor: "var(--ff-line)" }}
                />
                <select
                  className="w-full rounded-lg border px-3 py-2.5 text-[16px]"
                  style={{ borderColor: "var(--ff-line)" }}
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
              </>
            )}
          </Field>

          <Field label="Enforcement">
            <Segmented
              name="Enforcement"
              grow
              value={enforcement}
              onChange={setEnforcement}
              segments={[
                { value: "always", label: "Always" },
                { value: "scheduled", label: "Scheduled" },
              ]}
            />
            {enforcement === "scheduled" ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                <TimeField label="Offline" value={start} onChange={setStart} />
                <TimeField label="Back on" value={end} onChange={setEnd} />
                <DayPicker
                  days={days}
                  onToggle={(day) =>
                    setDays((prev) =>
                      prev.includes(day)
                        ? prev.length > 1
                          ? prev.filter((d) => d !== day)
                          : prev
                        : [...prev, day].sort(),
                    )
                  }
                />
              </div>
            ) : (
              <p className="mt-1.5 text-[12px]" style={{ color: "var(--ff-locked)" }}>
                Blocks at all times.
              </p>
            )}
          </Field>

          {error ? (
            <p className="text-[13px]" style={{ color: "var(--ff-danger)" }}>
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex" style={{ borderTop: "1px solid var(--ff-hairline-card)" }}>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 text-center text-[14px]"
            style={{ color: "var(--ff-ink-3)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => void create()}
            className="flex-1 py-3 text-center text-[14px] font-semibold disabled:cursor-not-allowed"
            style={{
              borderLeft: "1px solid var(--ff-hairline-card)",
              color: canCreate ? "var(--ff-accent)" : "var(--ff-locked)",
            }}
          >
            Create rule
          </button>
        </div>
      </div>
    </div>
  );
}
