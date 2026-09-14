"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { initials } from "@/lib/display";
import { noMembersAttention } from "@/lib/sync-copy";
import { appVersionLabel } from "@/lib/version";
import { useAppData } from "./AppDataProvider";

const NAV = [
  {
    title: "Household",
    items: [
      { href: "/family", label: "Family" },
      { href: "/things", label: "Things" },
      { href: "/schedules", label: "Schedules" },
    ],
  },
  {
    title: "Network",
    items: [{ href: "/devices", label: "Devices" }],
  },
  {
    title: "System",
    items: [
      { href: "/sync", label: "Sync" },
      { href: "/settings", label: "Settings" },
      { href: "/reference", label: "API" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, devices, sync, unifi, mutate, loading, error, notice, busy } = useAppData();
  const unassignedCount = devices.filter((device) => device.assignment === "quarantined" && device.inScope).length;
  const coverageFailing = (sync?.failingCount ?? 0) > 0;
  const deviceAttention = noMembersAttention(sync?.issues ?? []);
  const familyNeedsDevices = (sync?.issues ?? []).filter((issue) => issue.kind === "no_members").length;
  const syncFailed = sync?.lastRun?.status === "failed" || sync?.connectionStatus === "error" || coverageFailing;

  async function signOut() {
    await api("/api/v1/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const syncTitle =
    sync?.connectionStatus === "unconfigured"
      ? "UniFi not configured"
      : syncFailed
        ? "Sync needs attention"
        : sync?.lastRun?.status === "partial"
          ? "Partial apply"
          : "Gateway in sync";
  const syncDot =
    sync?.connectionStatus === "unconfigured"
      ? "var(--ff-muted)"
      : syncFailed
        ? "var(--ff-danger)"
        : "var(--ff-on)";
  const showReconcile =
    busy ||
    sync?.connectionStatus === "unconfigured" ||
    syncFailed ||
    sync?.lastRun?.status === "partial";

  return (
    <div className="ff-shell">
      <aside className="ff-sidebar flex-col gap-5 overflow-hidden border-r border-[var(--ff-line)] bg-[#ececee] px-3 py-5">
        <div className="flex-none px-2.5">
          <div className="text-[15px] font-bold tracking-tight">FamilyFi</div>
          <div className="mt-0.5 text-[14px] text-[var(--ff-muted)]">
            {appVersionLabel()} · {unifi?.configured ? "Household gateway" : "Setup needed"}
          </div>
        </div>
        <nav className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          {NAV.map((group) => (
            <div key={group.title} className="mb-5 last:mb-0">
              <div className="px-2.5 pb-1.5 text-[14px] font-semibold tracking-wide text-[var(--ff-muted)] uppercase">
                {group.title}
              </div>
              <div className="flex flex-col gap-px">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  const badge =
                    item.href === "/devices"
                      ? unassignedCount
                      : item.href === "/family"
                        ? familyNeedsDevices
                        : item.href === "/sync" && syncFailed
                          ? 1
                          : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-[14px]"
                      style={{
                        background: active ? "rgba(0,122,255,.12)" : undefined,
                        color: active ? "var(--ff-accent)" : "var(--ff-ink)",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      <span className="min-w-0 flex-1">{item.label}</span>
                      {badge ? (
                        <span
                          className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[14px] font-semibold text-white"
                          style={{
                            background: item.href === "/family" ? "var(--ff-paused)" : "var(--ff-danger)",
                          }}
                        >
                          {badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="ff-sidebar-end flex flex-col gap-2.5">
          <div className="rounded-[9px] border border-[var(--ff-line)] bg-white p-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: syncDot }} />
              <span className="text-[14px] font-semibold">{syncTitle}</span>
            </div>
            <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">
              {busy
                ? "Writing desired state to UniFi…"
                : error || notice || (syncFailed ? sync?.lastRun?.error : null) || "Desired state is written on the next reconcile."}
            </p>
            {showReconcile ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(() => api("/api/v1/sync/retry", { method: "POST", body: JSON.stringify({}) }))
                }
                className="mt-2 w-full rounded-[6px] bg-[rgba(0,122,255,.1)] py-1.5 text-center text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-50"
              >
                {busy ? "Reconciling…" : "Reconcile now"}
              </button>
            ) : null}
          </div>
          {deviceAttention ? (
            <div className="rounded-[9px] border border-[rgba(192,76,0,.28)] bg-[rgba(192,76,0,.08)] p-2.5">
              <div className="text-[14px] font-semibold text-[var(--ff-paused)]">{deviceAttention.title}</div>
              <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">{deviceAttention.message}</p>
              <Link
                href={deviceAttention.href}
                className="mt-2 block w-full rounded-[6px] bg-[rgba(192,76,0,.12)] py-1.5 text-center text-[14px] font-semibold text-[var(--ff-paused)]"
              >
                Assign devices
              </Link>
            </div>
          ) : null}
          <div className="flex items-center gap-2.5 rounded-[10px] bg-white/70 p-2.5">
            <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[rgba(52,199,89,.16)] text-[14px] font-semibold text-[var(--ff-on)]">
              {initials(session?.displayName ?? "A")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{session?.displayName ?? "…"}</div>
              <div className="text-[14px] text-[var(--ff-muted)]">{session?.username}</div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex-none rounded-[7px] border border-[var(--ff-line)] px-2 py-1 text-[14px] font-semibold text-[var(--ff-accent)]"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="ff-main flex min-w-0 flex-col pb-20 md:pb-0">
        {loading ? <p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">Loading household…</p> : null}
        {error ? (
          <div className="mx-4 mt-4 rounded-[9px] bg-[rgba(200,16,10,.1)] px-3 py-2.5 text-[14px] text-[var(--ff-danger)] md:mx-6">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mx-4 mt-4 rounded-[9px] bg-[rgba(36,138,61,.1)] px-3 py-2.5 text-[14px] text-[var(--ff-on)] md:mx-6">
            {notice}
          </div>
        ) : null}
        {children}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--ff-line)] bg-[#ececee] md:hidden">
        {[
          { href: "/family", label: "Family" },
          { href: "/things", label: "Things" },
          { href: "/devices", label: "Devices" },
          { href: "/settings", label: "Settings" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-1 items-center justify-center py-3 text-[14px] font-semibold"
            style={{ color: isActive(pathname, item.href) ? "var(--ff-accent)" : "var(--ff-muted)" }}
          >
            {item.label}
            {item.href === "/devices" && unassignedCount ? (
              <span className="ml-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--ff-danger)] px-1 text-[12px] font-semibold text-white">
                {unassignedCount}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
