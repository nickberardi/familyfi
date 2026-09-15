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
