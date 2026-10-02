import { DeviceScope, PairedDeviceClient } from "@prisma/client";

/**
 * What a paired device may call. Every paired device has a scope, and each (client, scope) pair is
 * one explicit allowlist, never a ladder: an agent's `full` is the agent list, not a phone's minus
 * exceptions. Every adult login is an administrator in practice, so the scope bounds the device
 * whatever its account may do. A pair not named here allows nothing.
 *
 * - `phone:full`: everything its account may do.
 * - `watch:rulesOnly`: lists, the rule verbs, and `GET /connection` for the manifest it needs away from home.
 * - `agent:full`: household reads and controls; never accounts, UniFi settings, resolvers, household
 *   settings changes or connection management, including `GET /connection`, whose manifest carries
 *   Cloudflare Access tokens.
 * - `agent:readOnly`: household reads.
 */

/** Pause, resume, extend, allow, disallow, on and off on one rule, for every group it covers. */
const RULE_VERBS = /^\/api\/v1\/rules\/[^/]+\/(pause|resume|extend|allow|disallow|on|off)$/;
/** The same verbs for one group alone, including its built-in `internet` rule. */
const GROUP_RULE_VERBS = /^\/api\/v1\/groups\/[^/]+\/rules\/[^/]+\/(pause|resume|extend|allow|disallow)$/;

type ScopedCall = { method: string; path: string; deviceId: string };

function watchRulesOnly({ method, path }: ScopedCall): boolean {
  if (method === "GET") {
    return path === "/api/v1/auth/session"
      || path === "/api/v1/connection"
      || path === "/api/v1/groups"
      || path === "/api/v1/rules"
      || /^\/api\/v1\/changes\/[^/]+$/.test(path);
  }
  // The route itself lets a Watch revoke only itself.
  if (method === "DELETE" && /^\/api\/v1\/connection\/devices\/[^/]+$/.test(path)) return true;
  return method === "POST" && (RULE_VERBS.test(path) || GROUP_RULE_VERBS.test(path));
}

const AGENT_READS: RegExp[] = [
  /^\/api\/v1\/auth\/session$/,
  /^\/api\/v1\/changes\/[^/]+$/,
  /^\/api\/v1\/devices(\/[^/]+)?$/,
  /^\/api\/v1\/dpi\/(applications|categories)$/,
  /^\/api\/v1\/groups(\/[^/]+)?$/,
  /^\/api\/v1\/rules(\/[^/]+)?$/,
  /^\/api\/v1\/settings\/household$/,
  /^\/api\/v1\/sync$/,
  /^\/api\/v1\/upstream\/(categories(\/[^/]+)?|checks)$/,
  /^\/openapi$/,
];

/** Household controls: groups, rules and their verbs, device assignment, sync, and DNS reporting categories. */
const AGENT_WRITES: Record<string, RegExp[]> = {
  POST: [
    /^\/api\/v1\/groups$/,
    /^\/api\/v1\/rules$/,
    RULE_VERBS,
    GROUP_RULE_VERBS,
    /^\/api\/v1\/sync\/retry$/,
    /^\/api\/v1\/upstream\/categories$/,
    /^\/api\/v1\/upstream\/categories\/[^/]+\/check$/,
    /^\/api\/v1\/upstream\/checks\/run$/,
  ],
  PUT: [/^\/api\/v1\/groups\/[^/]+$/, /^\/api\/v1\/devices\/[^/]+\/assignment$/],
  PATCH: [/^\/api\/v1\/rules\/[^/]+$/, /^\/api\/v1\/upstream\/categories\/[^/]+$/],
  DELETE: [/^\/api\/v1\/groups\/[^/]+$/, /^\/api\/v1\/rules\/[^/]+$/, /^\/api\/v1\/devices\/[^/]+$/, /^\/api\/v1\/upstream\/categories\/[^/]+$/],
};

function agentReadOnly({ method, path, deviceId }: ScopedCall): boolean {
  // Any agent may disconnect itself.
  if (method === "DELETE" && path === `/api/v1/connection/devices/${encodeURIComponent(deviceId)}`) return true;
  return (method === "GET" || method === "HEAD") && AGENT_READS.some((pattern) => pattern.test(path));
}

function agentFull(request: ScopedCall): boolean {
  return agentReadOnly(request) || (AGENT_WRITES[request.method] ?? []).some((pattern) => pattern.test(request.path));
}

const ALLOWLISTS: Partial<Record<PairedDeviceClient, Partial<Record<DeviceScope, (request: ScopedCall) => boolean>>>> = {
  [PairedDeviceClient.phone]: { [DeviceScope.full]: () => true },
  [PairedDeviceClient.watch]: { [DeviceScope.rulesOnly]: watchRulesOnly },
  [PairedDeviceClient.agent]: { [DeviceScope.full]: agentFull, [DeviceScope.readOnly]: agentReadOnly },
};

/** Whether a device of this client may hold this scope: exactly the four pairs above. */
export function isValidScope(client: PairedDeviceClient, scope: DeviceScope): boolean {
  return Boolean(ALLOWLISTS[client]?.[scope]);
}

export function deviceRouteAllowed(input: { client: PairedDeviceClient; scope: DeviceScope } & ScopedCall): boolean {
  const allowed = ALLOWLISTS[input.client]?.[input.scope];
  return allowed ? allowed(input) : false;
}
