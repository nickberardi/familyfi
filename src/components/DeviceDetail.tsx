"use client";

import { use, useEffect, useState } from "react";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { BackLink, DETAIL_PAGE } from "@/components/ui/BackLink";
import { NotFound } from "@/components/ui/NotFound";
import { deviceKindLabel } from "@/lib/display";
import { Alert } from "@/ui/Alert";
import { privateAddressDevices } from "@/lib/checkup";
import { deviceDetail, groupHref } from "@/lib/device-detail";
import { DEVICES_COPY } from "@/lib/device-list";
import { DeviceDetailContent } from "@/ui/DeviceDetailContent";
import { PrivateAddressCard } from "@/ui/PrivateAddress";

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

  const back = fromGroup ? { href: groupHref(fromGroup), label: fromGroup.name } : { href: "/devices", label: "All devices" };
  if (!device) {
    if (loading) return null;
    if (!error) return <NotFound title={DEVICES_COPY.detailNotFoundTitle} line={DEVICES_COPY.detailNotFoundLine} back={back} />;
  }

  return (
    <>
      <PageHeader title={device ? deviceDetail(device, group, unifi?.networks ?? [], timezone, now).name : DEVICES_COPY.title} sub={device ? DEVICES_COPY.detailSub(deviceKindLabel(device.hostname), group?.name) : undefined} />
      <div className={DETAIL_PAGE}>
        <BackLink href={back.href} label={back.label} />
        {!device ? (
          <Alert tone="danger" role="alert">
            {DEVICES_COPY.detailUnavailable}
          </Alert>
        ) : (
          <>
            {privateAddressDevices([device]).length ? <PrivateAddressCard /> : null}
            <DeviceDetailContent device={device} group={group} networks={unifi?.networks ?? []} timezone={timezone} now={now} named={false} />
          </>
        )}
      </div>
    </>
  );
}
