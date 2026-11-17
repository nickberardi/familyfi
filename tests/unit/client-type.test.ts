import { describe, expect, it } from "vitest";
import { apiCompatibility } from "@/lib/api-compat";
import { CLIENT_SCOPES, CLIENT_TYPES, clientTypeFrom, legacyClient, mayHoldScope, scopeFor, scopeWord } from "@/lib/client-type";
import { parsePairingCode } from "@/lib/pairing-code";

describe("client types and scopes", () => {
  it("gives each client type its own scopes, stored with their group", () => {
    expect(CLIENT_SCOPES).toEqual({
      app: ["app:full"],
      "app-watch": ["app:rulesOnly"],
      "app-controls": ["app:rulesOnly"],
      me: ["me:askOnly"],
      agent: ["agent:full", "agent:readOnly"],
    });
    expect(mayHoldScope("app-watch", "app:rulesOnly")).toBe(true);
    expect(mayHoldScope("app-watch", "rulesOnly")).toBe(false);
    expect(mayHoldScope("watch", "app:rulesOnly")).toBe(false);
    expect(mayHoldScope("agent", null)).toBe(false);
  });

  it("answers installed apps with the older client and scope words", () => {
    expect(CLIENT_TYPES.map(legacyClient)).toEqual(["app", "watch", "app", "me", "agent"]);
    expect(["app:full", "app:rulesOnly", "agent:readOnly", "me:askOnly"].map(scopeWord)).toEqual(["full", "rulesOnly", "readOnly", "askOnly"]);
    expect(scopeFor("agent", "readOnly")).toBe("agent:readOnly");
    expect(scopeFor("agent", "rulesOnly")).toBeNull();
  });

  it("reads an older request's client and scope as a client type", () => {
    expect(clientTypeFrom("app")).toBe("app");
    expect(clientTypeFrom("phone")).toBe("app");
    expect(clientTypeFrom("app", "rulesOnly")).toBe("app-controls");
    expect(clientTypeFrom("watch", "rulesOnly")).toBe("app-watch");
    expect(clientTypeFrom("agent", "full")).toBe("agent");
    expect(clientTypeFrom("browser")).toBeNull();
  });

  it("reads a pairing code's client type, and a code without one from an older server", () => {
    const encode = (payload: object) => Buffer.from(JSON.stringify(payload)).toString("base64url");
    const base = { version: 1, url: "https://familyfi.local", code: "invite.token", fingerprint: "f".repeat(43) };
    expect(parsePairingCode(encode({ ...base, clientType: "me" })).clientType).toBe("me");
    expect(parsePairingCode(encode(base)).clientType).toBeNull();
  });

  it("checks a client against the floor the server named for its type, else the app's or the watches'", () => {
    const client = { apiVersion: "1.6.0", minServerApi: "0.36.0" };
    expect(apiCompatibility({ apiVersion: "1.7.0", minAppApiVersion: "1.0.0", minApiVersion: "1.7.0" }, client).status).toBe("update_app");
    expect(apiCompatibility({ apiVersion: "1.7.0", minAppApiVersion: "1.7.0", minApiVersion: "1.0.0" }, client).status).toBe("ok");
    expect(apiCompatibility({ apiVersion: "1.7.0", minAppApiVersion: "1.7.0" }, client).status).toBe("update_app");
  });
});
