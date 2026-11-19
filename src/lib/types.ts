import type { ClientScope, ClientType } from "./client-type";

export type GroupAccess = "available" | "blocked" | "paused" | "allowed";

/** Who paused a group or allowed it online, as they were named then. */
export type Actor = { accountId: string | null; name: string } | null;

export type Group = {
  id: string;
  kind: "family" | "things";
  name: string;
  monogram: string | null;
  familyRole: "child" | "teen" | "adult" | null;
  deviceCount: number;
  /** A pause blocks all internet until `until`, or until resumed. */
  suspension: { active: boolean; until: string | null; by: Actor };
  /** An allowance lifts the group's internet-rule windows until `until`. */
  allowance: { active: boolean; until: string | null; by: Actor };
  /** The group's internet rules; empty when nothing limits its internet. */
  internetRuleIds: string[];
  access: GroupAccess;
  /**
   * This group's own DNS-over-HTTPS endpoint, or null to read the household default.
   * A card passes itself to `effectiveCheck` so it reports its own resolver's verdict.
   */
  dohOverrideUrl: string | null;
  /**
   * The rule the card's Unblock lifts and Block puts back (its Block button default): one of its own
   * category, app or website rules (its Block button default). Absent: all internet.
   */
  blockButtonRuleId?: string;
  /**
   * A Things group only: whether children with FamilyFi Me see it and ask for more time on it. One
   * switch, the same for every child. Absent on a family group.
   */
  kidsCanAsk?: boolean;
  /** Its latest ask for more time from FamilyFi Me in the last day; absent when there is none. */
  ask?: GroupAsk;
};

/**
 * A child's ask for more time, filed by FamilyFi Me on its own group or on a Thing shared with
 * children (`from` says which child, on a Thing): to end the group's pause
 * (`pause`) or to lift one rule's window (`rule`, with `ruleId` and `minutes`). `waiting` until a
 * parent answers (`yes`, `no`) or it closes: `ended` when the block it asked about ended first,
 * `timedOut` when nobody answered in time.
 */
export type GroupAsk = {
  id: string;
  about: "pause" | "rule" | (string & {});
  /** On a shared Thing: the child who asked, by their family group. Absent on a child's own group. */
  from?: { groupId: string; name: string };
  ruleId?: string;
  minutes?: number;
  state: "waiting" | "yes" | "no" | "timedOut" | "ended" | (string & {});
  at: string;
  /** While waiting: when it closes unanswered. */
  expiresAt?: string;
  answeredAt?: string;
  /** Who answered yes or no. */
  by?: Actor;
  /** After a no: when the child can ask again. */
  askAgainAt?: string;
};

export type Device = {
  mac: string;
  manufacturer: string | null;
  hostname: string | null;
  ip: string | null;
  networkId: string | null;
  zoneId: string | null;
  groupId: string | null;
  assignment: "assigned" | "quarantined";
  lastSeenAt: string | null;
  presence: "online" | "offline" | "stale_online" | "stale_offline" | "unknown";
  presenceCheckedAt: string | null;
  connectedAt: string | null;
  connectionType: "wired" | "wireless" | "vpn" | "teleport" | null;
  accessPointName: string | null;
  unresolved: boolean;
  inScope: boolean;
};

export type Change = {
  id: string;
  revision: number;
  appliedRevision: number | null;
  status: "pending" | "applied" | "partial" | "failed" | "superseded";
  scope: string;
  deviceMac: string | null;
  /** Who asked: the adult, and the paired device they used. Left out when unknown, and by servers before API 1.5.0. */
  actor?: { displayName: string; device?: { displayName: string } };
  error: string | null;
  updatedAt: string;
};

export type Session = {
  username: string;
  displayName: string;
  /** `person`: FamilyFi Me on a child's phone, signed in for a person (a family group), never an account. A newer server may add one. */
  kind: "recovery" | "personal" | "person" | (string & {});
  expiresAt: string;
  /** `person` only: the person a child's phone signs in for, the id of their family group, which it reads its day from. */
  personId?: string;
};

export type UnifiNetwork = { id: string; name: string; vlanId: number; zoneId: string | null };

export type UnifiSettings = {
  configured: boolean;
  mode: string | null;
  baseUrl: string | null;
  consoleId: string | null;
  siteId: string | null;
  apiKeyMasked: string | null;
  tlsInsecure: boolean;
  manageAllNetworks: boolean;
  managedNetworkIds: string[];
  networks: UnifiNetwork[];
  connectionStatus: string;
  connectionError: string | null;
};

/** One UniFi device's latest load, as the console reports it; null for what it did not report. */
export type GatewayDeviceHealth = {
  id: string;
  name: string;
  model: string | null;
  state: string | null;
  gateway: boolean;
  /** False when the console would not give this device's statistics; every reading is then null. */
  reported: boolean;
  cpuUtilizationPct: number | null;
  memoryUtilizationPct: number | null;
  loadAverage1Min: number | null;
  loadAverage5Min: number | null;
  loadAverage15Min: number | null;
  uptimeSec: number | null;
  lastHeartbeatAt: string | null;
};

/** The requests this FamilyFi server sent the console, for one endpoint, over the window. */
export type UnifiEndpointLoad = {
  endpoint: string;
  count: number;
  errors: number;
  averageMs: number;
  maxMs: number;
};

export type GatewayHealth = {
  checkedAt: string;
  /** Null when the console could not be asked; `devicesError` says why. */
  devices: GatewayDeviceHealth[] | null;
  devicesError: string | null;
  requests: {
    windowSec: number;
    total: number;
    errors: number;
    endpoints: UnifiEndpointLoad[];
  };
};

export type Account = {
  id: string;
  username: string;
  displayName: string;
  kind: "recovery" | "personal";
  isAdmin: boolean;
  groupId: string | null;
  recovery: boolean;
};

