import { compareSemver, parseSemver } from "./semver";

/**
 * Whether a client and a server can read each other, decided before the client reads the
 * household. The two floors are `info.x-oldest-client` and `info.x-oldest-server` in
 * `openapi/familyfi.v1.yaml`, which CI raises from the spec diff (docs/api.md, "Versioning the
 * contract"); `tests/unit/api-compat.test.ts` keeps these constants equal to them. The native watch
 * apps port `apiCompatibility`, which `tests/fixtures/display-vectors.json` pins.
 */

/**
 * This contract's `info.version`, which is always the release version (`tests/unit/version.test.ts`).
 * A literal rather than package.json's, so a client that vendors this module, such as the companion
 * app, never bundles familyfi's package.json; `tests/unit/api-compat.test.ts` fails when it drifts.
 */
export const API_VERSION: string = "0.41.0";
/** The oldest client API version this server still serves (`info.x-oldest-client`). */
export const OLDEST_CLIENT_API_VERSION = "0.36.0";
/** The oldest server API version a client built from this contract can read (`info.x-oldest-server`). */
export const OLDEST_SERVER_API_VERSION = "0.36.0";

/** The versions `GET /api/v1/health` reports. A server from before API 0.41.0 sends only `version`. */
export type HealthVersions = { version?: string; apiVersion?: string; minAppApiVersion?: string };

/** `update_app`: the server no longer serves this client. `update_server`: the server is older than this client can read. */
export type ApiMismatch = "update_app" | "update_server";

export type ApiCompatibility =
  | { status: "ok" }
  | { status: ApiMismatch; appApiVersion: string; serverApiVersion: string };

export function apiCompatibility(
  health: HealthVersions,
  client: { apiVersion: string; oldestServer: string } = { apiVersion: API_VERSION, oldestServer: OLDEST_SERVER_API_VERSION },
): ApiCompatibility {
  // Before 0.41.0 the release version and the API version were the same number.
  const serverApiVersion = health.apiVersion ?? health.version;
  const server = serverApiVersion ? parseSemver(serverApiVersion) : null;
  const app = parseSemver(client.apiVersion);
  // A version that can't be read decides nothing: the household load reports whatever goes wrong.
  if (!server || !app) return { status: "ok" };
  const mismatch = { appApiVersion: app.version, serverApiVersion: server.version };
  const oldestClient = health.minAppApiVersion ? parseSemver(health.minAppApiVersion) : null;
  if (oldestClient && compareSemver(app, oldestClient) < 0) return { status: "update_app", ...mismatch };
  const oldestServer = parseSemver(client.oldestServer);
  if (oldestServer && compareSemver(server, oldestServer) < 0) return { status: "update_server", ...mismatch };
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
