import { ME_QUIET_AFTER_MS } from "./me-protection";
import { ALERTS_CARD_COPY } from "./alert-copy";
import { scopeLabel } from "./agent-prompt";
import type { ApiRequest } from "./api-client";
import { relativeSweep } from "./sync-copy";
import { transportLabel } from "./connection-routes";
import type { Account, ConnectionRoute, Group, PairedPhone, PairingState, RemoteAccess } from "./types";

/**
 * Pair Device, as every client shows it: which paired devices (phones, Watches and agents) are
 * listed, the published route a phone pairs through, each device's lines, and what the pairing
 * sheet says at each step. Only administrators have paired phones.
 */

/** Most recently seen first (the API's order); a test harness can leave hundreds behind. */
export const PHONES_SHOWN = 8;

export const PAIR_COPY = {
  title: "Pair Device",
  sub: "Pair the FamilyFi app on a phone, tablet or Mac and choose how it reaches home",
  pairPhone: "Pair a device",
  /** FamilyFi Me, the app on a child's phone. */
  pairMe: "Pair FamilyFi Me",
  connectAgent: "Connect an agent",
  adminOnly: "Only a household admin can pair devices or change remote access.",
  loadFailed: "Could not load remote access.",
  actionFailed: "That didn't work.",
  paired: "Paired devices",
  pairedSub: "Apps, Watches, agents, FamilyFi Me and what they set up; revoke any one of them",
  noPhones: "No paired devices yet. Pair a device, pair FamilyFi Me or connect an agent to add one.",
  remoteFirst: "Turn on remote access, then pair a device. Agents connect over the home network.",
  remoteFirstPhones: "Turn on remote access, then pair a device.",
  expired: "Expired. Re-pair it to sign it in again.",
  /** Watches and agents are not re-paired from the list. */
  expiredPairAgain: "Expired. Revoke it and pair again.",
  /** An app's Siri and shortcuts: the app sets them up again by itself. */
  expiredControls: "Expired. Open FamilyFi on that device to set it up again.",
  showRecent: "Show recent only",
  removeAllRevoked: "Remove all revoked",
  revoke: "Revoke",
  repair: "Re-pair",
  remove: "Remove",
  remote: "Remote access",
  remoteSub: "Choose how the FamilyFi app reaches home. Every device uses this one address.",
  remoteOff: "No route is published, so devices can’t reach home or pair.",
  /** Where a client that cannot change remote access sends the household instead. */
  remoteOnWeb: "Change remote access on FamilyFi’s web Pair Device page.",
  getApp: "Get the FamilyFi app",
  getAppSub: "Install it on each device before you pair it.",
} as const;

/**
 * Where to get the FamilyFi app, shown as each store's own badge. Until the apps are listed, the
 * App Store badge opens TestFlight, and the Google Play badge opens brief steps for joining its
 * closed beta (`PLAY_BETA`); a store with no link yet shows its badge unlinked, marked as coming soon.
 */
export const APP_STORES = [
  { id: "apple", label: "Download on the App Store", badge: "/stores/app-store.svg", badgeWidth: 120, url: "https://testflight.apple.com/join/5nuDQjJq" },
  { id: "google", label: "Get it on Google Play", badge: "/stores/google-play.svg", badgeWidth: 135, url: "https://getfamilyfi.com/android/", steps: true },
] as const satisfies readonly AppStore[];

/**
 * `badgeWidth` is the badge drawn 40 points tall, the height both are shown at. A store with
 * `steps` opens `PLAY_BETA`'s steps instead of its link, which is their full version.
 */
export type AppStore = { id: string; label: string; badge: string; badgeWidth: number; url: string | null; steps?: boolean };

