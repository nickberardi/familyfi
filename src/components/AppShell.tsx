"use client";

import { Toast } from "@/ui/Toast";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AboutSheet, SOURCE_URL } from "@/components/AboutSheet";
import { Icon } from "@/components/ui/Icon";
import { Shield, Tagline, Wordmark } from "@/components/ui/Logo";
import { api, request } from "@/lib/api";
import { unassignedBadgeCount } from "@/lib/device-list";
import { NAV } from "@/lib/nav";
import { familyNeedsDevices as familyNeedsDevicesCount, syncFailed as syncNeedsAttention } from "@/lib/sync-copy";
import { reconcileNow } from "@/lib/sync-writes";
import { AccountCard, UpdateAlertCard } from "@/ui/StatusCards";
import { SidebarStatus } from "@/components/SidebarStatus";
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
 * The lockup, shared by the rail and the drawer. It opens About, as the design's does.
 *
 * The pieces are composed here rather than through `Logo` because the rail sets the
 * shield larger than the wordmark's own ladder would give it — the design's rail is a
 * 56px shield over a 22.5px wordmark — and the drawer wants the same block at the
 * width a phone leaves for it.
 */
function NavBrand({ compact, onAbout }: { compact?: boolean; onAbout: () => void }) {
  return (
    <div className="flex flex-none flex-col items-center px-2.5 pt-0.5">
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
    </div>
  );
}

/**
 * Which nav sections are collapsed, kept in this browser so the room a person frees stays freed.
 * The rail and the drawer read the same set. Before hydration every section is open; where storage
 * is unavailable the toggles still work, for this page load.
 */
const COLLAPSED_KEY = "familyfi.nav.collapsed";
const collapsedListeners = new Set<() => void>();
let collapsedInMemory: string | null = null;

function readCollapsed(): string {
  if (collapsedInMemory !== null) return collapsedInMemory;
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseCollapsed(raw: string): string[] {
  try {
    const titles: unknown = JSON.parse(raw);
    return Array.isArray(titles) ? titles.filter((title): title is string => typeof title === "string") : [];
  } catch {
    return [];
  }
}

function writeCollapsed(titles: readonly string[]) {
  const raw = JSON.stringify(titles);
  try {
    window.localStorage.setItem(COLLAPSED_KEY, raw);
    collapsedInMemory = null;
  } catch {
    // Storage refused (site data blocked): keep the choice for this page load instead.
    collapsedInMemory = raw;
  }
  for (const listener of collapsedListeners) listener();
}

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapsedListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useCollapsedSections(): [ReadonlySet<string>, (titles: readonly string[]) => void] {
  const raw = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => "[]");
  const collapsed = useMemo(() => new Set(parseCollapsed(raw)), [raw]);
  return [collapsed, writeCollapsed];
}

/** The count beside a destination: devices waiting, family members without a device, a failed sync. */
function navBadge(href: string, counts: { unassignedCount: number; familyNeedsDevices: number; syncFailed: boolean }) {
  if (href === "/devices") return counts.unassignedCount;
  if (href === "/family") return counts.familyNeedsDevices;
  return href === "/sync" && counts.syncFailed ? 1 : 0;
}

function NavBadge({ count, tone, label }: { count: number; tone: "paused" | "danger"; label?: string }) {
  return (
    <span
      aria-label={label}
      role={label ? "img" : undefined}
      className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[14px] font-semibold text-[var(--ff-ink-on-fill)]"
      style={{ background: `var(--ff-${tone})` }}
    >
      {count}
    </span>
  );
}

/**
 * The nav groups themselves — identical content on the rail and in the drawer, so a
 * destination reachable on desktop is never missing on phone. `onNavigate` closes the
 * drawer after a tap; the rail passes nothing since it is never hidden.
 *
 * Each group's title collapses it. A collapsed group keeps its badges as one total on the title,
 * and arriving on one of its pages opens it again.
 */
