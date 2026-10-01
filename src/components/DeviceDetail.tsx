"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { groupHref } from "@/lib/device-detail";
import { DEVICES_COPY } from "@/lib/device-list";
import { DeviceDetailContent } from "@/ui/DeviceDetailContent";

export function DeviceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ mac: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { mac } = use(params);
  const { from } = use(searchParams);
  let requestedMac = mac;
  try {
    requestedMac = decodeURIComponent(mac);
  } catch {
    // A malformed direct URL simply falls through to the not-found state.
  }
  const { devices, groups, unifi, household, loading, error } = useAppData();
  const [now, setNow] = useState(() => new Date(0));
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const device = devices.find((item) => item.mac.toLowerCase() === requestedMac.toLowerCase());
  const group = device?.groupId ? groups.find((item) => item.id === device.groupId) : null;
  const timezone = household?.timezone ?? "UTC";
  // A group's device list links here with `?from=<group id>` so the way back returns to that group.
  const fromGroup = typeof from === "string" ? groups.find((item) => item.id === from) : undefined;

  return (
    <>
      <PageHeader title={DEVICES_COPY.title} sub={DEVICES_COPY.detailSubtitle} />
      <div className="mx-auto flex max-w-[920px] flex-col gap-4 p-4 md:p-6">
        <Link href={fromGroup ? groupHref(fromGroup) : "/devices"} className="self-start text-[14px] text-[var(--ff-accent)]">
          ‹ {fromGroup ? fromGroup.name : "All devices"}
        </Link>
        {!device ? (
          <div className="rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px] text-[14px]">
            {loading ? DEVICES_COPY.detailLoading : error ? DEVICES_COPY.detailUnavailable : DEVICES_COPY.detailNotFound}
          </div>
        ) : (
          <DeviceDetailContent device={device} group={group} networks={unifi?.networks ?? []} timezone={timezone} now={now} />
        )}
      </div>
    </>
  );
}
