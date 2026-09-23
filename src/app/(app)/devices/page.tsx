"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { DeviceAssignSelect, networkLabel } from "@/components/DeviceAssign";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { TogglePill } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { deviceIcon, deviceKindLabel } from "@/lib/display";
import type { Device, Group } from "@/lib/types";

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "assigned", label: "Assigned" },
  { id: "loose", label: "Unassigned" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

function ownerOf(device: Device, groups: Group[]) {
  return groups.find((group) => group.id === device.groupId) ?? null;
}

function ownerHref(group: Group) {
  return group.kind === "family" ? `/family/${group.id}` : `/things/${group.id}`;
}

export default function DevicesPage() {
  return (
    <Suspense fallback={<p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">Loading devices…</p>}>
      <DevicesBody />
    </Suspense>
  );
}

function DevicesBody() {
  const { devices, groups, unifi, household, mutate } = useAppData();
  const searchParams = useSearchParams();
  const assignGroupId = searchParams.get("assign");
  const assignGroup = groups.find((group) => group.id === assignGroupId) ?? null;
  const [filter, setFilter] = useState<FilterId>(assignGroup ? "loose" : "all");
  const [query, setQuery] = useState("");
  const networks = unifi?.networks ?? [];
  const unassigned = devices.filter((device) => device.assignment === "quarantined");
  const enforced = household?.quarantineEnforced === true;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices
      .filter((device) => {
        if (filter === "assigned") return device.assignment === "assigned";
        if (filter === "loose") return device.assignment === "quarantined";
        return true;
      })
      .filter((device) => {
        if (!q) return true;
        const owner = ownerOf(device, groups);
        const hay = [device.hostname ?? "", device.mac, device.ip ?? "", owner?.name ?? "unassigned"].join(" ").toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.hostname ?? a.mac).localeCompare(b.hostname ?? b.mac));
  }, [devices, filter, groups, query]);

  return (
    <>
      <PageHeader title="Devices" sub="Assignment is by MAC address and persists while a device is offline." />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {assignGroup ? (
          <section className="rounded-[12px] border border-[var(--ff-paused-line)] bg-[var(--ff-paused-fill)] px-[18px] py-3">
            <div className="text-[14px] font-semibold text-[var(--ff-paused)]">{assignGroup.name} needs devices</div>
            <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-muted)]">
              {assignGroup.name} has a bedtime but no assigned devices, so a UniFi policy cannot be created. Assign an
              unassigned device below.
            </p>
          </section>
        ) : null}
        {household ? (
        <section className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] px-[18px] py-3">
          <div className="min-w-0 flex-1">
            <div
              className="text-[14px] font-semibold"
              style={{ color: enforced ? undefined : "var(--ff-paused)" }}
            >
              {enforced
                ? "Quarantine unassigned devices"
                : "Quarantine is off — unassigned devices may have internet"}
            </div>
            <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-muted)]">
              New arrivals stay off the internet until assigned. Off is an emergency override on FamilyFi policies only.
            </p>
          </div>
          {/*
            The pill names the state quarantine is *in*. It used to name the action —
            reading "Off" while quarantine was being enforced — which is the one
            reading a household must not get wrong on this control.
          */}
          <TogglePill
            on={enforced}
            onToggle={() =>
              void mutate(() =>
                api("/api/v1/settings/household", {
                  method: "PUT",
                  body: JSON.stringify({ quarantineEnforced: !enforced }),
                }),
              )
            }
            label="Quarantine unassigned devices"
            onLabel="Enforced"
            offLabel="Off"
          />
        </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-0.5 rounded-lg bg-[var(--ff-field)] p-0.5">
            {FILTERS.map((item) => {
              const on = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className="rounded-md px-2.5 py-1.5 text-[14px] md:px-3.5"
                  style={{
                    fontWeight: on ? 600 : 500,
                    background: on ? "var(--ff-ink-on-fill)" : "transparent",
                    color: on ? "var(--ff-ink)" : "var(--ff-muted)",
                    boxShadow: on ? "var(--ff-shadow-knob)" : "none",
                  }}
                >
                  {item.label}
                  {item.id === "loose" && unassigned.length ? ` · ${unassigned.length}` : ""}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <input
            className="w-full max-w-[260px] rounded-[7px] border border-[var(--ff-input-line)] px-2.5 py-2 text-[16px] md:text-[14px]"
            placeholder="Search name, IP or MAC"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px] text-[14px] text-[var(--ff-muted)]">
            {devices.length === 0
              ? "No devices yet. New in-scope MACs appear as unassigned."
              : "Nothing matches this filter."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
            <div>
              <div className="ff-device-grid grid items-center gap-3.5 bg-[var(--ff-field-soft)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)]">
                <div>Device</div>
                <div className="hidden md:block">Belongs to</div>
                <div className="hidden xl:block">Address</div>
                <div className="hidden lg:block">Hardware</div>
                <div>Assign</div>
              </div>
              {rows.map((device) => {
                const owner = ownerOf(device, groups);
                const unassignedRow = device.assignment === "quarantined";
                const name = device.hostname ?? "Unnamed device";
                return (
                  <div
                    key={device.mac}
                    className="ff-device-grid grid items-center gap-3.5 border-t border-[var(--ff-hairline)] px-[18px] py-2.5 hover:bg-[var(--ff-field-soft)]"
                  >
                    {owner ? (
                      <Link href={ownerHref(owner)} className="flex min-w-0 items-center gap-2.5">
                        <DeviceMark hostname={device.hostname} />
                        <DeviceIdentity device={device} networks={networks} name={name} />
                      </Link>
                    ) : (
                      <div className="flex min-w-0 items-center gap-2.5">
                        <DeviceMark hostname={device.hostname} />
                        <DeviceIdentity device={device} networks={networks} name={name} />
                      </div>
                    )}
                    <div
                      className="hidden min-w-0 truncate text-[14px] md:block"
                      style={{ color: unassignedRow ? "var(--ff-danger)" : "var(--ff-ink)" }}
                    >
                      {owner?.name ?? "Unassigned"}
                    </div>
                    <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] xl:block">
                      {device.ip ?? "—"}
                    </div>
                    <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] lg:block">
                      {device.mac.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <DeviceAssignSelect device={device} groups={groups} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The device's type, as a glyph on the well.
 *
 * Decorative on purpose: `DeviceIdentity` renders the same type as a word right
 * beside it, so the icon is a second reading of the row rather than its only one.
 */
function DeviceMark({ hostname }: { hostname: string | null }) {
  return (
    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-[7px] bg-[var(--ff-well)] text-[var(--ff-muted)]">
      <Icon name={deviceIcon(hostname)} size={16} />
    </div>
  );
}

function DeviceIdentity({
  device,
  networks,
  name,
}: {
  device: Device;
  networks: { id: string; name: string; vlanId: number }[];
  name: string;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[14px]">{name}</div>
      <div className="mt-0.5 truncate text-[14px] text-[var(--ff-muted)]">
        {deviceKindLabel(device.hostname)}
        <span className="lg:hidden">
          {" "}
          · {device.mac.toUpperCase()}
          {device.ip ? ` · ${device.ip}` : ""}
        </span>
        {!device.inScope ? ` · ${networkLabel(device, networks)}` : ""}
      </div>
    </div>
  );
}
