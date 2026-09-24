/**
 * Who can call what, as one table. Every route handler under `src/app/api/v1` is found on
 * disk and called once per caller; the table below says which status class each caller
 * must get. A route or method the table does not name fails the suite, so a new route
 * has to declare its access here before it can land.
 *
 * The matrix checks the guard, not the handler: bodies are `{}` and ids do not exist, so
 * an allowed caller reaches validation or a 404 and nothing is written. The route's own
 * test file covers what it does once let in.
 *
 * Every request is still checked against the OpenAPI document. A body goes only to an
 * operation that documents one, and a route whose placeholder request breaks the
 * document says so with `invalidPlaceholder`, which sends it as `invalidRequest`: the
 * check then insists the request really is invalid and every caller gets a 4xx.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { AccountKind, SessionKind } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { CSRF_COOKIE, RECOVERY_USERNAME, SESSION_COOKIE } from "@/lib/constants";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { tunnelHeaders } from "@/server/tunnel/phone-gateway";
import { resetDatabase } from "../helpers/db";
import { request } from "../helpers/http";
import { documentsRequestBody, invalidRequest } from "../helpers/openapi-responses";

const REPO_ROOT = path.resolve(__dirname, "../..");
const API_ROOT = path.join(REPO_ROOT, "src/app");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

/**
 * - `anonymous`: no session, on the home network.
 * - `member`: a personal adult account without administrator access.
 * - `administrator`: a personal adult account with administrator access.
 * - `recovery`: the recovery `admin` account.
 * - `tunnel`: an administrator's browser, signed in, reaching the app through remote
 *   access without a paired phone. Its headers go through the phone gateway's own
 *   `tunnelHeaders`, so the cookie is stripped and `x-familyfi-via: tunnel` is stamped
 *   exactly as they would be in production.
 */
const CALLERS = ["anonymous", "member", "administrator", "recovery", "tunnel"] as const;
type Caller = (typeof CALLERS)[number];

type Outcome = "allowed" | "401" | "403";

/**
 * - `public`: anyone, including over the tunnel.
 * - `home-network`: anyone on the home network; refused over the tunnel without a
 *   paired phone (sign-in).
 * - `session`: any signed-in account.
 * - `administrator`: a signed-in administrator or the recovery account.
 * - `csrf`: needs the CSRF cookie and header but no session (sign-out).
 * - `pairing-token`: the single-use pairing token is the credential; no session helps
 *   without it.
 */
type Access = "public" | "home-network" | "session" | "administrator" | "csrf" | "pairing-token";

const EXPECTED: Record<Access, Record<Caller, Outcome>> = {
  public: { anonymous: "allowed", member: "allowed", administrator: "allowed", recovery: "allowed", tunnel: "allowed" },
  "home-network": { anonymous: "allowed", member: "allowed", administrator: "allowed", recovery: "allowed", tunnel: "403" },
  session: { anonymous: "401", member: "allowed", administrator: "allowed", recovery: "allowed", tunnel: "401" },
  administrator: { anonymous: "401", member: "403", administrator: "allowed", recovery: "allowed", tunnel: "401" },
  csrf: { anonymous: "403", member: "allowed", administrator: "allowed", recovery: "allowed", tunnel: "403" },
  "pairing-token": { anonymous: "403", member: "403", administrator: "403", recovery: "403", tunnel: "403" },
};

/**
 * `question` marks a cell encoded as it behaves today, where the route looks more open
 * than its neighbours suggest. It is for the maintainer to confirm or tighten; changing
 * the access here is the decision, and the route's guard must change with it.
 */
type Entry = { access: Access; question?: string; invalidPlaceholder?: true };

/**
 * Administrator is a flag, not a tier: it gates phone pairing and remote access
 * (`/api/v1/connection/*`) and nothing else. Every adult with a login is trusted with
 * the household, so accounts, household settings and the UniFi connection are `session`,
 * a member can grant themselves administrator, and that is intended.
 */

