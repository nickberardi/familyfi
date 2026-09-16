"use client";

/**
 * "Add app filter" — a member-page action only.
 *
 * Categories are a fixed catalog with nothing to add, so only app rules get an
 * entry point, and never from the family-list card.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppData } from "@/components/AppDataProvider";
import { Segmented } from "@/components/ui/Segmented";
import type { Group } from "@/lib/types";

type DpiItem = { id: number; name: string };

export function AddAppSheet({
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
        if (cancelled) return;
        setCatalog(res.applications ?? []);
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
  }, [filter]);

  const canCreate = selectedDpiId !== "" && !busy;

  async function create() {
    if (!canCreate) return;
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
              ? {
                  schedule: {
                    enabled: true,
                    days: [0, 1, 2, 3, 4, 5, 6],
                    start: "21:00",
                    end: "07:00",
                  },
                }
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
      className="fixed inset-0 z-[81] flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,.32)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-app-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-[14px]"
        style={{ background: "var(--ff-card)", boxShadow: "0 24px 60px rgba(0,0,0,.28)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-[18px]">
          <h2 id="add-app-title" className="text-[17px] font-bold tracking-tight">
            Add app filter
          </h2>
          <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--ff-ink-3)" }}>
            Blocks an app for {group.name}.
          </p>
        </div>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold" style={{ color: "var(--ff-ink-3)" }}>
              App
            </div>
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
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-semibold" style={{ color: "var(--ff-ink-3)" }}>
              Enforcement
            </div>
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
          </div>

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
            Create policy
          </button>
        </div>
      </div>
    </div>
  );
}