/** Google Play's closed beta: a tester signs in to their phone's Google account, joins the group, opts in, then installs. */
export const PLAY_BETA = {
  title: "Join the Android beta",
  sub: "FamilyFi is in a closed beta on Google Play.",
  steps: [
    { text: "Sign in to the Google account you use on your Android phone", url: "https://accounts.google.com" },
    { text: "Join the beta group", url: "https://groups.google.com/g/familyfi-beta" },
    { text: "Become a tester", url: "https://play.google.com/apps/testing/com.getfamilyfi" },
    { text: "Install FamilyFi from Google Play", url: "https://play.google.com/store/apps/details?id=com.getfamilyfi" },
  ],
  more: "Full instructions",
  done: "Done",
} as const;

export const APP_STORE_SOON = "Coming soon";

export function showAllLabel(count: number): string {
  return `Show all ${count} devices`;
}

export function revokedToggleLabel(open: boolean, count: number): string {
  return `${open ? "Hide" : "Show"} revoked (${count})`;
}

/** Devices still able to sign in, and those revoked, each in the API's order. */
export function splitPhones(phones: readonly PairedPhone[]) {
  return { active: phones.filter((phone) => !phone.revokedAt), revoked: phones.filter((phone) => phone.revokedAt) };
}

/**
 * Whether a device's row offers Re-pair: any phone, active or revoked, while a route is published,
 * except the phone showing the list, which would sign itself out mid-flow.
 */
export function canRepair(phone: Pick<PairedPhone, "id" | "clientType">, { canPair, selfId }: { canPair: boolean; selfId?: string | null }): boolean {
  return canPair && isApp(phone) && phone.id !== selfId;
}

/** Whether a paired device is the app itself, on a phone, tablet or Mac. */
export function isApp(device: Pick<PairedPhone, "clientType">): boolean {
  return device.clientType === "app";
}

/** Whether a paired device is an app's Siri, Shortcuts and system controls. */
export function isAppControls(device: Pick<PairedPhone, "clientType">): boolean {
  return device.clientType === "app-controls";
}

/** The one route remote access publishes, once it is live: the address phones pair over. */
export function publishedRoute(tunnel: Pick<RemoteAccess, "endpointId"> | null, routes: readonly ConnectionRoute[] | null): ConnectionRoute | null {
  return routes?.find((route) => route.id === tunnel?.endpointId && route.enabled) ?? null;
}

/** Revoking a phone also revokes the Watches, phones and agents it paired. */
export function revokeConfirm(phone: Pick<PairedPhone, "displayName"> & Partial<Pick<PairedPhone, "clientType" | "group">>) {
  const kind = phone.clientType ? { clientType: phone.clientType } : null;
  // Nothing pairs an app's Siri and shortcuts again: the app sets them up itself when it next opens.
  if (kind && isAppControls(kind)) {
    return { title: `Revoke ${phone.displayName}?`, message: "They stop working now, until you next open FamilyFi on that device. The app itself stays paired.", confirmLabel: PAIR_COPY.revoke };
  }
  if (phone.clientType === "me") {
    return {
      title: `Revoke ${phone.displayName}?`,
      message: `FamilyFi Me on it signs out now and can't show ${phone.group ? `${phone.group.name}'s` : "their"} rules or ask for more time until it is paired again.`,
      confirmLabel: PAIR_COPY.revoke,
    };
  }
  const paired = kind && isApp(kind) ? " Its shortcuts and system controls, and any Watch, phone or agent it paired, stop working too." : "";
  return { title: `Revoke ${phone.displayName}?`, message: `It is signed out now and must be paired again.${paired}`, confirmLabel: PAIR_COPY.revoke };
}

export function removeConfirm(phone: Pick<PairedPhone, "displayName"> & Partial<Pick<PairedPhone, "clientType">>) {
  // An app sets its own Siri and shortcuts up again, so there is no setup to warn about.
  const controls = phone.clientType !== undefined && isAppControls({ clientType: phone.clientType });
  return { title: `Remove ${phone.displayName} from the list?`, message: controls ? "This can't be undone." : "This can't be undone; setup would be needed again.", confirmLabel: PAIR_COPY.remove };
}

export function removeAllConfirm(count: number) {
  return { title: `Remove all ${count} revoked devices from the list?`, message: "This can't be undone.", confirmLabel: PAIR_COPY.removeAllRevoked };
}

function pairedDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Where a device came from when it paired through no listed route: the phone that set it up, the home network, or a removed route. */
function origin(device: Pick<PairedPhone, "clientType">, parentName: string | null): string {
  if (device.clientType === "app-watch") return `Paired automatically from ${parentName ?? "an iPhone"}`;
  if (isAppControls(device)) return `Set up automatically by ${parentName ?? "the FamilyFi app"}`;
  if (device.clientType === "agent") return "On the home network";
  return "via a route that was removed";
}

/** A tag's colour: grey, or one of the system's state tints (`TAG_TONES` in src/ui/Tag.tsx). */
export type TagTone = "neutral" | "green" | "yellow" | "red" | "blue";

/** Each access in its colour, as the operator chose: full green, rules only blue, read only red. */
const SCOPE_TONES: Record<string, TagTone> = { "app:full": "green", "agent:full": "green", "app:rulesOnly": "blue", "agent:readOnly": "red", "me:askOnly": "neutral" };

/** What a child's phone's tags say: its Screen Time permission, and that it has gone quiet. */
export const CHILD_PHONE_TAGS = {
  on: "Screen Time on",
  off: "Screen Time off",
  quiet: "Not checking in",
} as const;

/**
 * A child's phone (FamilyFi Me): whether Screen Time is on, once an iPhone or iPad has said (Android
 * never does), and that it hasn't been heard from for `ME_QUIET_AFTER_MS`, as parents are alerted.
 */
function childPhoneTags(phone: PairedPhone, now: Date): { label: string; name: string; tone: TagTone }[] {
  const tags: { label: string; name: string; tone: TagTone }[] = [];
  if (phone.protection === "on") tags.push({ label: CHILD_PHONE_TAGS.on, name: CHILD_PHONE_TAGS.on, tone: "green" });
  else if (phone.protection === "notAllowed" || phone.protection === "removed") tags.push({ label: CHILD_PHONE_TAGS.off, name: CHILD_PHONE_TAGS.off, tone: "red" });
  if (phone.lastSeenAt && now.getTime() - Date.parse(phone.lastSeenAt) > ME_QUIET_AFTER_MS) {
    tags.push({ label: CHILD_PHONE_TAGS.quiet, name: CHILD_PHONE_TAGS.quiet, tone: "yellow" });
  }
  return tags;
}

/**
 * A paired device's tags and lines, the same for phones, Watches and agents. Tags beside its name say
 * what it may do, whose account it acts as and, for an app, whether it takes alerts; the lines say
 * when it was last seen, how it reaches home, and when it paired and its sign-in ends.
 */
export function phoneLines(phone: PairedPhone, now = new Date(), parentName: string | null = null) {
  const seen = phone.lastSeenAt ? relativeSweep(phone.lastSeenAt, now) : "never";
  const ends = phone.sessions.map((session) => session.expiresAt).sort()[0];
  const tags: { label: string; name: string; tone: TagTone }[] = [
    { label: scopeLabel(phone.scope), name: scopeLabel(phone.scope), tone: SCOPE_TONES[phone.scope] ?? "neutral" },
  ];
  if (phone.actsAs) tags.push({ label: phone.actsAs.displayName, name: `Acts as ${phone.actsAs.displayName}`, tone: "neutral" });
  // A child's phone signs in for its family group, never as an account.
  if (phone.group) tags.push({ label: `For ${phone.group.name}`, name: `For ${phone.group.name}`, tone: "neutral" });
  if (phone.clientType === "me" && !phone.revokedAt) tags.push(...childPhoneTags(phone, now));
  if (phone.alerts !== undefined && !phone.revokedAt) {
    const alerts = phone.alerts ? ALERTS_CARD_COPY.accessOn : ALERTS_CARD_COPY.accessOff;
    tags.push({ label: alerts, name: alerts, tone: phone.alerts ? "green" : "yellow" });
  }
  return {
    tags,
    access: phone.revokedAt ? `Revoked ${pairedDate(phone.revokedAt)}` : `Last seen ${seen === "now" || seen === "never" ? seen : `${seen} ago`}`,
    via: phone.pairedVia ? { url: phone.pairedVia.url, transport: transportLabel(phone.pairedVia.transport) } : null,
    origin: origin(phone, parentName),
    // A phone or agent another phone paired goes when that phone is revoked; a Watch or an app's Siri and shortcuts says so in its origin.
    dates: `Paired ${pairedDate(phone.enrolledAt)}${parentName && phone.clientType !== "app-watch" && !isAppControls(phone) ? ` from ${parentName}` : ""}${ends ? ` · expires ${pairedDate(ends)}` : ""}`,
    expired: !phone.revokedAt && phone.sessions.length === 0,
  };
}

