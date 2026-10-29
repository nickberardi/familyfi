/**
 * Whether an app and a server can read each other (`src/lib/api-compat.ts`): each row of the
 * table in docs/api.md, "Versioning the contract", a server from before `apiVersion`, and the
 * constants against the floors `openapi/familyfi.v1.yaml` declares.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  API_VERSION,
  apiCompatibility,
  MIN_APP_API_VERSION,
  MIN_SERVER_API_VERSION,
} from "@/lib/api-compat";

const info = (YAML.parse(readFileSync(path.resolve(__dirname, "../../openapi/familyfi.v1.yaml"), "utf8")) as {
  info: { version: string; "x-min-app-api": string; "x-min-server-api": string };
}).info;

const client = { apiVersion: "0.41.0", minServerApi: "0.36.0" };

describe("API compatibility", () => {
  it("carries the contract's version and floors", () => {
    expect(API_VERSION).toBe(info.version);
    expect(MIN_APP_API_VERSION).toBe(info["x-min-app-api"]);
    expect(MIN_SERVER_API_VERSION).toBe(info["x-min-server-api"]);
  });

  it("asks for an app update when the app is older than the server's oldest client", () => {
    expect(apiCompatibility({ version: "0.45.0", apiVersion: "0.45.0", minAppApiVersion: "0.43.0" }, client)).toEqual({
      status: "update_app",
      appApiVersion: "0.41.0",
      serverApiVersion: "0.45.0",
    });
  });

  it("asks for a server update when the server is older than the app's oldest server", () => {
    expect(apiCompatibility({ version: "0.35.0", apiVersion: "0.35.0", minAppApiVersion: "0.30.0" }, client)).toEqual({
      status: "update_server",
      appApiVersion: "0.41.0",
      serverApiVersion: "0.35.0",
    });
  });

  it("is compatible otherwise, older or newer, at either floor", () => {
    expect(apiCompatibility({ version: "0.41.0", apiVersion: "0.41.0", minAppApiVersion: "0.36.0" }, client).status).toBe("ok");
    expect(apiCompatibility({ version: "0.45.0", apiVersion: "0.45.0", minAppApiVersion: "0.41.0" }, client).status).toBe("ok");
    expect(apiCompatibility({ version: "0.36.0", apiVersion: "0.36.0", minAppApiVersion: "0.36.0" }, client).status).toBe("ok");
  });

  it("reads a server from before apiVersion by its release version", () => {
    // The 26 October server: 0.34, before Checkup's required message.
    expect(apiCompatibility({ version: "0.34.0" }, client)).toMatchObject({ status: "update_server", serverApiVersion: "0.34.0" });
    expect(apiCompatibility({ version: "0.40.0" }, client).status).toBe("ok");
  });

  it("prefers apiVersion over the release version", () => {
    expect(apiCompatibility({ version: "1.0.0", apiVersion: "0.34.0" }, client).status).toBe("update_server");
  });

  it("orders versions by semver, not as text", () => {
    expect(apiCompatibility({ version: "0.9.0" }, { apiVersion: "0.41.0", minServerApi: "0.10.0" }).status).toBe("update_server");
    expect(apiCompatibility({ version: "0.100.0", minAppApiVersion: "0.100.0" }, { apiVersion: "0.99.0", minServerApi: "0.1.0" }).status).toBe(
      "update_app",
    );
  });

  it("decides nothing from a version it can't read", () => {
    expect(apiCompatibility({}, client).status).toBe("ok");
    expect(apiCompatibility({ version: "dev" }, client).status).toBe("ok");
    expect(apiCompatibility({ version: "0.41.0", minAppApiVersion: "soon" }, client).status).toBe("ok");
  });

  it("compares against this build's contract by default", () => {
    expect(apiCompatibility({ version: API_VERSION, apiVersion: API_VERSION, minAppApiVersion: MIN_APP_API_VERSION }).status).toBe("ok");
  });
});
