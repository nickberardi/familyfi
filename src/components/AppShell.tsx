"use client";

import { Toast } from "@/ui/Toast";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AboutSheet } from "@/components/AboutSheet";
import { Icon } from "@/components/ui/Icon";
import { Shield, Tagline, Wordmark } from "@/components/ui/Logo";
import { api, request } from "@/lib/api";
import { unassignedBadgeCount } from "@/lib/device-list";
import { NAV } from "@/lib/nav";
import { familyNeedsDevices as familyNeedsDevicesCount, syncFailed as syncNeedsAttention } from "@/lib/sync-copy";
import { reconcileNow } from "@/lib/sync-writes";
import { AccountCard, DeviceAttentionCard, SyncStatusCard, UpdateAlertCard } from "@/ui/StatusCards";
import { appVersionLabel } from "@/lib/version";
import { useAppData } from "./AppDataProvider";
import { useUpdateCheck } from "@/ui/use-update-check";

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
 * The lockup plus the version/status line, shared by the rail and the drawer. The
 * lockup opens About, as the design's does.
 *
 * The pieces are composed here rather than through `Logo` because the rail sets the
 * shield larger than the wordmark's own ladder would give it — the design's rail is a
 * 56px shield over a 22.5px wordmark — and the drawer wants the same block at the
 * width a phone leaves for it.
 */
function NavBrand({ statusLine, compact, onAbout }: { statusLine: string; compact?: boolean; onAbout: () => void }) {
  return (
    <div className="flex flex-none flex-col items-center gap-1.5 px-2.5 pt-0.5">
      <button
        type="button"
        onClick={onAbout}
        aria-label="About FamilyFi"
        title="About FamilyFi"
        className="flex flex-col items-center gap-2.5 rounded-lg border-0 bg-transparent p-0"
      >
        <Shield size={compact ? 44 : 56} />
        <div className="grid justify-items-center gap-1.5">
          <Wordmark size={compact ? 19 : 22.5} />
          <Tagline size={compact ? 6.5 : 7.5} />
        </div>
      </button>
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

/** The quiet row under the nav groups that opens About, on the rail and in the drawer. */
function AboutRow({ onAbout }: { onAbout: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbout}
      className="flex flex-none items-center gap-1.5 self-start rounded-[7px] border-0 bg-transparent px-2.5 py-0.5 text-[14px] text-[var(--ff-muted)]"
    >
      <Icon name="info" size={14} />
      About FamilyFi
    </button>
  );
}

export function AppShell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, devices, sync, unifi, store, mutate, loading, error, notice, noticeAction, busy, dismissFeedback } = useAppData();
  const [navOpen, setNavOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const update = useUpdateCheck(request);
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
  const unassignedCount = unassignedBadgeCount(devices);
  const familyNeedsDevices = familyNeedsDevicesCount(sync);
  const syncFailed = syncNeedsAttention(sync);

  const navDrawer = useMemo(() => ({ toggle: () => setNavOpen((open) => !open) }), []);

  async function signOut() {
    await api("/api/v1/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  // Opening About from the drawer closes it, as the design's `openAboutClose` does.
  function openAbout() {
    setNavOpen(false);
    setAboutOpen(true);
  }
  const closeAbout = useCallback(() => setAboutOpen(false), []);

  const statusLine = `${appVersionLabel()} · ${unifi?.configured ? "Household gateway" : "Setup needed"}`;

  return (
    <NavDrawerCtx.Provider value={navDrawer}>
      <div className="ff-shell">
        <aside className="ff-sidebar flex-col gap-5 overflow-hidden border-r border-[var(--ff-line)] bg-[var(--ff-rail)] px-3 py-5">
          <NavBrand statusLine={statusLine} onAbout={openAbout} />
          <nav className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <NavGroups
              pathname={pathname}
              unassignedCount={unassignedCount}
              familyNeedsDevices={familyNeedsDevices}
              syncFailed={syncFailed}
            />
            <div className="mt-5">
              <AboutRow onAbout={openAbout} />
            </div>
          </nav>
          <div className="ff-sidebar-end flex flex-col gap-2.5">
            <UpdateAlertCard update={update} />
            <SyncStatusCard
              sync={sync}
              busy={busy}
              error={error}
              notice={notice}
              onReconcile={() => void reconcileNow(store.mutate)}
            />
            <DeviceAttentionCard sync={sync} />
            <AccountCard session={session} onSignOut={() => void signOut()} />
          </div>
        </aside>
        {/* The page scrolls here, so it takes focus: a keyboard user can scroll content with no controls in it. */}
        <div className="ff-main flex min-w-0 flex-col" tabIndex={0} role="region" aria-label="Page content">
          <div
            className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-4 md:left-[232px] md:top-4"
            aria-live="polite"
          >
            <div className="pointer-events-auto">
              <Toast
                error={error}
                notice={notice}
                actionLabel={noticeAction?.label}
                onAction={() => {
                  if (!noticeAction) return;
                  const action = noticeAction;
                  dismissFeedback();
                  void mutate(action.run);
                }}
                onDismiss={dismissFeedback}
              />
            </div>
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
              <NavBrand statusLine={statusLine} compact onAbout={openAbout} />
              <nav className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
                <NavGroups
                  pathname={pathname}
                  unassignedCount={unassignedCount}
                  familyNeedsDevices={familyNeedsDevices}
                  syncFailed={syncFailed}
                  onNavigate={() => setNavOpen(false)}
                />
                <div className="mt-5">
                  <AboutRow onAbout={openAbout} />
                </div>
              </nav>
              <UpdateAlertCard update={update} />
            </div>
          </>
        ) : null}
        {aboutOpen ? <AboutSheet demo={demo} onClose={closeAbout} /> : null}
      </div>
    </NavDrawerCtx.Provider>
  );
}
