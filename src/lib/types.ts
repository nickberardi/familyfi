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
  error: string | null;
  updatedAt: string;
};

export type Session = {
  username: string;
  displayName: string;
  kind: "recovery" | "personal";
  expiresAt: string;
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

export type UpdateRunStatus = "requested" | "succeeded" | "failed" | "skipped" | "unchanged";

/** One request to install a release through the Watchtower sidecar, and its outcome once known. */
export type UpdateRun = {
  id: string;
  trigger: "manual" | "scheduled";
  fromVersion: string;
  targetVersion: string;
  status: UpdateRunStatus;
  requestedAt: string;
  finishedAt: string | null;
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

/** What a paired device may call. Valid pairs: phone `full`, Watch `rulesOnly`, agent `full` or `readOnly`. */
export type DeviceScope = "full" | "rulesOnly" | "readOnly";

export type PairedPhone = {
  id: string;
  displayName: string;
  client: "phone" | "watch" | "agent";
  scope: DeviceScope;
  /** The account this device acts as. */
  actsAs: { username: string; displayName: string } | null;
  /** The device that vouched for this one: a Watch's phone. */
  parentDeviceId: string | null;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  pairedVia: { endpointId: string; url: string; transport: ConnectionTransport } | null;
  /** The Access token version FamilyFi last handed this device, per protected route. */
  edgeTokens: { endpointId: string; version: number }[];
  sessions: { id: string; username: string; client: "phone" | "watch" | "agent"; expiresAt: string; createdAt: string }[];
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
};
