"use client";

import Link from "next/link";

import { DeviceLink } from "@/components/DeviceLink";
import { Icon } from "@/components/ui/Icon";
import { deviceName } from "@/lib/device-assign";
import { deviceKindLabel } from "@/lib/display";
import { GROUP_DETAIL_COPY, rulesNeedDevice } from "@/lib/group-form";
import type { Device, Group } from "@/lib/types";

import { DeviceMark } from "./DeviceMark";

/** The group's devices as the Devices page lists them: type, name and kind, then their addresses, each row opening the device. */
export function GroupDevicesCard({ group, members }: { group: Group; members: Device[] }) {
  const assignHref = `/devices?assign=${group.id}`;
  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)]">
      <div className="flex items-center gap-2.5 border-b border-[var(--ff-hairline-card)] px-[18px] py-[15px]">
        <h2 className="flex-1 text-[14px] font-semibold">{GROUP_DETAIL_COPY.devices[group.kind]}</h2>
        <Link href={assignHref} className="text-[14px] font-semibold text-[var(--ff-accent)]">
          {GROUP_DETAIL_COPY.assignDevices}
        </Link>
      </div>
      {members.length === 0 ? (
        <p className="px-[18px] py-4 text-[14px] text-[var(--ff-muted)]">
          {GROUP_DETAIL_COPY.noDevices}
          {rulesNeedDevice(group) ? (
            <>
              {" "}
              {GROUP_DETAIL_COPY.rulesNeedDevice.before}{" "}
              <Link href={assignHref} className="font-semibold text-[var(--ff-accent)]">
                {GROUP_DETAIL_COPY.rulesNeedDevice.link}
              </Link>
              {GROUP_DETAIL_COPY.rulesNeedDevice.after}
            </>
          ) : null}
        </p>
      ) : (
        <>
          <div className="ff-group-device-grid grid items-center gap-3.5 bg-[var(--ff-field-soft)] px-[18px] py-2.5 text-[14px] font-semibold text-[var(--ff-muted)]">
            <div>{GROUP_DETAIL_COPY.deviceColumns.device}</div>
            <div className="hidden md:block">{GROUP_DETAIL_COPY.deviceColumns.address}</div>
            <div className="hidden md:block">{GROUP_DETAIL_COPY.deviceColumns.hardware}</div>
            <div aria-hidden="true" />
          </div>
          {members.map((device) => (
            <DeviceLink
              key={device.mac}
              device={device}
              fromGroupId={group.id}
              className="ff-group-device-grid grid items-center gap-3.5 border-t border-[var(--ff-hairline)] px-[18px] py-2.5 text-[var(--ff-ink)] hover:bg-[var(--ff-field-soft)]"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <DeviceMark hostname={device.hostname} />
                <div className="min-w-0">
                  <div className="truncate text-[14px]">{deviceName(device)}</div>
                  <div className="truncate text-[14px] text-[var(--ff-muted)]">
                    {deviceKindLabel(device.hostname)}
                    {/* The address columns hide on a phone, so the MAC tells unnamed devices apart there. */}
                    <span className="font-mono md:hidden"> · {device.mac.toUpperCase()}</span>
                  </div>
                </div>
              </div>
              <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] md:block">{device.ip ?? "—"}</div>
              <div className="hidden min-w-0 truncate font-mono text-[14px] text-[var(--ff-muted)] md:block">{device.mac.toUpperCase()}</div>
              <span aria-hidden="true" className="flex text-[var(--ff-chevron)]">
                <Icon name="caret-right" size={14} />
              </span>
            </DeviceLink>
          ))}
        </>
      )}
    </section>
  );
}
