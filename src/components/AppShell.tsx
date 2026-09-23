"use client";

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Shield, Tagline, Wordmark } from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { initials } from "@/lib/display";
import type { IconName } from "@/lib/icons";
import { noMembersAttention } from "@/lib/sync-copy";
import { appVersionLabel } from "@/lib/version";
import { useAppData } from "./AppDataProvider";

const NAV: { title: string; items: { href: string; label: string; icon: IconName }[] }[] = [
  {
    title: "Household",
    items: [
      { href: "/family", label: "Family", icon: "users-three" },
      { href: "/things", label: "Things", icon: "house-line" },
    ],
  },
  {
    title: "Network",
    items: [
      { href: "/devices", label: "Devices", icon: "device-mobile" },
      { href: "/rules", label: "Rules", icon: "list-checks" },
      { href: "/categories", label: "Categories", icon: "squares-four" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/sync", label: "Sync", icon: "arrows-clockwise" },
      { href: "/phones", label: "Phones", icon: "qr-code" },
      { href: "/settings", label: "Settings", icon: "gear" },
      { href: "/reference", label: "API", icon: "code" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The phone nav drawer, opened from a hamburger in `PageHeader`. Both live under
 * `AppShell`, which owns the open/closed state, so this context is the connection
 * between them — mirroring how `AppDataProvider`/`useAppData` share one file.
 */
const NavDrawerCtx = createContext<{ toggle: () => void } | null>(null);

export function useNavDrawer(): { toggle: () => void } {
  const value = useContext(NavDrawerCtx);
  if (!value) throw new Error("useNavDrawer must be used under AppShell");
  return value;
}

/**
 * The lockup plus the version/status line, shared by the rail and the drawer.
 *
 * The pieces are composed here rather than through `Logo` because the rail sets the
 * shield larger than the wordmark's own ladder would give it — the design's rail is a
 * 56px shield over a 22.5px wordmark — and the drawer wants the same block at the
 * width a phone leaves for it.
 */
function NavBrand({ statusLine, compact }: { statusLine: string; compact?: boolean }) {
  return (
    <div className="flex flex-none flex-col items-center gap-1.5 px-2.5 pt-0.5">
      <div className="flex flex-col items-center gap-2.5">
        <Shield size={compact ? 44 : 56} />
        <div className="grid justify-items-center gap-1.5">
          <Wordmark size={compact ? 19 : 22.5} />
          <Tagline size={compact ? 6.5 : 7.5} />
        </div>
      </div>
      <div className="text-center text-[14px] text-[var(--ff-muted)]">{statusLine}</div>
    </div>
  );
}

/**
 * The nav groups themselves — identical content on the rail and in the drawer, so a
 * destination reachable on desktop is never missing on phone. `onNavigate` closes the
 * drawer after a tap; the rail passes nothing since it is never hidden.
 */
function NavGroups({
  pathname,
  unassignedCount,
  familyNeedsDevices,
  syncFailed,
  onNavigate,
}: {
  pathname: string;
  unassignedCount: number;
  familyNeedsDevices: number;
  syncFailed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
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
                  onClick={onNavigate}
                  className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-[14px]"
                  style={{
                    background: active ? "var(--ff-accent-tint)" : undefined,
                    color: active ? "var(--ff-accent)" : "var(--ff-ink)",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  <Icon name={item.icon} size={16} />
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {badge ? (
                    <span
                      className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
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
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, devices, sync, unifi, mutate, loading, error, notice, busy, dismissFeedback } = useAppData();
  const [navOpen, setNavOpen] = useState(false);
  // Closing on a route change is the drawer's own signal, same as the design's
  // `pickAndClose` on each item — but this also catches the back button, a redirect,
  // or anywhere else navigation happens outside a drawer tap. Adjusted during render
  // rather than in an effect, per https://react.dev/learn/you-might-not-need-an-effect
  // — an effect here would commit one extra frame with the drawer still open.
  const [openedAtPathname, setOpenedAtPathname] = useState(pathname);
  if (pathname !== openedAtPathname) {
    setOpenedAtPathname(pathname);
    if (navOpen) setNavOpen(false);
  }
  const unassignedCount = devices.filter((device) => device.assignment === "quarantined" && device.inScope).length;
  const coverageFailing = (sync?.failingCount ?? 0) > 0;
  const deviceAttention = noMembersAttention(sync?.issues ?? []);
  const familyNeedsDevices = (sync?.issues ?? []).filter((issue) => issue.kind === "no_members").length;
  const syncFailed = sync?.lastRun?.status === "failed" || sync?.connectionStatus === "error" || coverageFailing;

  const navDrawer = useMemo(() => ({ toggle: () => setNavOpen((open) => !open) }), []);

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
  const statusLine = `${appVersionLabel()} · ${unifi?.configured ? "Household gateway" : "Setup needed"}`;

  return (
    <NavDrawerCtx.Provider value={navDrawer}>
      <div className="ff-shell">
        <aside className="ff-sidebar flex-col gap-5 overflow-hidden border-r border-[var(--ff-line)] bg-[var(--ff-rail)] px-3 py-5">
          <NavBrand statusLine={statusLine} />
          <nav className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <NavGroups
              pathname={pathname}
              unassignedCount={unassignedCount}
              familyNeedsDevices={familyNeedsDevices}
              syncFailed={syncFailed}
            />
          </nav>
          <div className="ff-sidebar-end flex flex-col gap-2.5">
            <div className="rounded-[9px] border border-[var(--ff-line)] bg-[var(--ff-card)] p-2.5">
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
                  className="mt-2 w-full rounded-[6px] bg-[var(--ff-accent-fill)] py-1.5 text-center text-[14px] font-semibold text-[var(--ff-accent)] disabled:opacity-50"
                >
                  {busy ? "Reconciling…" : "Reconcile now"}
                </button>
              ) : null}
            </div>
            {deviceAttention ? (
              <div className="rounded-[9px] border border-[var(--ff-paused-line)] bg-[var(--ff-paused-fill)] p-2.5">
                <div className="text-[14px] font-semibold text-[var(--ff-paused)]">{deviceAttention.title}</div>
                <p className="mt-1 text-[14px] leading-5 text-[var(--ff-muted)]">{deviceAttention.message}</p>
                <Link
                  href={deviceAttention.href}
                  className="mt-2 block w-full rounded-[6px] bg-[var(--ff-paused-fill-strong)] py-1.5 text-center text-[14px] font-semibold text-[var(--ff-paused)]"
                >
                  Assign devices
                </Link>
              </div>
            ) : null}
            <div className="flex items-center gap-2.5 rounded-[10px] bg-[var(--ff-card-veil)] p-2.5">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--ff-person-fill)] text-[14px] font-semibold text-[var(--ff-on)]">
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
        <div className="ff-main flex min-w-0 flex-col">
          <div
            className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-4 md:left-[232px] md:top-4"
            aria-live="polite"
          >
            {error || notice ? (
              <div
                role={error ? "alert" : "status"}
                className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-[9px] border border-[var(--ff-line)] bg-[var(--ff-card)] px-3.5 py-2.5 text-[14px] shadow-[var(--ff-shadow-toast)]"
                style={{ color: error ? "var(--ff-danger)" : "var(--ff-on)" }}
              >
                <span className="min-w-0 flex-1">{error || notice}</span>
                <button
                  type="button"
                  onClick={dismissFeedback}
                  className="flex-none rounded px-1.5 text-[14px] font-semibold text-[var(--ff-muted)] hover:text-[var(--ff-ink)]"
                  aria-label="Dismiss"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
          {loading ? <p className="px-6 py-4 text-[14px] text-[var(--ff-muted)]">Loading household…</p> : null}
          {children}
        </div>
        {navOpen ? (
          <>
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
              className="fixed inset-0 z-[70] border-0 p-0 md:hidden"
              style={{ background: "var(--ff-scrim)" }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="fixed inset-y-0 left-0 z-[71] flex w-[min(78%,280px)] flex-col gap-5 overflow-y-auto p-3 md:hidden"
              style={{ background: "var(--ff-rail)", boxShadow: "var(--ff-shadow-sheet)" }}
            >
              <NavBrand statusLine={statusLine} compact />
              <nav className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
                <NavGroups
                  pathname={pathname}
                  unassignedCount={unassignedCount}
                  familyNeedsDevices={familyNeedsDevices}
                  syncFailed={syncFailed}
                  onNavigate={() => setNavOpen(false)}
                />
              </nav>
            </div>
          </>
        ) : null}
      </div>
    </NavDrawerCtx.Provider>
  );
}