export type SyncIssue = {
  groupId: string;
  groupName: string;
  kind: "no_members" | "unresolved_zone" | "missing_policy";
  message: string;
};

export type SyncStatus = {
  revision: number;
  connectionStatus: string;
  appPolicyCount: number;
  failingCount: number;
  issues: SyncIssue[];
  lastRun: {
    id: string;
    status: string;
    requestedRevision: number;
    appliedRevision: number | null;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
  changes: Change[];
  /** Open problems the network checkup found, for the Checkup nav badge. */
  checkupProblems: number;
};

export type MutationResult<T> = T & { change: { changeId: string; revision: number } };

/** Non-secret release-check metadata returned by GET /api/v1/health. */
export type UpdateCheck = {
  status: "pending" | "ok" | "error";
  available: boolean | null;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  checkedAt: string | null;
  lastSuccessfulAt: string | null;
  error: string | null;
};

export type UpdateStatus = "requested" | "succeeded" | "failed" | "skipped" | "unchanged";

/** The latest request to install a release through the Watchtower sidecar, and its outcome once known. */
export type UpdateRun = {
  targetVersion: string;
  status: UpdateStatus;
  requestedAt: string;
  error: string | null;
};

/** GET /api/v1/settings/update: whether the updater is set up, the automatic schedule and the last install. */
export type UpdateSettings = {
  updater: { configured: boolean };
  schedule: { enabled: boolean; days: number[]; time: string };
  nextRunAt: string | null;
  lastRun: UpdateRun | null;
};

/** What importing a household export does, shown before it is applied and returned after. */
export type ImportSummary = {
  exportedAt: string;
  appVersion: string;
  counts: { groups: number; accounts: number; devices: number; rules: number; categories: number; endpoints: number };
  /** `kept` when this install's gateway is another console or site and its key is saved: only its own connection stays. */
  gateway: "imported" | "kept";
  /** `missing` when no UniFi key is saved here: setup asks for it after the import. */
  unifiKey: "kept" | "missing";
  /** Routes imported switched off, because their Cloudflare credential is not saved here. */
  endpointsNeedingToken: string[];
  /** FamilyFi's own tunnel routes, which are not imported: turn remote access on again. */
  skippedEndpoints: string[];
  /** The export came from another install on this same gateway, whose FamilyFi policies stay there. */
  otherInstallPolicies: boolean;
  databaseDump: boolean;
};

export type ConnectionTransport = "lan" | "tailscale" | "cloudflare";

/** Who runs a route: FamilyFi's quick tunnel, FamilyFi's tunnel on the household's domain, or the household. */
export type RouteKind = "quick" | "domain" | "own";

export type ConnectionRoute = {
  id: string;
  url: string;
  kind: RouteKind;
  transport: ConnectionTransport;
  trustMode: "system" | "pinned";
  spkiSha256: string | null;
  priority: number;
  enabled: boolean;
  /** Whether Cloudflare Access guards the route; the token itself is never served here. */
  edgeAuth: "none" | "serviceToken";
  /** The current Access token's version, or null without Access. */
  edgeTokenVersion: number | null;
};

/**
 * Which client a paired device is (src/lib/client-type.ts): `app`, `app-watch`, `app-controls`, `me`
 * or `agent`. A newer server may add one (`x-extensible-enum`); list it as a paired device like any other.
 */
export type PairedClientType = ClientType | (string & {});
/** What a paired device may call, as one value such as `app:full`. A newer server may add one. */
export type PairedScope = ClientScope | (string & {});

export type PairedPhone = {
  id: string;
  displayName: string;
  clientType: PairedClientType;
  scope: PairedScope;
  /** The account this device acts as. */
  actsAs: { username: string; displayName: string } | null;
  /** A child's phone (`me`) only: the person it signs in for (`id` is their family group's); null once that group is deleted. */
  person?: { id: string; name: string } | null;
  /** A child's iPhone or iPad (`me`) only, once it has said: its Screen Time permission (src/lib/me-protection.ts), and when it changed. */
  protection?: string;
  protectionAt?: string | null;
  /** The device that vouched for this one: the app that set up a Watch or its own Siri and shortcuts. */
  parentDeviceId: string | null;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  pairedVia: { endpointId: string; url: string; transport: ConnectionTransport } | null;
  /** The Access token version FamilyFi last handed this device, per protected route. */
  edgeTokens: { endpointId: string; version: number }[];
  /** Whether this app has turned on phone alerts; only `app:full` devices carry it. */
  alerts?: boolean;
  sessions: { id: string; username: string; expiresAt: string; createdAt: string }[];
};

export type PairingState = {
  id: string;
  status: "pending" | "claimed" | "expired";
  expiresAt: string;
  device: { id: string; displayName: string } | null;
};

export type CertificatePin = {
  spkiSha256: string;
  subject: string;
  issuer: string;
  validTo: string;
  systemTrusted: boolean | null;
  source: "probe" | "certificate";
};

export type RemoteAccess = {
  mode: "off" | "quick" | "named";
  status: "off" | "signing-in" | "starting" | "running" | "error" | "unavailable";
  url: string | null;
  error: string | null;
  endpointId: string | null;
  cloudflared: string | null;
  hostname: string | null;
  loginUrl: string | null;
  /** For a published route the household runs: the evidence that it works. Null for FamilyFi's own tunnel or Off. */
  reachability: RouteReachability | null;
};

/** Evidence a route the household runs works, since it was last published or changed. */
export type RouteReachability = {
  /** The last request that came in through it. */
  reachedAt: string | null;
  /** FamilyFi's own last check of it, from home. */
  checkedAt: string | null;
  result: "reached" | "failed" | null;
  /** Why the last check failed. */
  message: string | null;
};
