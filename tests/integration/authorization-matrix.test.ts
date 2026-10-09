/**
 * Who can call what, as one table. Every route handler under `src/app/api/v1` is found on
 * disk and called once per caller; the table below says which status class each caller
 * must get. A route or method the table does not name fails the suite, so a new route
 * has to declare its access here before it can land.
 *
 * The matrix checks the guard, not the handler: bodies are `{}` and ids do not exist, so
 * an allowed caller reaches validation or a 404 and nothing is written. The route's own
 * test file covers what it does once let in.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { AccountKind, DeviceScope, PairedDeviceClient, SessionKind } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { CSRF_COOKIE, RECOVERY_USERNAME, SESSION_COOKIE } from "@/lib/constants";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { tunnelHeaders } from "@/server/tunnel/phone-gateway";
import { resetDatabase } from "../helpers/db";
import { request } from "../helpers/http";

const REPO_ROOT = path.resolve(__dirname, "../..");
const API_ROOT = path.join(REPO_ROOT, "src/app");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

/**
 * - `anonymous`: no session, on the home network.
 * - `member`: a personal adult account without administrator access. Only administrators use FamilyFi,
 *   so its session (made directly; it cannot sign in) is refused wherever one is needed.
 * - `administrator`: a personal adult account with administrator access.
 * - `recovery`: the recovery `admin` account.
 * - `tunnel`: an administrator's browser, signed in, reaching the app through remote
 *   access without a paired phone. Its headers go through the phone gateway's own
 *   `tunnelHeaders`, so the cookie is stripped and `x-familyfi-via: tunnel` is stamped
 *   exactly as they would be in production.
 * - `agent:full`, `agent:readOnly` and `watch:rulesOnly`: a paired device on the home network,
 *   signed in as the administrator, with that scope. Its scope bounds it, not the account.
 */
const DEVICES = ["agent:full", "agent:readOnly", "watch:rulesOnly"] as const;
type Device = (typeof DEVICES)[number];
const CALLERS = ["anonymous", "member", "administrator", "recovery", "tunnel", ...DEVICES] as const;
type Caller = (typeof CALLERS)[number];

type Outcome = "allowed" | "401" | "403";

/**
 * - `public`: anyone, including over the tunnel.
 * - `home-network`: anyone on the home network; refused over the tunnel without a
 *   paired phone (sign-in).
 * - `session`: any signed-in account, which is always an administrator's (only administrators sign in).
 * - `administrator`: a signed-in administrator or the recovery account.
 * - `csrf`: needs the CSRF cookie and header but no session (sign-out).
 * - `pairing-token`: the single-use pairing token is the credential; no session helps
 *   without it.
 * - `refresh-token`: a paired device's refresh token is the credential; no session helps
 *   without it.
 */
type Access = "public" | "home-network" | "session" | "administrator" | "csrf" | "pairing-token" | "refresh-token";

type Person = Exclude<Caller, Device>;

function isDevice(caller: Caller): caller is Device {
  return (DEVICES as readonly Caller[]).includes(caller);
}

const EXPECTED: Record<Access, Record<Person, Outcome>> = {
  public: { anonymous: "allowed", member: "allowed", administrator: "allowed", recovery: "allowed", tunnel: "allowed" },
  "home-network": { anonymous: "allowed", member: "allowed", administrator: "allowed", recovery: "allowed", tunnel: "403" },
  session: { anonymous: "401", member: "401", administrator: "allowed", recovery: "allowed", tunnel: "401" },
  administrator: { anonymous: "401", member: "401", administrator: "allowed", recovery: "allowed", tunnel: "401" },
  csrf: { anonymous: "403", member: "allowed", administrator: "allowed", recovery: "allowed", tunnel: "403" },
  "pairing-token": { anonymous: "403", member: "403", administrator: "403", recovery: "403", tunnel: "403" },
  "refresh-token": { anonymous: "403", member: "403", administrator: "403", recovery: "403", tunnel: "403" },
};

/**
 * A paired device passes where no session is needed, and otherwise only where the route names
 * its scope; even then it is never an administrator. Refused, any device gets 403.
 */
function deviceOutcome(entry: Entry, device: Device): Outcome {
  if (entry.access === "public" || entry.access === "home-network" || entry.access === "csrf") return "allowed";
  if (entry.access === "pairing-token" || entry.access === "refresh-token") return "403";
  if (entry.devices?.includes(device)) return entry.access === "session" ? "allowed" : "403";
  return "403";
}

function expected(entry: Entry): Record<Caller, Outcome> {
  return { ...EXPECTED[entry.access], ...Object.fromEntries(DEVICES.map((device) => [device, deviceOutcome(entry, device)])) } as Record<Caller, Outcome>;
}

/**
 * `devices` names the paired-device scopes whose allowlist (`src/server/device-scope.ts`) includes the
 * route; a device whose scope is not named may not call it.
 * `question` marks a cell encoded as it behaves today, where the route looks more open
 * than its neighbours suggest. It is for the maintainer to confirm or tighten; changing
 * the access here is the decision, and the route's guard must change with it.
 */
