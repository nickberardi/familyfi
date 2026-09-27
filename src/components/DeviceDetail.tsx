"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAppData } from "@/components/AppDataProvider";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { networkLabel } from "@/components/DeviceAssign";
import { deviceIcon, deviceKindLabel } from "@/lib/display";
import { connectionLabel, effectivePresence, presenceLabel } from "@/lib/device-presence";
import { formatLogWhen } from "@/lib/sync-copy";
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

function tone(presence: Device["presence"]): { ink: string; fill: string } {
  if (presence === "online") return { ink: "var(--ff-on-ink)", fill: "var(--ff-on-tint)" };
  if (presence === "stale_online" || presence === "stale_offline") {
    return { ink: "var(--ff-paused)", fill: "var(--ff-paused-fill)" };
  }
  return { ink: "var(--ff-muted)", fill: "var(--ff-field)" };
}

export function DeviceDetailPage({ params }: { params: Promise<{ mac: string }> }) {
  const { mac } = use(params);
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

  return (
    <>
      <PageHeader title="Devices" sub="Assignment persists while a device is offline." />
      <div className="mx-auto flex max-w-[920px] flex-col gap-4 p-4 md:p-6">
        <Link href="/devices" className="self-start text-[14px] text-[var(--ff-accent)]">‹ All devices</Link>
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
  const presence = effectivePresence(device, now);
  const colors = tone(presence);
  const name = device.hostname ?? "Unnamed device";
  const groupHref = group ? (group.kind === "family" ? `/family/${group.id}` : `/things/${group.id}`) : null;
  const network = networks.find((item) => item.id === device.networkId)?.name
    ?? networkLabel(device, networks);
  const connection = connectionLabel(device.connectionType);
  const checked = device.presenceCheckedAt ? formatLogWhen(device.presenceCheckedAt, timezone) : "Never checked";
  const lastSeen = device.lastSeenAt ? formatLogWhen(device.lastSeenAt, timezone) : "Unknown";
  const summary = presence === "online"
    ? [connection, device.accessPointName, device.connectedAt ? `connected since ${formatLogWhen(device.connectedAt, timezone)}` : null]
        .filter(Boolean).join(" · ") || "Connected now"
    : presence === "offline"
      ? `Last seen ${lastSeen}`
      : presence === "unknown"
        ? "No successful presence check yet"
        : `Presence checked ${checked}`;

  return (
    <>
      <section className="flex items-center gap-4 rounded-[12px] border border-[var(--ff-hairline-card)] bg-[var(--ff-card)] p-[18px]">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[9px] bg-[var(--ff-well)] text-[var(--ff-muted)]">
          <Icon name={deviceIcon(device.hostname)} size={23} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[21px] font-semibold tracking-tight">{name}</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[14px] font-semibold" style={{ color: colors.ink, background: colors.fill }}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
              {presenceLabel(presence)}
            </span>
          </div>
          <p className="mt-1 text-[14px] text-[var(--ff-muted)]">{summary}</p>
        </div>
      </section>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        <DetailSection title="Device">
          <DetailRow label="Group">{groupHref ? <Link href={groupHref} className="text-[var(--ff-accent)]">{group?.name}</Link> : "Unassigned"}</DetailRow>
          <DetailRow label="Name">{name}</DetailRow>
          <DetailRow label="Device type">{deviceKindLabel(device.hostname)}</DetailRow>
          <DetailRow label="Manufacturer">{device.manufacturer ?? "Unknown"}</DetailRow>
          <DetailRow label="MAC address" mono>{device.mac.toUpperCase()}</DetailRow>
        </DetailSection>
        <DetailSection title="Connection">
          <DetailRow label="Status">{presenceLabel(presence)}</DetailRow>
          <DetailRow label="Checked">{checked}</DetailRow>
          {device.connectedAt && (presence === "online" || presence === "stale_online") ? (
            <DetailRow label="Connected since">{formatLogWhen(device.connectedAt, timezone)}</DetailRow>
          ) : <DetailRow label="Last seen">{lastSeen}</DetailRow>}
          <DetailRow label="Connection type">{connection ?? "Unknown"}</DetailRow>
          {device.connectionType === "wireless" ? <DetailRow label="Access point">{device.accessPointName ?? "Unknown access point"}</DetailRow> : null}
          <DetailRow label="Network">{network}</DetailRow>
          <DetailRow label="IP address" mono>{device.ip ?? "Unknown"}</DetailRow>
        </DetailSection>
      </div>
    </>
  );
}
