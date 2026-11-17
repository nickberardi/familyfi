import { mayHoldScope, type ClientScope } from "@/lib/client-type";

/**
 * What a paired device may call. Every paired device has a scope, and each scope is one explicit
 * allowlist, never a ladder: an agent's `full` is the agent list, not an app's minus exceptions. Only
 * administrators use FamilyFi, so every device but a child's acts as one, and the scope bounds the
 * device whatever its account may do; a child's phone acts as no account at all. A scope not named here, or one its client type may not hold
 * (`CLIENT_SCOPES` in src/lib/client-type.ts), allows nothing.
 *
 * - `app:full`: the app (`app`) on a phone, tablet or Mac: everything its account may do.
 * - `app:rulesOnly`: the app's Watch (`app-watch`), and its Siri, Shortcuts and system controls
 *   (`app-controls`), which run outside the app and so sign in as their own device, never with the
 *   app's tokens: lists, the rule verbs, a group's unblock, and `GET /connection` for the manifest
 *   they need away from home.
 * - `agent:full`: household reads and controls; never accounts, UniFi settings, resolvers, household
 *   settings changes or connection management, including `GET /connection`, whose manifest carries
 *   Cloudflare Access tokens.
 * - `agent:readOnly`: household reads.
 * - `me:askOnly`: FamilyFi Me on a child's phone (`me`), which signs in for its family group and
 *   never as an account: its session, `GET /connection` for the manifest it needs away from home, its
 *   own group's day (`GET /me/day`), and un-pairing itself. It reads nothing else in the household.
 *
 * The built-in quarantine rule's switch is the household's quarantine setting, so an `app:rulesOnly` device or an
 * agent may pause, extend and resume it, never switch, edit or delete it.
 */

/** Pause, resume, extend, allow, disallow, on and off on one rule, for every group it covers. */
const RULE_VERBS = /^\/api\/v1\/rules\/[^/]+\/(pause|resume|extend|allow|disallow|on|off)$/;
/** The same verbs for one group alone, including its built-in `internet` rule. */
const GROUP_RULE_VERBS = /^\/api\/v1\/groups\/[^/]+\/rules\/[^/]+\/(pause|resume|extend|allow|disallow)$/;
/** A group's unblock, which lifts whatever blocks it now, and its end and extend. */
const GROUP_UNBLOCK = /^\/api\/v1\/groups\/[^/]+\/unblock(\/(end|extend))?$/;

/** The built-in quarantine rule's switch: PATCH, DELETE, on and off. Its other verbs are rule verbs. */
const QUARANTINE_SWITCH = /^\/api\/v1\/rules\/quarantine(\/(on|off))?$/;

type ScopedCall = { method: string; path: string; deviceId: string };

function changesQuarantineSetting({ method, path }: ScopedCall): boolean {
  return method !== "GET" && method !== "HEAD" && QUARANTINE_SWITCH.test(path);
}

/** `app:rulesOnly`: the one list a Watch and an app's Siri, Shortcuts and controls share. */
function rulesOnly({ method, path }: ScopedCall): boolean {
  if (method === "GET") {
    return path === "/api/v1/auth/session"
      || path === "/api/v1/connection"
      || path === "/api/v1/groups"
      || path === "/api/v1/rules"
      || /^\/api\/v1\/changes\/[^/]+$/.test(path);
  }
  // The route itself lets one of these revoke only itself.
  if (method === "DELETE" && /^\/api\/v1\/paired\/devices\/[^/]+$/.test(path)) return true;
  if (changesQuarantineSetting({ method, path, deviceId: "" })) return false;
  return method === "POST" && (RULE_VERBS.test(path) || GROUP_RULE_VERBS.test(path) || GROUP_UNBLOCK.test(path));
}

const AGENT_READS: RegExp[] = [
  /^\/api\/v1\/auth\/session$/,
  /^\/api\/v1\/checkup$/,
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

/** Household controls: groups, rules and their verbs, device assignment, sync, the network checkup, and DNS reporting categories. */
const AGENT_WRITES: Record<string, RegExp[]> = {
  POST: [
    /^\/api\/v1\/groups$/,
    /^\/api\/v1\/rules$/,
    RULE_VERBS,
    GROUP_RULE_VERBS,
    GROUP_UNBLOCK,
    /^\/api\/v1\/sync\/retry$/,
    /^\/api\/v1\/checkup\/run$/,
    /^\/api\/v1\/upstream\/categories$/,
    /^\/api\/v1\/upstream\/categories\/[^/]+\/check$/,
    /^\/api\/v1\/upstream\/checks\/run$/,
  ],
  PUT: [/^\/api\/v1\/groups\/[^/]+$/, /^\/api\/v1\/devices\/[^/]+\/assignment$/],
  PATCH: [/^\/api\/v1\/checkup\/findings\/[^/]+$/, /^\/api\/v1\/rules\/[^/]+$/, /^\/api\/v1\/upstream\/categories\/[^/]+$/],
  DELETE: [/^\/api\/v1\/groups\/[^/]+$/, /^\/api\/v1\/rules\/[^/]+$/, /^\/api\/v1\/devices\/[^/]+$/, /^\/api\/v1\/upstream\/categories\/[^/]+$/],
};

function agentReadOnly({ method, path, deviceId }: ScopedCall): boolean {
  // Any agent may disconnect itself.
  if (method === "DELETE" && path === `/api/v1/paired/devices/${encodeURIComponent(deviceId)}`) return true;
  return (method === "GET" || method === "HEAD") && AGENT_READS.some((pattern) => pattern.test(path));
}

function agentFull(request: ScopedCall): boolean {
  if (changesQuarantineSetting(request)) return false;
  return agentReadOnly(request) || (AGENT_WRITES[request.method] ?? []).some((pattern) => pattern.test(request.path));
}

/** `me:askOnly`: the child's own day, and the calls every paired device needs to stay signed in. */
function meAskOnly({ method, path, deviceId }: ScopedCall): boolean {
  if (method === "GET") return path === "/api/v1/auth/session" || path === "/api/v1/connection" || path === "/api/v1/me/day";
  return method === "DELETE" && path === `/api/v1/paired/devices/${encodeURIComponent(deviceId)}`;
}

const ALLOWLISTS: Record<ClientScope, (request: ScopedCall) => boolean> = {
  "app:full": () => true,
  "app:rulesOnly": rulesOnly,
  "agent:full": agentFull,
  "agent:readOnly": agentReadOnly,
  "me:askOnly": meAskOnly,
};

type Held = { clientType: string; scope: string };

/** Whether a device of this client type may hold this scope (`CLIENT_SCOPES`). */
export function isValidScope(clientType: string, scope: string | null | undefined): scope is ClientScope {
  return mayHoldScope(clientType, scope);
}

/**
 * Whether a device is the app itself, with everything its account may do: the only device that may
 * administer, set up a Watch or its own Siri and shortcuts, or be re-paired.
 */
export function isFullApp<T extends Held>(device: T | null | undefined): device is T {
  return device?.clientType === "app" && device.scope === "app:full";
}

export function deviceRouteAllowed(input: Held & ScopedCall): boolean {
  if (!isValidScope(input.clientType, input.scope)) return false;
  return ALLOWLISTS[input.scope](input);
}
