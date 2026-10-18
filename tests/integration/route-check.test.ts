import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as checkEndpoint } from "@/app/api/v1/connection/endpoints/[id]/check/route";
import { PUT as updateEndpoint } from "@/app/api/v1/connection/endpoints/[id]/route";
import { GET as tunnelState, PUT as setTunnel } from "@/app/api/v1/connection/tunnel/route";
import { ensureConnectionIdentity } from "@/server/connection";
import { prisma } from "@/server/db";
import { encryptSecret } from "@/server/crypto";
import { pinFromCertificate } from "@/server/spki";
import { publishCheckForTests } from "@/server/tunnel/remote-access";
import { reachRoute } from "@/server/tunnel/route-check";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

/** A stand-in for whatever a route the household runs points at: it answers the identity call as told. */
type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

describe("checking a route the household runs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "familyfi-route-check-"));
  let cert: string;
  let pin: string;
  let other: string;
  let server: Server;
  let origin: string;
  let answer: (headers: Record<string, string | string[] | undefined>) => Promise<Answer>;
  let auth: SessionAuth;
  let seen: Record<string, string | string[] | undefined>[];

  beforeAll(async () => {
    // Keys are minted per run so no private key is ever committed.
    for (const name of ["route", "other"]) {
      execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", path.join(dir, `${name}.key`), "-out", path.join(dir, `${name}.pem`)], { stdio: "ignore" });
    }
    cert = readFileSync(path.join(dir, "route.pem"), "utf8");
    pin = pinFromCertificate(cert).spkiSha256;
    other = pinFromCertificate(readFileSync(path.join(dir, "other.pem"), "utf8")).spkiSha256;
    server = createServer({ cert, key: readFileSync(path.join(dir, "route.key"), "utf8") }, (req, res) => {
      seen.push(req.headers);
      void answer(req.headers).then(({ status, body, headers }) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDatabase();
    seen = [];
    const { instanceId } = await ensureConnectionIdentity();
    answer = async () => ({ status: 200, body: { protocolVersion: 1, instanceId } });
    const response = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) }));
    auth = authFromLogin(response);
  });

  const pinned = (spkiSha256 = pin) => ({ url: origin, trustMode: "pinned" as const, spkiSha256, edgeAuth: "none" as const, edgeTokenCiphertext: null, edgeTokenIv: null, edgeTokenAuthTag: null, edgeTokenVersion: 0, edgeTokenRotatedAt: null });

  async function check(id: string) {
    return checkEndpoint(request(`/api/v1/connection/endpoints/${id}/check`, { method: "POST", auth }), { params: Promise.resolve({ id }) });
  }

  async function state() {
    return ((await (await tunnelState(request("/api/v1/connection/tunnel", { auth }))).json()) as { tunnel: { status: string; reachability: unknown } }).tunnel;
  }

  it("counts a route reached only when it answers as this household", async () => {
    expect(await reachRoute(pinned())).toEqual({ ok: true, message: null });

    answer = async () => ({ status: 200, body: { protocolVersion: 1, instanceId: "someone-else" } });
    expect(await reachRoute(pinned())).toEqual({ ok: false, message: `${new URL(origin).host} answered as a different FamilyFi.` });

    // A proxy's sign-in page, or anything else that is not FamilyFi.
    answer = async () => ({ status: 200, body: "<html>Sign in</html>", headers: { "content-type": "text/html" } });
    expect((await reachRoute(pinned())).message).toMatch(/something other than FamilyFi/);

    answer = async () => ({ status: 302, headers: { location: "https://example.cloudflareaccess.com/" } });
    expect((await reachRoute(pinned())).message).toMatch(/HTTP 302, a redirect phones can't follow/);

    answer = async () => ({ status: 502 });
    expect((await reachRoute(pinned())).message).toMatch(/HTTP 502\.$/);
  });

  it("trusts the route the way phones do: its pinned key, or the system's certificate check", async () => {
    expect(await reachRoute(pinned(other))).toEqual({ ok: false, message: `${new URL(origin).host} serves a certificate that doesn't match the pinned one.` });
    const system = { ...pinned(), trustMode: "system" as const, spkiSha256: null };
    expect((await reachRoute(system)).message).toMatch(/serves a certificate phones won't trust/);
    expect(await reachRoute(system, { ca: cert })).toEqual({ ok: true, message: null });
  });

  it("explains a route nothing answers at", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    expect((await reachRoute({ ...pinned(), url: `https://127.0.0.1:${port}` })).message).toBe(`Nothing at 127.0.0.1:${port} accepted the connection.`);

    answer = () => new Promise(() => undefined);
    expect(await reachRoute(pinned(), { timeoutMs: 200 })).toEqual({ ok: false, message: `No answer from ${new URL(origin).host} within 0.2 seconds.` });
    expect((await reachRoute({ ...pinned(), url: "https://familyfi.invalid" })).message).toBe("FamilyFi could not resolve familyfi.invalid.");
    expect(await reachRoute({ ...pinned(), url: "http://familyfi.invalid" })).toEqual({ ok: false, message: "This route's address is not an HTTPS origin." });
  });

  it("sends a route's Cloudflare Access token to that route alone", async () => {
    const sealed = encryptSecret(JSON.stringify({ clientId: "client.access", clientSecret: "secret-value" }));
    const guarded = { ...pinned(), edgeAuth: "serviceToken" as const, edgeTokenCiphertext: new Uint8Array(sealed.ciphertext), edgeTokenIv: new Uint8Array(sealed.iv), edgeTokenAuthTag: new Uint8Array(sealed.authTag), edgeTokenVersion: 1 };
    expect((await reachRoute(guarded)).ok).toBe(true);
    expect(seen.at(-1)).toMatchObject({ "cf-access-client-id": "client.access", "cf-access-client-secret": "secret-value" });
    await reachRoute(pinned());
    expect(seen.at(-1)).not.toHaveProperty("cf-access-client-id");
  });

  it("checks a published route on publish and on request, and shows what it found until the route changes", async () => {
    const route = await prisma().connectionEndpoint.create({ data: { url: origin, transport: "lan", trustMode: "pinned", spkiSha256: pin, enabled: false } });
    expect((await setTunnel(request("/api/v1/connection/tunnel", { method: "PUT", auth, headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "named", endpointId: route.id }) }))).status).toBe(200);
    await publishCheckForTests();
    const published = await state();
    expect(published.status).toBe("running");
    expect(published.reachability).toMatchObject({ reachedAt: null, result: "reached", message: null, checkedAt: expect.any(String) });

    answer = async () => ({ status: 503 });
    const response = await check(route.id);
    expect(response.status).toBe(200);
    const { reachability } = (await response.json()) as { reachability: { result: string; message: string } };
    expect(reachability).toMatchObject({ result: "failed", message: `${new URL(origin).host} answered with HTTP 503.` });
    expect((await state()).reachability).toEqual(reachability);

    // Changing the route clears what was known about the old one.
    const changed = await updateEndpoint(
      request(`/api/v1/connection/endpoints/${route.id}`, { method: "PUT", auth, headers: { "content-type": "application/json" }, body: JSON.stringify({ priority: 3 }) }),
      { params: Promise.resolve({ id: route.id }) },
    );
    expect(changed.status).toBe(200);
    expect((await state()).reachability).toEqual({ reachedAt: null, checkedAt: null, result: null, message: null });
  });

  it("refuses FamilyFi's own tunnel routes and routes that don't exist", async () => {
    const quick = await prisma().connectionEndpoint.create({ data: { url: "https://quick.trycloudflare.com", kind: "quick", transport: "cloudflare", trustMode: "system" } });
    const managed = await check(quick.id);
    expect(managed.status).toBe(409);
    expect(((await managed.json()) as { error: { code: string } }).error.code).toBe("managed_route");
    expect((await check("no-such-route")).status).toBe(404);
  });
});
