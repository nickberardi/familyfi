"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DeviceAssignSelect, networkLabel } from "@/components/DeviceAssign";
import { assignDevicesCopy, deviceName } from "@/lib/device-assign";
import {
  DEVICE_FILTERS,
  DEVICES_COPY as COPY,
  deviceFilterLabel,
  deviceRemoveCopy,
  filterDevices,
  quarantineTitle,
  type DeviceFilterId,
} from "@/lib/device-list";
import { deleteDevice, setQuarantineEnforced } from "@/lib/device-writes";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { TogglePill } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { deviceIcon, deviceKindLabel } from "@/lib/display";
import { presenceSummary } from "@/lib/device-presence";
import type { Device } from "@/lib/types";

export default function DevicesPage() {
  return (
    <Suspense fallback={<p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">{COPY.loading}</p>}>
      <DevicesBody />
    </Suspense>
  );
}

function DevicesBody() {
  const { devices, groups, unifi, household, store, busy } = useAppData();
  const searchParams = useSearchParams();
  const assignGroupId = searchParams.get("assign");
  const assignGroup = groups.find((group) => group.id === assignGroupId) ?? null;
  const [filter, setFilter] = useState<DeviceFilterId>(assignGroup ? "loose" : "all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => new Date(0));
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  const networks = unifi?.networks ?? [];
  const enforced = household?.quarantineEnforced === true;

  const rows = useMemo(() => filterDevices(devices, groups, filter, query), [devices, filter, groups, query]);

  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.subtitle} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {assignGroup ? (
          <section className="rounded-[12px] border border-[var(--ff-paused-line)] bg-[var(--ff-paused-fill)] px-[18px] py-3">
            <div className="text-[14px] font-semibold text-[var(--ff-paused)]">{assignDevicesCopy(assignGroup).needsTitle}</div>
            <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-muted)]">{assignDevicesCopy(assignGroup).needsBody}</p>
          </section>
        ) : null}
        {household ? (
        <section className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] px-[18px] py-3">
          <div className="min-w-0 flex-1">
            <div
              className="text-[14px] font-semibold"
              style={{ color: enforced ? undefined : "var(--ff-paused)" }}
            >
              {quarantineTitle(enforced)}
            </div>
            <p className="mt-0.5 text-[14px] leading-5 text-[var(--ff-muted)]">
              {COPY.quarantineBody}
            </p>
          </div>
          {/*
            The pill names the state quarantine is *in*. It used to name the action —
            reading "Off" while quarantine was being enforced — which is the one
            reading a household must not get wrong on this control.
          */}
          <TogglePill
            on={enforced}
            onToggle={() => void setQuarantineEnforced(store.mutate, !enforced)}
            label={COPY.quarantineLabel}
            onLabel={COPY.quarantineOn}
            offLabel={COPY.quarantineOff}
          />
        </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-0.5 rounded-lg bg-[var(--ff-field)] p-0.5">
            {DEVICE_FILTERS.map((item) => {
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
                  {deviceFilterLabel(item, devices)}
                </button>
              );
            })}
          </div>
          <div className="flex-1" />
          <input
            className="w-full max-w-[260px] rounded-[7px] border border-[var(--ff-input-line)] px-2.5 py-2 text-[16px] md:text-[14px]"
            placeholder={COPY.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {rows.length === 0 ? (
          <p className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px] text-[14px] text-[var(--ff-muted)]">
            {devices.length === 0 ? COPY.noDevices : COPY.noMatch}
          </p>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
            <div>
              <div className="ff-device-grid grid items-center gap-3.5 bg-[var(--ff-field-soft)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)]">
                <div>Device</div>
                <div className="hidden xl:block">Address</div>
                <div className="hidden lg:block">Hardware</div>
                <div>Belongs to</div>
                <div aria-hidden="true" />
              </div>
              {rows.map((device) => {
                const name = deviceName(device);
                return (
                  <div
                    key={device.mac}
                    className="ff-device-grid grid items-center gap-3.5 border-t border-[var(--ff-hairline)] px-[18px] py-2.5 hover:bg-[var(--ff-field-soft)]"
                  >
                    <Link href={`/devices/${encodeURIComponent(device.mac)}`} className="flex min-w-0 items-center gap-2.5" aria-label={`View details for ${name}`}>
                      <DeviceMark hostname={device.hostname} />
                      <DeviceIdentity device={device} networks={networks} name={name} timezone={household?.timezone ?? "UTC"} now={now} />
                    </Link>
                    <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] xl:block">
                      {device.ip ?? "—"}
                    </div>
                    <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] lg:block">
                      {device.mac.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <DeviceAssignSelect device={device} groups={groups} />
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteDevice(store.mutate, device)}
                      aria-label={deviceRemoveCopy(device).label}
                      className="flex h-5 w-5 items-center justify-center rounded-md text-[14px] leading-none disabled:opacity-40"
                      style={{ color: "var(--ff-danger)" }}
                    >
                      &times;
                    </button>
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
  timezone,
  now,
}: {
  device: Device;
  networks: { id: string; name: string; vlanId: number }[];
  name: string;
  timezone: string;
  now: Date;
}) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[14px]">{name}</div>
      <div className="mt-0.5 truncate text-[14px] text-[var(--ff-muted)]">
        {presenceSummary(device, timezone, now)}
        <span className="lg:hidden">
          {" "}
          · {device.mac.toUpperCase()}
          {device.ip ? ` · ${device.ip}` : ""}
        </span>
        {!device.inScope ? ` · ${networkLabel(device, networks)}` : ""}
      </div>
      <div className="mt-0.5 hidden truncate text-[14px] text-[var(--ff-muted)] lg:block">{deviceKindLabel(device.hostname)}</div>
    </div>
  );
}
