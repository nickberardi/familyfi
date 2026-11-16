"use client";

import { Suspense, useEffect, useState } from "react";
import { DeviceLink } from "@/components/DeviceLink";
import { useSearchParams } from "next/navigation";
import { DeviceAssignSelect } from "@/components/DeviceAssign";
import { deviceName } from "@/lib/device-assign";
import {
  DEVICE_FILTERS,
  DEVICES_COPY as COPY,
  deviceAddressSuffix,
  deviceFilterLabel,
  deviceRemoveCopy,
} from "@/lib/device-list";
import { PageHeader } from "@/components/PageHeader";
import { useAppData } from "@/components/AppDataProvider";
import { deviceKindLabel } from "@/lib/display";
import { DeviceIdentity } from "@/ui/DeviceIdentity";
import { DeviceMark } from "@/ui/DeviceMark";
import { DevicesHeader } from "@/ui/DevicesHeader";
import { PrivateAddressMark } from "@/ui/PrivateAddress";
import { useDeviceList } from "@/ui/use-device-list";

export default function DevicesPage() {
  return (
    <Suspense fallback={<p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">{COPY.loading}</p>}>
      <DevicesBody />
    </Suspense>
  );
}

function DevicesBody() {
  const { devices, groups, rules, unifi, household, store, busy } = useAppData();
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => new Date(0));
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  // Checkup's "Show on Devices" arrives with `?private=1`, and a group with no devices with `?assign=`.
  const list = useDeviceList({
    devices,
    groups,
    rules,
    household,
    mutate: store.mutate,
    now,
    params: { assign: searchParams.get("assign"), private: searchParams.get("private"), filter: searchParams.get("filter") },
  });
  const { rows, filter, setFilter, query, setQuery, privateMacs } = list;
  const networks = unifi?.networks ?? [];

  return (
    <>
      <PageHeader title={COPY.title} sub={COPY.subtitle} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <DevicesHeader
          list={list}
          disabled={busy}
          filter={
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
          }
        />

        {rows.length === 0 ? (
          <p className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px] text-[14px] text-[var(--ff-muted)]">
            {list.emptyText}
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
                    <DeviceLink device={device} className="flex min-w-0 items-center gap-2.5">
                      <DeviceMark hostname={device.hostname} />
                      <DeviceIdentity
                        device={device}
                        networks={networks}
                        name={name}
                        timezone={household?.timezone ?? "UTC"}
                        now={now}
                        inline={<span className="lg:hidden">{deviceAddressSuffix(device)}</span>}
                        below={
                          privateMacs.has(device.mac) ? (
                            <div className="mt-0.5">
                              <PrivateAddressMark />
                            </div>
                          ) : (
                            <div className="mt-0.5 hidden truncate text-[14px] text-[var(--ff-muted)] lg:block">{deviceKindLabel(device.hostname)}</div>
                          )
                        }
                      />
                    </DeviceLink>
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
                      onClick={() => void list.remove(device)}
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