/**
 * What the pairing sheet says before a code exists, while one is showing, and once a phone used it.
 * `child`: the sheet pairs FamilyFi Me on a child's phone, for a family group rather than as an adult.
 */
export function pairingSheetCopy({
  replacing,
  claimed,
  claimedName,
  child = false,
}: { replacing?: Pick<PairedPhone, "displayName"> | null; claimed?: boolean; claimedName?: string | null; child?: boolean } = {}) {
  return {
    name: child
      ? {
          title: PAIR_COPY.pairMe,
          sub: "Makes a single-use code that pairs FamilyFi Me on a family member's phone. It shows them their own rules and lets them ask you for more time. It expires in five minutes.",
        }
      : {
          title: replacing ? `Re-pair ${replacing.displayName}` : PAIR_COPY.pairPhone,
          sub: replacing
            ? "Makes a new single-use code for this device. Its old pairing keeps working until the code is used, then is signed out and removed, and its Watch moves to the new pairing."
            : "Makes a single-use code that pairs one device and signs it in as the adult you choose. It expires in five minutes.",
        },
    code: claimed
      ? child
        ? {
            title: "Phone paired",
            // The phone's own app limits (Screen Time, Family Link) can lock FamilyFi Me, the app they ask from.
            sub: `${claimedName ?? "The phone"} is paired. If it has downtime or app limits, add FamilyFi Me to its always allowed apps so they can still ask you for more time.`,
          }
        : { title: "Device paired", sub: `${claimedName ?? "The device"} is paired and signed in${replacing ? "; its old entry is gone" : ""}.` }
      : child
        ? {
            title: "Scan with FamilyFi Me",
            sub: "Open FamilyFi Me on their phone and scan the QR, or copy the pairing code and paste it in the app.",
          }
        : {
            title: "Scan with the FamilyFi app",
            sub: "Open FamilyFi on the device and scan the QR, or copy the pairing code and paste it in the app. Then confirm the household it shows.",
          },
    route: "Route",
    routeNote: child ? "The phone must reach this address while it pairs. Change it under Remote access." : "The device must reach this address while it pairs. Change it under Remote access.",
    phone: child ? "Phone name" : "Device name",
    signsInAs: "Signs in as",
    /** A child's phone: the family member it is for. */
    forGroup: "For",
    defaultName: "Device",
    cancel: "Cancel",
    show: "Show pairing code",
    newCode: "New code",
    done: "Done",
    codeLabel: "Pairing code",
    qrLabel: "Pairing QR code",
    expired: "Expired",
    expiredLine: "This code expired. Make a new one.",
    claimedLine: `Paired ${claimedName ?? ""} ✓`,
    issueFailed: "Could not create a pairing code.",
    accountsFailed: "Could not load the administrators a device can sign in as.",
    noAccounts: "A device signs in as an adult with administrator access, never as the built-in admin. Give an adult admin access under Settings › Household, then pair this device.",
    noAccountsLink: "Open Settings",
    noGroups: "FamilyFi Me is for a family member. Add one under Family, then pair their phone.",
    copy: "Copy",
    copied: "Copied",
  };
}

export function expiresLine(countdownText: string): string {
  return `Expires in ${countdownText}`;
}

