import { compareSemver, parseSemver } from "./semver";

/**
 * Whether a client and a server can read each other, decided before the client reads the
 * household. The floors are `info.x-min-app`, `info.x-min-server` and `info.x-min-watch` in
 * `openapi/familyfi.v1.yaml`; CI raises the first two from the spec diff, and the watches' is set by
 * hand (docs/api.md, "Versioning the contract"). `tests/unit/api-compat.test.ts` keeps these
 * constants equal to them. The native watch
 * apps port `apiCompatibility`, which `tests/fixtures/display-vectors.json` pins.
 */

/**
 * This contract's `info.version`, which is always the release version (`tests/unit/version.test.ts`).
 * A literal rather than package.json's, so a client that vendors this module, such as the companion
 * app, never bundles familyfi's package.json; `tests/unit/api-compat.test.ts` fails when it drifts.
 */
export const API_VERSION: string = "0.42.1";
/** The oldest client API version this server still serves (`info.x-min-app`). */
export const MIN_APP_API_VERSION = "0.36.0";
/** The oldest server API version a client built from this contract can read (`info.x-min-server`). */
export const MIN_SERVER_API_VERSION = "0.36.0";
/** The oldest watch app API version this server still serves (`info.x-min-watch`), set by hand. */
export const MIN_WATCH_API_VERSION = "0.30.0";

/** The versions `GET /api/v1/health` reports. A server from before API 0.41.0 sends only `version`. */
export type HealthVersions = { version?: string; apiVersion?: string; minAppApiVersion?: string; minWatchApiVersion?: string };

/**
 * Which client asks: its API version, the oldest server it reads, and whether it is a watch app,
 * which the server serves from `minWatchApiVersion` rather than `minAppApiVersion`.
 */
export type ApiClient = { apiVersion: string; minServerApi: string; watch?: boolean };

/** `update_app`: the server no longer serves this client. `update_server`: the server is older than this client can read. */
export type ApiMismatch = "update_app" | "update_server";

export type ApiCompatibility =
  | { status: "ok" }
  | { status: ApiMismatch; appApiVersion: string; serverApiVersion: string };

export function apiCompatibility(
  health: HealthVersions,
  client: ApiClient = { apiVersion: API_VERSION, minServerApi: MIN_SERVER_API_VERSION },
): ApiCompatibility {
  // Before 0.41.0 the release version and the API version were the same number.
  const serverApiVersion = health.apiVersion ?? health.version;
  const server = serverApiVersion ? parseSemver(serverApiVersion) : null;
  const app = parseSemver(client.apiVersion);
  // A version that can't be read decides nothing: the household load reports whatever goes wrong.
  if (!server || !app) return { status: "ok" };
  const mismatch = { appApiVersion: app.version, serverApiVersion: server.version };
  const served = client.watch ? health.minWatchApiVersion : health.minAppApiVersion;
  const minAppApi = served ? parseSemver(served) : null;
  if (minAppApi && compareSemver(app, minAppApi) < 0) return { status: "update_app", ...mismatch };
  const minServerApi = parseSemver(client.minServerApi);
  if (minServerApi && compareSemver(server, minServerApi) < 0) return { status: "update_server", ...mismatch };
  return { status: "ok" };
}

/** What the update screens say. Plain words for a parent; the versions line is for whoever helps them. */
export const API_COMPAT_COPY = {
  appTitle: "Update the FamilyFi app",
  appBody: "Your FamilyFi server was updated, and this version of the app can't work with it.",
  appAction: "Update app",
  serverTitle: "Your server needs an update",
  serverBody: "This version of the app needs a newer FamilyFi server.",
  serverReady: (version: string) => `FamilyFi ${version} is ready to install.`,
  serverManual: "Update it from FamilyFi's Settings on your computer, then try again.",
  serverAction: "Install update",
  safe: "Your rules and pauses keep working in the meantime.",
  versions: (app: string, server: string) => `This app ${app} · Server ${server}`,
  tryAgain: "Try again",
  pairApp: "This version of the app can't work with your FamilyFi server. Update the app, then try again.",
  pairServer: "This version of the app needs a newer FamilyFi server. Update it from FamilyFi's Settings on your computer, then try again.",
} as const;

/** Pairing stopped before spending the code: this client and the server can't read each other. */
export class ApiMismatchError extends Error {
  constructor(readonly compatibility: Exclude<ApiCompatibility, { status: "ok" }>) {
    super(compatibility.status === "update_app" ? API_COMPAT_COPY.pairApp : API_COMPAT_COPY.pairServer);
    this.name = "ApiMismatchError";
  }
}
