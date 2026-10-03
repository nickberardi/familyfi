import { scopeLabel } from "./agent-prompt";
import { relativeSweep } from "./sync-copy";
import { transportLabel } from "./connection-routes";
import type { Account, ConnectionRoute, PairedPhone, PairingState, RemoteAccess } from "./types";

/**
 * Pair Device, as every client shows it: which paired devices (phones, Watches and agents) are
 * listed, the published route a phone pairs through, each device's lines, and what the pairing
 * sheet says at each step. Only administrators have paired phones.
 */

/** Most recently seen first (the API's order); a test harness can leave hundreds behind. */
export const PHONES_SHOWN = 8;

export const PAIR_COPY = {
  title: "Pair Device",
  sub: "Pair the FamilyFi iPhone app and choose how it reaches home.",
  pairPhone: "Pair a phone",
  adminOnly: "Only a household admin can pair phones or change remote access.",
  loadFailed: "Could not load remote access.",
  actionFailed: "That didn't work.",
  paired: "Paired devices",
  pairedSub: "Phones, Watches and agents; revoke any of them on its own",
  noPhones: "No paired devices yet. Use Pair a phone to add one, or connect an agent from the API page.",
  remoteFirst: "Turn on remote access, then pair a phone. Agents connect from the API page.",
  showRecent: "Show recent only",
  removeAllRevoked: "Remove all revoked",
  revoke: "Revoke",
  repair: "Re-pair",
  remove: "Remove",
  remote: "Remote access",
  remoteSub: "Choose how the FamilyFi app reaches home. Phones use this one address.",
  remoteOff: "No route is published, so phones can’t reach home or pair.",
  /** Where a client that cannot change remote access sends the household instead. */
  remoteOnWeb: "Change remote access on FamilyFi’s web Pair Device page.",
} as const;

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

/** The one route remote access publishes, once it is live: the address phones pair over. */
export function publishedRoute(tunnel: Pick<RemoteAccess, "endpointId"> | null, routes: readonly ConnectionRoute[] | null): ConnectionRoute | null {
  return routes?.find((route) => route.id === tunnel?.endpointId && route.enabled) ?? null;
}

/** Revoking a phone also revokes the Watches it set up. */
export function revokeConfirm(phone: Pick<PairedPhone, "displayName"> & { client?: PairedPhone["client"] }) {
  const watches = phone.client === "phone" ? " The Watches it set up stop working too." : "";
  return { title: `Revoke ${phone.displayName}?`, message: `It is signed out now and must be paired again.${watches}`, confirmLabel: PAIR_COPY.revoke };
}

export function removeConfirm(phone: Pick<PairedPhone, "displayName">) {
  return { title: `Remove ${phone.displayName} from the list?`, message: "This can't be undone; setup would be needed again.", confirmLabel: PAIR_COPY.remove };
}

export function removeAllConfirm(count: number) {
  return { title: `Remove all ${count} revoked devices from the list?`, message: "This can't be undone.", confirmLabel: PAIR_COPY.removeAllRevoked };
}

/** The web asks with one line; it joins a confirmation's title and message. */
export function confirmLine(confirm: { title: string; message: string }): string {
  return `${confirm.title} ${confirm.message}`;
}

function pairedDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A device's fallback line when it paired through no listed route: a Watch, an agent, or a removed route. */
function viaMissing(device: Pick<PairedPhone, "client" | "actsAs">): string {
  if (device.client === "watch") return "Paired automatically from an iPhone";
  if (device.client === "agent") return `AI agent on the home network${device.actsAs ? ` · acts as ${device.actsAs.displayName}` : ""}`;
  return "via a route that was removed";
}

/** A paired device's lines: its scope, when it paired and was last seen (or revoked), the route it paired through, and its sessions. */
export function phoneLines(phone: PairedPhone, now = new Date()) {
  const seen = phone.lastSeenAt ? relativeSweep(phone.lastSeenAt, now) : "never";
  return {
    scope: scopeLabel(phone.scope),
    status: `Paired ${pairedDate(phone.enrolledAt)} · ${
      phone.revokedAt ? `revoked ${pairedDate(phone.revokedAt)}` : `last seen ${seen === "now" || seen === "never" ? seen : `${seen} ago`}`
    }`,
    via: phone.pairedVia ? { url: phone.pairedVia.url, transport: transportLabel(phone.pairedVia.transport) } : null,
    viaMissing: viaMissing(phone),
    sessions: phone.sessions.map((session) => ({ id: session.id, line: `${session.username} · expires ${pairedDate(session.expiresAt)}` })),
  };
}

/** What the pairing sheet says before a code exists, while one is showing, and once a phone used it. */
export function pairingSheetCopy({ replacing, claimed, claimedName }: { replacing?: Pick<PairedPhone, "displayName"> | null; claimed?: boolean; claimedName?: string | null } = {}) {
  return {
    name: {
      title: replacing ? `Re-pair ${replacing.displayName}` : PAIR_COPY.pairPhone,
      sub: replacing
        ? "Makes a new single-use code for this phone. Once the phone uses it, its old entry is removed from the list."
        : "Makes a single-use code that pairs one phone and signs it in as the adult you choose. It expires in five minutes.",
    },
    code: claimed
      ? { title: "Phone paired", sub: `${claimedName ?? "The phone"} is paired and signed in${replacing ? "; its old entry is gone" : ""}.` }
      : {
          title: "Scan with the FamilyFi app",
          sub: "Open FamilyFi on the phone and scan the QR, or copy the pairing code and paste it in the app. Then confirm the household it shows.",
        },
    route: "Route",
    routeNote: "The phone must reach this address while it pairs. Change it under Remote access.",
    phone: "Phone",
    signsInAs: "Signs in as",
    defaultName: "iPhone",
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
    accountsFailed: "Could not load the administrators a phone can sign in as.",
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
 * The adults a phone may sign in as: administrators (and the recovery account), since only
 * administrators have paired phones.
 */
export function pairingAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => account.isAdmin || account.kind === "recovery");
}

/** The adult a new phone signs in as by default: the one signed in here, else the first who may. */
export function defaultPairingAccount(accounts: readonly Account[], username: string | null | undefined): string {
  const allowed = pairingAccounts(accounts);
  return allowed.find((account) => account.username === username)?.id ?? allowed[0]?.id ?? "";
}

type Send = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** Sign a paired device out now; it must pair again. Revoking a phone revokes its Watches too. */
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
