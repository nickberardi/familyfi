import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "@/lib/base64url";
import {
  EDGE_CREDENTIAL_INVALID,
  IDENTITY_FINGERPRINT_INVALID,
  IDENTITY_MISMATCH,
  MANIFEST_MISSING_ENDPOINT,
  MANIFEST_SIGNATURE_INVALID,
  MANIFEST_WRONG_HOUSEHOLD,
  candidateRoutes,
  edgeHeaders,
  isEdgeUnavailable,
  mergeEdgeCredentials,
  requireEndpoint,
  sha256Base64Url,
  verifyIdentity,
  verifyManifest,
  type EndpointCredential,
} from "@/lib/companion-trust";
import {
  PAIRING_CODE_INCOMPLETE,
  PAIRING_CODE_INVALID,
  PAIRING_CODE_NEWER,
  isServerOrigin,
  parsePairingCode,
  type PairingPayload,
} from "@/lib/pairing-code";
import type { ConnectionRoute } from "@/lib/types";
import { instanceFingerprint } from "@/server/connection";
import { encodePairingCode } from "@/server/pairing-code";

/** A household key made the way the server makes one (`src/server/connection.ts`). */
function household() {
  const keys = generateKeyPairSync("ed25519");
  const publicJwk = keys.publicKey.export({ format: "jwk" }) as { x: string };
  const fingerprint = instanceFingerprint(JSON.stringify(publicJwk));
  return {
    x: publicJwk.x,
    fingerprint,
    identity: { keyFingerprint: fingerprint, publicKey: { kty: "OKP" as const, crv: "Ed25519" as const, x: publicJwk.x } },
    /** Signs a manifest payload as `signedEndpointManifest` does. */
    manifest(body: unknown) {
      const bytes = Buffer.from(JSON.stringify(body));
      return { signedPayload: bytes.toString("base64url"), signature: sign(null, bytes, keys.privateKey).toString("base64url") };
    },
  };
}

const route = (patch: Partial<ConnectionRoute> = {}): ConnectionRoute => ({
  id: "r-lan",
  url: "https://familyfi.home",
  kind: "own",
  transport: "lan",
  trustMode: "pinned",
  spkiSha256: "a".repeat(43),
  priority: 0,
  enabled: true,
  edgeAuth: "none",
  edgeTokenVersion: null,
  ...patch,
});
const edgeRoute = route({ id: "r-edge", url: "https://familyfi.example.com", transport: "cloudflare", trustMode: "system", spkiSha256: null, priority: 1, edgeAuth: "serviceToken", edgeTokenVersion: 2 });
const credential: EndpointCredential = { endpointId: "r-edge", version: 2, clientId: "id.access", clientSecret: "secret" };