type Entry = { access: Access; devices?: readonly Device[]; question?: string };

const READERS: readonly Device[] = ["agent:full", "agent:readOnly"];
const READERS_AND_WATCH: readonly Device[] = ["agent:full", "agent:readOnly", "watch:rulesOnly"];
const CONTROLLERS: readonly Device[] = ["agent:full"];
const CONTROLLERS_AND_WATCH: readonly Device[] = ["agent:full", "watch:rulesOnly"];

/**
 * Only administrators use FamilyFi: an adult without administrator access has no sign-in, session
 * or paired device (auth-api.test.ts), so `session` and `administrator` admit the same people. The
 * split remains for paired devices and the tunnel: `administrator` also refuses every non-phone
 * device. A phone's `?claim=true` invite for its Watch is checked inside `POST /paired/invites`
 * (paired-invites.test.ts), not here.
 */

/**
 * One rule narrows these per-route cells by id: the built-in quarantine rule's switch (`PATCH` and
 * `DELETE /rules/quarantine`, `POST /rules/quarantine/on|off`) is the household's quarantine setting,
 * so no Watch or agent may call it (device-scope.test.ts, agent-pairing.test.ts). Its other verbs are as listed.
 */
const ACCESS: Record<string, Entry> = {
  "GET /api/v1/accounts": { access: "session" },
  "POST /api/v1/accounts": { access: "session" },
  "GET /api/v1/accounts/{id}": { access: "session" },
  "PUT /api/v1/accounts/{id}": { access: "session" },
  "DELETE /api/v1/accounts/{id}": { access: "session" },
  "PUT /api/v1/accounts/{id}/password": { access: "session" },
  "POST /api/v1/auth/login": { access: "home-network" },
  "POST /api/v1/auth/logout": { access: "csrf" },
  "POST /api/v1/auth/refresh": { access: "refresh-token" },
  "GET /api/v1/auth/session": { access: "session", devices: READERS_AND_WATCH },
  "GET /api/v1/changes/{id}": { access: "session", devices: READERS_AND_WATCH },
  "GET /api/v1/connection": { access: "session", devices: ["watch:rulesOnly"] },
  "GET /api/v1/connection/endpoints": { access: "administrator" },
  "POST /api/v1/connection/endpoints": { access: "administrator" },
  "PUT /api/v1/connection/endpoints/{id}": { access: "administrator" },
  "DELETE /api/v1/connection/endpoints/{id}": { access: "administrator" },
  "GET /api/v1/connection/identity": { access: "public" },
  "GET /api/v1/connection/home": { access: "administrator" },
  "PUT /api/v1/connection/home": { access: "administrator" },
  "POST /api/v1/connection/pins": { access: "administrator" },
  "GET /api/v1/connection/tunnel": { access: "administrator" },
  "PUT /api/v1/connection/tunnel": { access: "administrator" },
  "GET /api/v1/devices": { access: "session", devices: READERS },
  "GET /api/v1/devices/{mac}": { access: "session", devices: READERS },
  "DELETE /api/v1/devices/{mac}": { access: "session", devices: CONTROLLERS },
  "PUT /api/v1/devices/{mac}/assignment": { access: "session", devices: CONTROLLERS },
  "POST /api/v1/paired/invites": { access: "administrator" },
  "GET /api/v1/paired/invites/{id}": { access: "administrator" },
  "DELETE /api/v1/paired/invites/{id}": { access: "administrator" },
  "POST /api/v1/paired/invites/{id}/claim": { access: "pairing-token" },
  "GET /api/v1/paired/devices": { access: "administrator" },
  "DELETE /api/v1/paired/devices": { access: "administrator" },
  "GET /api/v1/paired/devices/{id}": { access: "administrator" },
  "PATCH /api/v1/paired/devices/{id}": { access: "administrator" },
  "DELETE /api/v1/paired/devices/{id}": { access: "administrator", devices: ["watch:rulesOnly"] },
  "GET /api/v1/dpi/applications": { access: "session", devices: READERS },
  "GET /api/v1/dpi/categories": { access: "session", devices: READERS },
  "GET /api/v1/groups": { access: "session", devices: READERS_AND_WATCH },
  "GET /api/v1/groups/{id}/resolver": { access: "session" },
  "POST /api/v1/groups": { access: "session", devices: CONTROLLERS },
  "GET /api/v1/groups/{id}": { access: "session", devices: READERS },
  "PUT /api/v1/groups/{id}": { access: "session", devices: CONTROLLERS },
  "DELETE /api/v1/groups/{id}": { access: "session", devices: CONTROLLERS },
  "PUT /api/v1/groups/{id}/resolver": { access: "session" },
  "DELETE /api/v1/groups/{id}/resolver": { access: "session" },
  "GET /api/v1/health": { access: "public" },
  "GET /api/v1/rules": { access: "session", devices: READERS_AND_WATCH },
  "POST /api/v1/rules": { access: "session", devices: CONTROLLERS },
  "GET /api/v1/rules/{id}": { access: "session", devices: READERS },
  "PATCH /api/v1/rules/{id}": { access: "session", devices: CONTROLLERS },
  "DELETE /api/v1/rules/{id}": { access: "session", devices: CONTROLLERS },
  "POST /api/v1/rules/{id}/allow": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/rules/{id}/disallow": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/rules/{id}/extend": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/rules/{id}/off": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/rules/{id}/on": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/rules/{id}/pause": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/rules/{id}/resume": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/groups/{id}/rules/{ruleId}/allow": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/groups/{id}/rules/{ruleId}/disallow": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/groups/{id}/rules/{ruleId}/extend": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/groups/{id}/rules/{ruleId}/pause": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "POST /api/v1/groups/{id}/rules/{ruleId}/resume": { access: "session", devices: CONTROLLERS_AND_WATCH },
  "GET /api/v1/settings/export": { access: "administrator" },
  "GET /api/v1/settings/household": { access: "session", devices: READERS },
  "PUT /api/v1/settings/household": { access: "session" },
  "POST /api/v1/settings/import": { access: "administrator" },
  "GET /api/v1/settings/unifi": { access: "session" },
  "PUT /api/v1/settings/unifi": { access: "session" },
  "POST /api/v1/settings/unifi/test": { access: "session" },
  "GET /api/v1/settings/update": { access: "administrator" },
  "POST /api/v1/settings/update/install": { access: "administrator" },
  "PUT /api/v1/settings/update/schedule": { access: "administrator" },
  "GET /api/v1/sync": { access: "session", devices: READERS },
  "POST /api/v1/sync/retry": { access: "session", devices: CONTROLLERS },
  "GET /api/v1/upstream/categories": { access: "session", devices: READERS },
  "POST /api/v1/upstream/categories": { access: "session", devices: CONTROLLERS },
  "GET /api/v1/upstream/categories/{id}": { access: "session", devices: READERS },
  "PATCH /api/v1/upstream/categories/{id}": { access: "session", devices: CONTROLLERS },
  "DELETE /api/v1/upstream/categories/{id}": { access: "session", devices: CONTROLLERS },
  "POST /api/v1/upstream/categories/{id}/check": { access: "session", devices: CONTROLLERS },
  "GET /api/v1/upstream/checks": { access: "session", devices: READERS },
  "POST /api/v1/upstream/checks/run": { access: "session", devices: CONTROLLERS },
  "GET /api/v1/upstream/resolver": { access: "session" },
  "PUT /api/v1/upstream/resolver": { access: "session" },
  "DELETE /api/v1/upstream/resolver": { access: "session" },
};