/** Whether a pairing code can no longer be used: past its expiry, or the server says so. */
export function pairingExpired(issued: { expiresAt: string } | null, state: Pick<PairingState, "status"> | null, now: number): boolean {
  return issued ? new Date(issued.expiresAt).getTime() <= now || state?.status === "expired" : false;
}

/**
 * The adults a phone may sign in as: personal administrators, since only administrators have paired
 * phones and none acts as the recovery account.
 */
export function pairingAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => account.isAdmin && account.kind !== "recovery");
}

/** The adult a new phone signs in as by default: the one signed in here, else the first who may. */
export function defaultPairingAccount(accounts: readonly Account[], username: string | null | undefined): string {
  const allowed = pairingAccounts(accounts);
  return allowed.find((account) => account.username === username)?.id ?? allowed[0]?.id ?? "";
}

type Send = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** Sign a paired device out now; it must pair again. Revoking a phone revokes everything paired from it too. */
export function revokePhone(send: Send, phone: Pick<PairedPhone, "id">) {
  return send(`/api/v1/paired/devices/${encodeURIComponent(phone.id)}`, { method: "DELETE" });
}

/** Take a revoked device off the list for good. */
export function removePhone(send: Send, phone: Pick<PairedPhone, "id">) {
  return send(`/api/v1/paired/devices/${encodeURIComponent(phone.id)}?remove=true`, { method: "DELETE" });
}

/** Take every revoked device off the list. */
export function removeRevokedPhones(send: Send) {
  return send("/api/v1/paired/devices?status=revoked", { method: "DELETE" });
}

/** What an administrator's invite for a phone carries. */
export type PhoneInvite = { endpointId: string; displayName: string; accountId?: string; replacesDeviceId?: string };

/** Invites the app on a phone, tablet or Mac. */
export async function invitePhone<T>(request: ApiRequest, invite: PhoneInvite): Promise<T> {
  return request<T>("/api/v1/paired/invites", { method: "POST", body: { clientType: "app", ...invite } });
}

/** The family members a child's phone may be paired for: children, then teens, then adults. */
export function pairingChildGroups(groups: readonly Group[]): Group[] {
  const order = (group: Group) => (group.familyRole === "child" ? 0 : group.familyRole === "teen" ? 1 : 2);
  // Children and teens first, so the first one is who a phone is most likely for; the sort keeps the household's order within each.
  return groups.filter((group) => group.kind === "family").sort((a, b) => order(a) - order(b));
}

/** A child's phone's name until someone changes it: "Emma's phone". */
export function childPhoneName(group: Pick<Group, "name"> | undefined): string {
  return group ? `${group.name}'s phone` : "Phone";
}

/** What an administrator's invite for FamilyFi Me on a child's phone carries: its family group, never an account. */
export type ChildPhoneInvite = { endpointId: string; displayName: string; groupId: string };

/** Invites FamilyFi Me on a child's phone, for its family group. */
export async function inviteChildPhone<T>(request: ApiRequest, invite: ChildPhoneInvite): Promise<T> {
  return request<T>("/api/v1/paired/invites", { method: "POST", body: { clientType: "me", ...invite } });
}

/** A family member's FamilyFi Me phones that are still paired, most recently seen first. */
export function childPhonesOf(phones: readonly PairedPhone[], groupId: string): PairedPhone[] {
  return phones.filter((phone) => phone.clientType === "me" && !phone.revokedAt && phone.group?.id === groupId);
}

/** The FamilyFi Me block on a family member's page. */
export const CHILD_PHONES_COPY = {
  title: "FamilyFi Me",
  pair: PAIR_COPY.pairMe,
  empty: (name: string) => `Pair FamilyFi Me on ${name}'s phone so they can see their rules and ask you for more time.`,
  remoteFirst: "Turn on remote access under Pair Device, then pair FamilyFi Me.",
  loading: "Loading…",
  loadFailed: "Couldn't load FamilyFi Me phones.",
  tryAgain: "Try again",
  revoke: PAIR_COPY.revoke,
} as const;