describe("base64url", () => {
  it("round-trips bytes the way Node's base64url does, and refuses plain base64", () => {
    for (const length of [0, 1, 2, 3, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      const encoded = base64UrlEncode(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
      expect(base64UrlDecode(encoded)).toEqual(bytes);
      expect(base64UrlDecode(`${encoded}==`.slice(0, encoded.length + ((4 - (encoded.length % 4)) % 4)))).toEqual(bytes);
    }
    expect(base64UrlDecode("ab+/")).toBeNull();
    expect(base64UrlDecode("a")).toBeNull();
  });
});

describe("pairing code", () => {
  const base: PairingPayload = { version: 1, url: "https://familyfi.home", code: "cm1.tok-en_1", fingerprint: "f".repeat(43) };

  it("reads what the server encodes: a pinned LAN route, an Access route, or a system-trusted one", () => {
    const pinned = parsePairingCode(encodePairingCode({ ...base, pin: "p".repeat(43) }));
    expect(pinned).toMatchObject({ pairingId: "cm1", token: "tok-en_1", keyFingerprint: base.fingerprint, edgeCredential: null });
    expect(pinned.endpoint).toMatchObject({ url: "https://familyfi.home", transport: "lan", trustMode: "pinned", spkiSha256: "p".repeat(43) });

    const access = parsePairingCode(encodePairingCode({ ...base, access: { clientId: "id.access", clientSecret: "s+e/c=r?e&t" } }));
    expect(access.edgeCredential).toEqual({ version: 1, clientId: "id.access", clientSecret: "s+e/c=r?e&t" });
    expect(access.endpoint).toMatchObject({ transport: "cloudflare", trustMode: "system", edgeAuth: "serviceToken", edgeTokenVersion: 1 });

    expect(parsePairingCode(encodePairingCode(base)).endpoint).toMatchObject({ transport: "lan", trustMode: "system", spkiSha256: null });
  });

  it("ignores whitespace from a wrapped paste, and accepts padding", () => {
    const code = encodePairingCode(base);
    expect(parsePairingCode(`  ${code.slice(0, 10)}\n${code.slice(10)}==`.replace(/==$/, "=".repeat((4 - (code.length % 4)) % 4))).pairingId).toBe("cm1");
  });

  it("refuses what is not a pairing code, a newer version, and an incomplete one", () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(() => parsePairingCode("not a code!")).toThrow(PAIRING_CODE_INVALID);
    expect(() => parsePairingCode(encode(["a"]))).toThrow(PAIRING_CODE_INVALID);
    expect(() => parsePairingCode(Buffer.from(JSON.stringify(base)).toString("base64"))).not.toThrow(); // no + or / in this payload
    expect(() => parsePairingCode(encode({ ...base, version: 2 }))).toThrow(PAIRING_CODE_NEWER);
    for (const broken of [
      { ...base, code: "no-dot" },
      { ...base, code: ".token" },
      { ...base, code: "id." },
      { ...base, url: "http://familyfi.home" },
      { ...base, url: "https://familyfi.home/path" },
      { ...base, url: "https://user:pass@familyfi.home" },
      { ...base, fingerprint: "" },
      { ...base, pin: "p".repeat(43), access: { clientId: "a", clientSecret: "b" } },
      { ...base, pin: "short" },
      { ...base, access: { clientId: "has space", clientSecret: "b" } },
    ]) {
      expect(() => parsePairingCode(encode(broken)), JSON.stringify(broken)).toThrow(PAIRING_CODE_INCOMPLETE);
    }
  });

  it("names a bare HTTPS origin only", () => {
    expect(isServerOrigin("https://familyfi.home")).toBe(true);
    expect(isServerOrigin("https://familyfi.home:7443/")).toBe(true);
    for (const value of ["http://familyfi.home", "https://familyfi.home/x", "https://familyfi.home?q=1", "https://familyfi.home#x", "familyfi.home"]) {
      expect(isServerOrigin(value), value).toBe(false);
    }
  });
});

describe("household identity", () => {
  it("accepts a fingerprint that hashes the key and matches the code", () => {
    const home = household();
    expect(sha256Base64Url(base64UrlDecode(home.x)!)).toBe(home.fingerprint);
    expect(() => verifyIdentity(home.identity, home.fingerprint)).not.toThrow();
  });

  it("refuses a fingerprint that is not the key's hash, and one the code did not name", () => {
    const home = household();
    expect(() => verifyIdentity({ ...home.identity, keyFingerprint: household().fingerprint }, home.fingerprint)).toThrow(IDENTITY_FINGERPRINT_INVALID);
    expect(() => verifyIdentity(home.identity, household().fingerprint)).toThrow(IDENTITY_MISMATCH);
  });
});

describe("endpoint manifest", () => {
  it("verifies what the household key signed, with its routes and credentials", () => {
    const home = household();
    const signed = home.manifest({ instanceId: "ff_home", endpoints: [route(), edgeRoute], edgeCredentials: [credential] });
    const verified = verifyManifest(signed, home.x, "ff_home");
    expect(verified.endpoints.map((endpoint) => endpoint.id)).toEqual(["r-lan", "r-edge"]);
    expect(verified.edgeCredentials).toEqual([credential]);
    expect(() => requireEndpoint(verified, "https://familyfi.home")).not.toThrow();
    expect(() => requireEndpoint(verified, "https://elsewhere.example")).toThrow(MANIFEST_MISSING_ENDPOINT);
  });

  it("refuses a tampered payload, another key's signature, and another household's manifest", () => {
    const home = household();
    const signed = home.manifest({ instanceId: "ff_home", endpoints: [route()] });
    const tampered = { ...signed, signedPayload: Buffer.from(JSON.stringify({ instanceId: "ff_home", endpoints: [route({ url: "https://evil.example" })] })).toString("base64url") };
    expect(() => verifyManifest(tampered, home.x, "ff_home")).toThrow(MANIFEST_SIGNATURE_INVALID);
    expect(() => verifyManifest(signed, household().x, "ff_home")).toThrow(MANIFEST_SIGNATURE_INVALID);
    expect(() => verifyManifest(signed, home.x, "ff_other")).toThrow(MANIFEST_WRONG_HOUSEHOLD);
  });

  it("refuses a route that is not an HTTPS origin, duplicate ids, and a credential that does not fit its route", () => {
    const home = household();
    const check = (body: unknown) => () => verifyManifest(home.manifest({ instanceId: "ff_home", ...(body as object) }), home.x, "ff_home");
    expect(check({ endpoints: [route({ url: "http://familyfi.home" })] })).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check({ endpoints: [route(), route()] })).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check({ endpoints: [edgeRoute] })).toThrow(EDGE_CREDENTIAL_INVALID); // Access route with no credential
    expect(check({ endpoints: [edgeRoute], edgeCredentials: [{ ...credential, version: 1 }] })).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check({ endpoints: [route()], edgeCredentials: [{ ...credential, endpointId: "r-lan" }] })).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check({ endpoints: [route()], edgeCredentials: [credential] })).toThrow(EDGE_CREDENTIAL_INVALID); // credential for no route
  });

  it("refuses a pinned route without a well-formed pin, an unknown trust mode, and a route with no enabled flag", () => {
    const home = household();
    const check = (endpoint: unknown) => () => verifyManifest(home.manifest({ instanceId: "ff_home", endpoints: [endpoint] }), home.x, "ff_home");
    expect(check(route({ spkiSha256: null }))).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check(route({ spkiSha256: "short" }))).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check({ ...route(), trustMode: "none" })).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check({ ...route(), enabled: undefined })).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(check(route())).not.toThrow();
  });
});