const ACCESS: Record<string, Entry> = {
  "GET /api/v1/accounts": { access: "session" },
  "POST /api/v1/accounts": { access: "session", invalidPlaceholder: true },
  "GET /api/v1/accounts/{id}": { access: "session" },
  "PUT /api/v1/accounts/{id}": { access: "session" },
  "DELETE /api/v1/accounts/{id}": { access: "session" },
  "PUT /api/v1/accounts/{id}/password": { access: "session", invalidPlaceholder: true },
  "POST /api/v1/auth/login": { access: "home-network" },
  "POST /api/v1/auth/logout": { access: "csrf" },
  "GET /api/v1/auth/session": { access: "session" },
  "GET /api/v1/changes/{id}": { access: "session" },
  "GET /api/v1/connection": { access: "session" },
  "GET /api/v1/connection/devices": { access: "administrator" },
  "DELETE /api/v1/connection/devices": { access: "administrator", invalidPlaceholder: true },
  "DELETE /api/v1/connection/devices/{id}": { access: "administrator" },
  "GET /api/v1/connection/endpoints": { access: "administrator" },
  "POST /api/v1/connection/endpoints": { access: "administrator", invalidPlaceholder: true },
  "PUT /api/v1/connection/endpoints/{id}": { access: "administrator" },
  "DELETE /api/v1/connection/endpoints/{id}": { access: "administrator" },
  "GET /api/v1/connection/identity": { access: "public" },
  "POST /api/v1/connection/pairings": { access: "administrator", invalidPlaceholder: true },
  "GET /api/v1/connection/pairings/{id}": { access: "administrator" },
  "DELETE /api/v1/connection/pairings/{id}": { access: "administrator" },
  "POST /api/v1/connection/pairings/{id}/claim": { access: "pairing-token" },
  "POST /api/v1/connection/pins": { access: "administrator", invalidPlaceholder: true },
  "GET /api/v1/connection/tunnel": { access: "administrator" },
  "PUT /api/v1/connection/tunnel": { access: "administrator", invalidPlaceholder: true },
  "GET /api/v1/devices": { access: "session" },
  "GET /api/v1/devices/{mac}": { access: "session" },
  "DELETE /api/v1/devices/{mac}": { access: "session" },
  "PUT /api/v1/devices/{mac}/assignment": { access: "session", invalidPlaceholder: true },
  "GET /api/v1/dpi/applications": { access: "session" },
  "GET /api/v1/dpi/categories": { access: "session" },
  "GET /api/v1/groups": { access: "session" },
  "POST /api/v1/groups": { access: "session", invalidPlaceholder: true },
  "GET /api/v1/groups/{id}": { access: "session" },
  "PUT /api/v1/groups/{id}": { access: "session" },
  "DELETE /api/v1/groups/{id}": { access: "session" },
  "POST /api/v1/groups/{id}/extend": { access: "session", invalidPlaceholder: true },
  "POST /api/v1/groups/{id}/pause": { access: "session" },
  "PUT /api/v1/groups/{id}/resolver": { access: "session", invalidPlaceholder: true },
  "DELETE /api/v1/groups/{id}/resolver": { access: "session" },
  "POST /api/v1/groups/{id}/resume": { access: "session" },
  "PUT /api/v1/groups/{id}/schedule": { access: "session", invalidPlaceholder: true },
  "GET /api/v1/health": { access: "public" },
  "GET /api/v1/rules": { access: "session" },
  "POST /api/v1/rules": { access: "session", invalidPlaceholder: true },
  "GET /api/v1/rules/{id}": { access: "session" },
  "PATCH /api/v1/rules/{id}": { access: "session" },
  "DELETE /api/v1/rules/{id}": { access: "session" },
  "POST /api/v1/rules/{id}/off": { access: "session" },
  "GET /api/v1/settings/household": { access: "session" },
  "PUT /api/v1/settings/household": { access: "session" },
  "GET /api/v1/settings/unifi": { access: "session" },
  "PUT /api/v1/settings/unifi": { access: "session" },
  "POST /api/v1/settings/unifi/test": { access: "session" },
  "GET /api/v1/sync": { access: "session" },
  "POST /api/v1/sync/retry": { access: "session" },
  "GET /api/v1/upstream/categories": { access: "session" },
  "POST /api/v1/upstream/categories": { access: "session", invalidPlaceholder: true },
  "GET /api/v1/upstream/categories/{id}": { access: "session" },
  "PATCH /api/v1/upstream/categories/{id}": { access: "session" },
  "DELETE /api/v1/upstream/categories/{id}": { access: "session" },
  "POST /api/v1/upstream/categories/{id}/check": { access: "session" },
  "GET /api/v1/upstream/checks": { access: "session" },
  "POST /api/v1/upstream/checks/run": { access: "session" },
  "GET /api/v1/upstream/resolver": { access: "session" },
  "PUT /api/v1/upstream/resolver": { access: "session" },
  "DELETE /api/v1/upstream/resolver": { access: "session" },
};

/** Bodies that get a caller past validation to the check under test. Everything else sends `{}`. */
const BODIES: Record<string, unknown> = {
  "POST /api/v1/auth/login": { username: RECOVERY_USERNAME, password: PASSWORD, client: "browser" },
  "POST /api/v1/connection/pairings/{id}/claim": { token: "not-a-pairing-token", deviceName: "Matrix phone" },
};

