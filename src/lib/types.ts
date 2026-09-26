export type GroupAccess = "available" | "blocked" | "paused" | "protected" | "always_on";

export type Group = {
  id: string;
  kind: "family" | "things";
  name: string;
  monogram: string | null;
  familyRole: "child" | "teen" | "adult" | null;
  protected: boolean;
  mode: "always" | "scheduled";
  deviceCount: number;
  schedule: { enabled: boolean; days: number[]; start: string | null; end: string | null };
  suspension: { active: boolean; until: string | null };
  access: GroupAccess;
  /**
   * This group's own DNS-over-HTTPS endpoint, or null to read the household default.
   * A card passes itself to `effectiveCheck` so it reports its own resolver's verdict.
   */
  dohOverrideUrl: string | null;
};

export type Device = {
  mac: string;
  hostname: string | null;
  ip: string | null;
  networkId: string | null;
  zoneId: string | null;
  groupId: string | null;
  assignment: "assigned" | "quarantined";
  lastSeenAt: string | null;
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
  checkedAt: string | null;
  lastSuccessfulAt: string | null;
  error: string | null;
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

export type PairedPhone = {
  id: string;
  displayName: string;
  client: "phone" | "watch";
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  pairedVia: { endpointId: string; url: string; transport: ConnectionTransport } | null;
  /** The Access token version FamilyFi last handed this device, per protected route. */
  edgeTokens: { endpointId: string; version: number }[];
  sessions: { id: string; username: string; client: "phone" | "watch"; expiresAt: string; createdAt: string }[];
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
