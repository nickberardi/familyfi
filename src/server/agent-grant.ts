import { AgentGrant } from "@prisma/client";

/**
 * What a paired agent may call. Every adult login is an administrator in practice, so an agent's
 * reach comes from its grant, never from the account it acts as. Anything not listed is refused:
 * accounts, UniFi settings, changes to household settings, resolvers, and connection management (pairing, routes,
 * the tunnel, and `GET /connection`, whose manifest carries Cloudflare Access tokens).
 */
const READ: RegExp[] = [
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
const CONTROLS: Record<string, RegExp[]> = {
  POST: [
    /^\/api\/v1\/groups$/,
    /^\/api\/v1\/rules$/,
    /^\/api\/v1\/rules\/[^/]+\/(on|off|pause|resume|extend|allow|disallow)$/,
    /^\/api\/v1\/groups\/[^/]+\/rules\/[^/]+\/(pause|resume|extend|allow|disallow)$/,
    /^\/api\/v1\/sync\/retry$/,
    /^\/api\/v1\/upstream\/categories$/,
    /^\/api\/v1\/upstream\/categories\/[^/]+\/check$/,
    /^\/api\/v1\/upstream\/checks\/run$/,
  ],
  PUT: [/^\/api\/v1\/groups\/[^/]+$/, /^\/api\/v1\/devices\/[^/]+\/assignment$/],
  PATCH: [/^\/api\/v1\/rules\/[^/]+$/, /^\/api\/v1\/upstream\/categories\/[^/]+$/],
  DELETE: [/^\/api\/v1\/groups\/[^/]+$/, /^\/api\/v1\/rules\/[^/]+$/, /^\/api\/v1\/devices\/[^/]+$/, /^\/api\/v1\/upstream\/categories\/[^/]+$/],
};

export function agentRouteAllowed(input: { method: string; path: string; grant: AgentGrant | null; deviceId: string }): boolean {
  const { method, path, grant } = input;
  // Any agent may disconnect itself.
  if (method === "DELETE" && path === `/api/v1/connection/devices/${encodeURIComponent(input.deviceId)}`) return true;
  if (method === "GET" || method === "HEAD") return READ.some((pattern) => pattern.test(path));
  if (grant !== AgentGrant.controls) return false;
  return (CONTROLS[method] ?? []).some((pattern) => pattern.test(path));
}
