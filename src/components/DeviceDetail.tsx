"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { deviceDetail, groupHref, presenceTone } from "@/lib/device-detail";
import { DEVICES_COPY } from "@/lib/device-list";
import { deviceIcon } from "@/lib/display";
import type { Device, Group } from "@/lib/types";

function DetailRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-h-11 items-start justify-between gap-4 border-t border-[var(--ff-hairline)] py-3 text-[14px]">
      <dt className="flex-none text-[var(--ff-muted)]">{label}</dt>
      <dd className={`min-w-0 break-words text-right ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] px-[18px]">
      <h3 className="py-4 text-[14px] font-semibold">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

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
            {loading ? "Loading device…" : error ? "Device details are unavailable right now." : "Device not found."}
          </div>
        ) : (
          <DeviceDetails device={device} group={group} networks={unifi?.networks ?? []} timezone={timezone} now={now} />
        )}
      </div>
    </>
  );
}

function DeviceDetails({
  device,
  group,
  networks,
  timezone,
  now,
}: {
  device: Device;
  group: Group | null | undefined;
  networks: { id: string; name: string; vlanId: number }[];
  timezone: string;
  now: Date;
}) {
  const detail = deviceDetail(device, group, networks, timezone, now);
  const tone = presenceTone(detail.presence);
  const colors = { ink: `var(--ff-${tone.ink})`, fill: `var(--ff-${tone.fill})` };

  return (
    <>
      <section className="flex items-center gap-4 rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px]">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[9px] bg-[var(--ff-well)] text-[var(--ff-muted)]">
          <Icon name={deviceIcon(device.hostname)} size={23} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[21px] font-semibold tracking-tight">{detail.name}</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[14px] font-semibold" style={{ color: colors.ink, background: colors.fill }}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {detail.status}
            </span>
          </div>
          <p className="mt-1 text-[14px] text-[var(--ff-muted)]">{detail.summary}</p>
        </div>
      </section>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {detail.sections.map((section) => (
          <DetailSection key={section.title} title={section.title}>
            {section.rows.map((row) => (
              <DetailRow key={row.label} label={row.label} mono={row.mono}>
                {row.group ? <Link href={groupHref(row.group)} className="text-[var(--ff-accent)]">{row.value}</Link> : row.value}
              </DetailRow>
            ))}
          </DetailSection>
        ))}
      </div>
    </>
  );
}