describe("routes and Access credentials", () => {
  it("tries the enabled routes in the manifest's order", () => {
    expect(candidateRoutes([route({ id: "a" }), route({ id: "b", enabled: false }), route({ id: "c" })]).map((endpoint) => endpoint.id)).toEqual(["a", "c"]);
  });

  it("replaces a token only with a higher version, and never lets a version mean two tokens", () => {
    expect(mergeEdgeCredentials([credential], [{ ...credential, version: 3, clientSecret: "new" }])).toEqual([{ ...credential, version: 3, clientSecret: "new" }]);
    expect(mergeEdgeCredentials([credential], [credential])).toEqual([credential]);
    expect(() => mergeEdgeCredentials([credential], [{ ...credential, version: 1 }])).toThrow(EDGE_CREDENTIAL_INVALID);
    expect(() => mergeEdgeCredentials([credential], [{ ...credential, clientSecret: "other" }])).toThrow(EDGE_CREDENTIAL_INVALID);
  });

  it("sends Access headers only to their route, at its current version", () => {
    expect(edgeHeaders(edgeRoute, [credential])).toEqual({ "CF-Access-Client-Id": "id.access", "CF-Access-Client-Secret": "secret" });
    expect(edgeHeaders(edgeRoute, [{ ...credential, version: 1 }])).toEqual({});
    expect(edgeHeaders(route(), [credential])).toEqual({});
  });

  it("reads Cloudflare Access's sign-in redirect and its bare 401 or 403 as the route being unavailable", () => {
    expect(isEdgeUnavailable({ status: 302, location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" })).toBe(true);
    expect(isEdgeUnavailable({ status: 302, location: "https://familyfi.example.com/login" })).toBe(false);
    expect(isEdgeUnavailable({ status: 403, body: "<html>Forbidden</html>" })).toBe(true);
    expect(isEdgeUnavailable({ status: 401, body: { error: { code: "unauthorized", message: "Sign in." } } })).toBe(false);
    expect(isEdgeUnavailable({ status: 500, body: null })).toBe(false);
  });
});