const PARAMS: Record<string, string> = { id: "matrix-missing-id", mac: "02:00:00:00:0a:99" };

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Route = { key: string; method: (typeof METHODS)[number]; template: string; handler: Handler };

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

/** The OpenAPI template for a route file, derived the way `scripts/check-openapi.mjs` does. */
function templateFor(file: string): string {
  return `/${path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/").replace(/\[([^\]]+)\]/g, "{$1}")}`;
}

async function discoverRoutes(): Promise<Route[]> {
  const routes: Route[] = [];
  for (const file of routeFiles(path.join(API_ROOT, "api/v1")).sort()) {
    const template = templateFor(file);
    const loaded = (await import(file)) as Record<string, unknown>;
    for (const method of METHODS) {
      if (typeof loaded[method] === "function") routes.push({ key: `${method} ${template}`, method, template, handler: loaded[method] as Handler });
    }
  }
  return routes;
}

const routes = await discoverRoutes();

const accounts: Partial<Record<Caller, string>> = {};

async function signedIn(accountId: string, username: string) {
  const issued = await createSession({ accountId, username, kind: SessionKind.cookie });
  return { cookie: `${SESSION_COOKIE}=${issued.raw}; ${CSRF_COOKIE}=${issued.csrf}`, csrf: issued.csrf };
}

/** A fresh request per cell: sign-out revokes the session it is sent with. */
async function requestAs(caller: Caller, route: Route): Promise<Request> {
  const placeholder = await unmarkedRequestAs(caller, route);
  return ACCESS[route.key]?.invalidPlaceholder ? invalidRequest(placeholder) : placeholder;
}

async function unmarkedRequestAs(caller: Caller, route: Route): Promise<Request> {
  const url = route.template.replace(/\{(\w+)\}/g, (_match, name: string) => encodeURIComponent(PARAMS[name]));
  const hasBody = documentsRequestBody(route.method, route.template);
  const init = {
    method: route.method,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(BODIES[route.key] ?? {}) : undefined,
  };
  if (caller === "anonymous") return request(url, init);
  const account = caller === "tunnel" ? accounts.administrator! : accounts[caller]!;
  const username = (await prisma().account.findUniqueOrThrow({ where: { id: account } })).username;
  const lan = request(url, { ...init, auth: await signedIn(account, username) });
  if (caller !== "tunnel") return lan;
  const incoming = Object.fromEntries(lan.headers.entries());
  return new Request(lan.url, { ...init, headers: tunnelHeaders(incoming) as Record<string, string> });
}

function outcome(status: number): Outcome | `unexpected ${number}` {
  if (status === 401) return "401";
  if (status === 403) return "403";
  return status < 500 ? "allowed" : `unexpected ${status}`;
}

describe("authorization matrix", () => {
  beforeAll(async () => {
    await resetDatabase();
    const recovery = await prisma().account.findUniqueOrThrow({ where: { username: RECOVERY_USERNAME } });
    const passwordHash = await hashPassword("matrix-password-1");
    const member = await prisma().account.create({ data: { username: "matrix-member", displayName: "Member", kind: AccountKind.personal, isAdmin: false, passwordHash } });
    const administrator = await prisma().account.create({ data: { username: "matrix-admin", displayName: "Administrator", kind: AccountKind.personal, isAdmin: true, passwordHash } });
    Object.assign(accounts, { member: member.id, administrator: administrator.id, recovery: recovery.id });
  });

  it("covers every route and method, and names none that do not exist", () => {
    const found = routes.map((route) => route.key);
    expect(found.filter((key) => !(key in ACCESS)), "routes with no access declared in ACCESS").toEqual([]);
    expect(Object.keys(ACCESS).filter((key) => !found.includes(key)), "ACCESS entries with no route").toEqual([]);
    expect(Object.keys(BODIES).filter((key) => !found.includes(key)), "BODIES entries with no route").toEqual([]);
  });

  it.each(routes.map((route) => [route.key, route] as const))("%s", async (key, route) => {
    const entry = ACCESS[key];
    if (!entry) throw new Error(`${key} has no access declared in ACCESS.`);
    const actual: Record<string, string> = {};
    for (const caller of CALLERS) {
      const response = await route.handler(await requestAs(caller, route), { params: Promise.resolve(PARAMS) });
      actual[caller] = outcome(response.status);
    }
    expect(actual).toEqual(EXPECTED[entry.access]);
  });
});