/** Bodies that get a caller past validation to the check under test. Everything else sends `{}`. */
const BODIES: Record<string, unknown> = {
  "POST /api/v1/auth/login": { username: RECOVERY_USERNAME, password: PASSWORD, client: "browser" },
  "POST /api/v1/paired/invites/{id}/claim": { token: "not-a-pairing-token", deviceName: "Matrix phone" },
  "POST /api/v1/auth/refresh": { refreshToken: "not-a-refresh-token" },
};

const PARAMS: Record<string, string> = { id: "matrix-missing-id", ruleId: "matrix-missing-rule", sessionId: "matrix-missing-session", mac: "02:00:00:00:0a:99" };

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Route = { key: string; method: (typeof METHODS)[number]; template: string; handler: Handler };

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

/** The OpenAPI template for a route file, derived the way `scripts/ci/check-openapi.mjs` does. */
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

const accounts: Partial<Record<Person, string>> = {};
const devices: Partial<Record<Device, string>> = {};

async function signedIn(accountId: string, username: string) {
  const issued = await createSession({ accountId, username, kind: SessionKind.cookie });
  return { cookie: `${SESSION_COOKIE}=${issued.raw}; ${CSRF_COOKIE}=${issued.csrf}`, csrf: issued.csrf };
}

/** A fresh request per cell: sign-out revokes the session it is sent with. */
async function requestAs(caller: Caller, route: Route): Promise<Request> {
  const url = route.template.replace(/\{(\w+)\}/g, (_match, name: string) => encodeURIComponent(PARAMS[name]));
  const hasBody = route.method !== "GET" && route.method !== "DELETE";
  const init = {
    method: route.method,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(BODIES[route.key] ?? {}) : undefined,
  };
  if (caller === "anonymous") return request(url, init);
  if (isDevice(caller)) {
    const issued = await createSession({ accountId: accounts.administrator!, username: "matrix-admin", kind: SessionKind.bearer, deviceId: devices[caller] });
    return request(url, { ...init, auth: { cookie: "", csrf: "", token: issued.raw } });
  }
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
    for (const device of DEVICES) {
      const [client, scope] = device.split(":") as [PairedDeviceClient, DeviceScope];
      const created = await prisma().pairedDevice.create({ data: { displayName: device, client, scope, accountId: client === PairedDeviceClient.agent ? administrator.id : null } });
      devices[device] = created.id;
    }
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
    expect(actual).toEqual(expected(entry));
  });
});