function NavGroups({
  pathname,
  unassignedCount,
  familyNeedsDevices,
  syncFailed,
  onNavigate,
  idPrefix,
}: {
  pathname: string;
  unassignedCount: number;
  familyNeedsDevices: number;
  syncFailed: boolean;
  onNavigate?: () => void;
  /** Keeps the rail's and the drawer's section ids apart. */
  idPrefix: string;
}) {
  const counts = { unassignedCount, familyNeedsDevices, syncFailed };
  const [collapsed, setCollapsed] = useCollapsedSections();
  // Arriving on a page opens its section. An effect rather than render, since it writes storage the
  // other list (rail or drawer) also reads.
  useEffect(() => {
    const current = NAV.find((group) => group.items.some((item) => isActive(pathname, item.href)));
    const titles = parseCollapsed(readCollapsed());
    if (current && titles.includes(current.title)) {
      writeCollapsed(titles.filter((title) => title !== current.title));
    }
  }, [pathname]);

  return (
    <>
      {NAV.map((group) => {
        const closed = collapsed.has(group.title);
        const id = `${idPrefix}-${group.title.toLowerCase()}`;
        const total = group.items.reduce((sum, item) => sum + navBadge(item.href, counts), 0);
        const urgent = group.items.some((item) => item.href !== "/family" && navBadge(item.href, counts) > 0);
        return (
          <div key={group.title} className={closed ? "mb-2 last:mb-0" : "mb-5 last:mb-0"}>
            <button
              type="button"
              aria-expanded={!closed}
              aria-controls={id}
              onClick={() =>
                setCollapsed(closed ? [...collapsed].filter((title) => title !== group.title) : [...collapsed, group.title])
              }
              className="flex w-full items-center gap-1.5 rounded-[7px] border-0 bg-transparent px-2.5 pb-1.5 text-left text-[14px] font-semibold tracking-wide text-[var(--ff-muted)] uppercase"
            >
              <span className="min-w-0 flex-1">{group.title}</span>
              {closed && total ? <NavBadge count={total} tone={urgent ? "danger" : "paused"} label={`${total} need attention`} /> : null}
              <Icon name={closed ? "caret-right" : "caret-down"} size={14} />
            </button>
            <div id={id} hidden={closed} className="flex flex-col gap-px">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const badge = navBadge(item.href, counts);
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
                    {badge ? <NavBadge count={badge} tone={item.href === "/family" ? "paused" : "danger"} /> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * The small line at the foot of the rail and the drawer: the version, which opens About, and
 * links to star the project and report an issue on GitHub. It keeps the version in sight
 * without taking a row of the nav.
 */
function SidebarFooter({ onAbout }: { onAbout: () => void }) {
  const link = "rounded-[4px] border-0 bg-transparent p-0 text-[var(--ff-muted)] hover:text-[var(--ff-ink)] hover:underline";
  return (
    <div className="flex flex-none items-center justify-center gap-1.5 text-[11px] leading-4 whitespace-nowrap text-[var(--ff-muted)]">
      <button type="button" onClick={onAbout} aria-label="About FamilyFi" title="About FamilyFi" className={link}>
        {appVersionLabel()}
      </button>
      <span aria-hidden="true">·</span>
      <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={`flex items-center gap-1 ${link}`}>
        <Icon name="github-logo" size={12} />
        Star us
      </a>
      <span aria-hidden="true">·</span>
      <a href={`${SOURCE_URL}/issues/new`} target="_blank" rel="noreferrer" className={link}>
        Report issue
      </a>
    </div>
  );
}

export function AppShell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, devices, sync, store, mutate, loading, error, notice, noticeAction, busy, dismissFeedback } = useAppData();
  const [navOpen, setNavOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const railNav = useRef<HTMLElement>(null);
  const railNavContent = useRef<HTMLDivElement>(null);
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

  return (
    <NavDrawerCtx.Provider value={navDrawer}>
      <div className="ff-shell">
        <aside className="ff-sidebar flex-col gap-5 overflow-hidden border-r border-[var(--ff-line)] bg-[var(--ff-rail)] px-3 pt-5 pb-2.5">
          <NavBrand onAbout={openAbout} />
          <nav ref={railNav} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div ref={railNavContent}>
              <NavGroups
                idPrefix="rail-nav"
                pathname={pathname}
                unassignedCount={unassignedCount}
                familyNeedsDevices={familyNeedsDevices}
                syncFailed={syncFailed}
              />
            </div>
          </nav>
          <div className="ff-sidebar-end flex flex-col gap-2">
            <SidebarStatus
              update={update}
              sync={sync}
              busy={busy}
              error={error}
              notice={notice}
              onReconcile={() => void reconcileNow(store.mutate)}
              nav={railNav}
              navContent={railNavContent}
            />
            <AccountCard session={session} onSignOut={() => void signOut()} />
            <SidebarFooter onAbout={openAbout} />
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
              <NavBrand compact onAbout={openAbout} />
              <nav className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
                <NavGroups
                  idPrefix="drawer-nav"
                  pathname={pathname}
                  unassignedCount={unassignedCount}
                  familyNeedsDevices={familyNeedsDevices}
                  syncFailed={syncFailed}
                  onNavigate={() => setNavOpen(false)}
                />
              </nav>
              <UpdateAlertCard update={update} />
              <SidebarFooter onAbout={openAbout} />
            </div>
          </>
        ) : null}
        {aboutOpen ? <AboutSheet demo={demo} onClose={closeAbout} /> : null}
      </div>
    </NavDrawerCtx.Provider>
  );
}
