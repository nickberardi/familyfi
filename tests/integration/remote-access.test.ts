import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as tunnelState, PUT as setTunnel } from "@/app/api/v1/connection/tunnel/route";
import { prisma } from "@/server/db";
import { resumeRemoteAccess } from "@/server/tunnel/remote-access";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const FAKE = path.join(process.cwd(), "tests/fixtures/cloudflared/cloudflared");

type Tunnel = { mode: string; status: string; url: string | null; error: string | null; hostname: string | null; loginUrl: string | null; endpointId: string | null };

describe("remote access", () => {
  let dir: string;
  let log: string;
  let auth: SessionAuth;
  const saved = process.env.CLOUDFLARED_BIN;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "familyfi-fake-cf-"));
    log = path.join(dir, "calls.log");
    // FamilyFi gives cloudflared a minimal environment, so the log path is baked into a wrapper.
    const wrapper = path.join(dir, "cloudflared");
    writeFileSync(wrapper, `#!/bin/sh\nFAKE_CLOUDFLARED_LOG='${log}' exec '${FAKE}' "$@"\n`);
    chmodSync(wrapper, 0o755);
    process.env.CLOUDFLARED_BIN = wrapper;
  });

  afterAll(() => {
    process.env.CLOUDFLARED_BIN = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await resetDatabase();
    rmSync(log, { force: true });
    const response = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }) }));
    auth = authFromLogin(response);
  });

  afterEach(async () => {
    await put({ mode: "off" });
  });

  async function put(body: unknown) {
    return setTunnel(request("/api/v1/connection/tunnel", { method: "PUT", auth, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  }

  async function state(): Promise<Tunnel> {
    return ((await (await tunnelState(request("/api/v1/connection/tunnel", { auth }))).json()) as { tunnel: Tunnel }).tunnel;
  }

  /** The routes phones are handed: every enabled one, which must be the published one or none. */
  async function publishedIds(): Promise<string[]> {
    return (await prisma().connectionEndpoint.findMany({ where: { enabled: true }, select: { id: true } })).map((route) => route.id);
  }

  /** A route the household runs. Enabled by default, like a leftover the next switch must turn off. */
  async function ownRoute(url: string, transport: "lan" | "tailscale" | "cloudflare" = "lan", enabled = true) {
    return prisma().connectionEndpoint.create({ data: { url, transport, trustMode: "system", enabled } });
  }

  /** The pid of the tunnel process the stand-in cloudflared most recently started. */
  function lastTunnelPid(): number {
    const pids = readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("pid: "));
    return Number(pids.at(-1)!.slice(5));
  }

  function cloudflaredRuns(): string {
    return (existsSync(log) ? readFileSync(log, "utf8") : "").split("\n").filter((line) => line.startsWith("argv: tunnel")).join("\n");
  }

  async function waitFor(check: (tunnel: Tunnel) => boolean, label: string, tries = 80): Promise<Tunnel> {
    for (let i = 0; i < tries; i++) {
      const current = await state();
      if (check(current)) return current;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${label}: ${JSON.stringify(await state())}`);
  }

  it("signs in once, keeps only the tunnel key, and runs on the permanent address", async () => {
    const started = await put({ mode: "named", hostname: "FamilyFi.Example.com" });
    expect(started.status).toBe(200);

    const signingIn = await waitFor((t) => t.loginUrl !== null, "the Cloudflare link");
    expect(signingIn.status).toBe("signing-in");
    expect(signingIn.loginUrl).toMatch(/^https:\/\/dash\.cloudflare\.com\/argotunnel/);

    // Between the sign-in and the tunnel running, setup is never reported as off.
    const seen = new Set<string>();
    const running = await waitFor((t) => {
      seen.add(t.status);
      return t.status === "running";
    }, "the tunnel");
    expect(seen.has("off")).toBe(false);
    expect(running).toMatchObject({ mode: "named", hostname: "familyfi.example.com", url: "https://familyfi.example.com", loginUrl: null });

    // The domain route holds its own tunnel key, encrypted, and is the one route published.
    const route = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: running.endpointId! } });
    expect(route).toMatchObject({ url: "https://familyfi.example.com", kind: "domain", transport: "cloudflare", trustMode: "system", enabled: true });
    expect(Buffer.from(route.tunnelCredentialCiphertext!).toString("utf8")).not.toContain("TunnelSecret");
    expect(await publishedIds()).toEqual([route.id]);

    const calls = readFileSync(log, "utf8");
    // DNS is routed without --overwrite-dns: an existing record is never replaced.
    expect(calls).toMatch(/argv: tunnel --origincert \S+ route dns 11111111-2222-3333-4444-555555555555 familyfi\.example\.com/);
    expect(calls).not.toContain("overwrite-dns");
    // The running tunnel gets its key through the environment and nothing else of ours.
    expect(calls).toContain('"TunnelID":"11111111-2222-3333-4444-555555555555"');
    expect(calls).toContain("leaked-key: none");
    // The account-wide login certificate did not outlive setup.
    const setupHome = calls.split("\n").find((line) => line.startsWith("home:") && line.includes("setup"))!.slice(6);
    expect(existsSync(path.join(setupHome, ".cloudflared", "cert.pem"))).toBe(false);
  });

  it("runs an existing domain again without another sign-in, and forgets it on request", async () => {
    await put({ mode: "named", hostname: "familyfi.example.com" });
    await waitFor((t) => t.status === "running", "the tunnel");
    await put({ mode: "off" });
    rmSync(log, { force: true });

    await put({ mode: "named" });
    await waitFor((t) => t.status === "running", "the tunnel again");
    expect(readFileSync(log, "utf8")).not.toContain("tunnel login");

    await put({ mode: "off", forget: true });
    // Forgetting deletes the domain route, and its tunnel key with it.
    expect(await prisma().connectionEndpoint.count({ where: { kind: "domain" } })).toBe(0);
    expect(await prisma().household.findUniqueOrThrow({ where: { id: "default" } })).toMatchObject({ remoteEndpointId: null });
    expect(await state()).toMatchObject({ mode: "off", status: "off", hostname: null, endpointId: null });
  });

  it("refuses to take over a hostname that already has a DNS record", async () => {
    await put({ mode: "named", hostname: "taken.example.com" });
    const failed = await waitFor((t) => t.status === "error", "the DNS refusal");
    expect(failed.error).toContain("already has a DNS record");
    expect(failed.mode).toBe("off");
    expect(await prisma().connectionEndpoint.count({ where: { kind: "domain" } })).toBe(0);
    // The tunnel it had just created is deleted again rather than left behind.
    expect(readFileSync(log, "utf8")).toMatch(/argv: tunnel --origincert \S+ delete 11111111-2222-3333-4444-555555555555/);
  });

  it("never runs a second tunnel while another FamilyFi process holds the lease", async () => {
    await prisma().reconciliationLock.create({ data: { id: "tunnel", owner: "some-other-process", expiresAt: new Date(Date.now() + 60_000) } });
    await put({ mode: "quick" });
    const refused = await waitFor((t) => t.status === "error", "the refusal");
    expect(refused.error).toContain("Another FamilyFi process");
    expect(existsSync(log) ? readFileSync(log, "utf8") : "").not.toMatch(/argv: tunnel .*--url/);

    // Once the lease is released (or expires), this process may run the tunnel.
    await prisma().reconciliationLock.update({ where: { id: "tunnel" }, data: { expiresAt: new Date(0) } });
    await put({ mode: "quick" });
    await waitFor((t) => t.status === "running", "the tunnel after the lease freed up");
  });

  it("rejects hostnames that are not on a household domain", async () => {
    for (const hostname of ["localhost", "x.trycloudflare.com", "bad host.example.com", "https://familyfi.example.com"]) {
      expect((await put({ mode: "named", hostname })).status).toBe(400);
    }
    expect((await put({ mode: "named" })).status).toBe(400);
  });
  it("publishes exactly one route for each choice and turns the rest off", async () => {
    const home = await ownRoute("https://192.168.1.10:8443");
    const tailnet = await ownRoute("https://familyfi.tail1234.ts.net", "tailscale");
    await ownRoute("https://leftover.home");

    // A route the household runs is published straight away, with no tunnel behind it.
    const own = await put({ mode: "named", endpointId: home.id });
    expect(own.status).toBe(200);
    expect(await state()).toMatchObject({ mode: "named", status: "running", url: "https://192.168.1.10:8443", endpointId: home.id, error: null });
    expect(await publishedIds()).toEqual([home.id]);
    expect(cloudflaredRuns()).toBe("");

    // A quick tunnel's route waits for the tunnel, then is the only one on.
    await put({ mode: "quick" });
    expect(await publishedIds()).toEqual([]);
    const quick = await waitFor((t) => t.status === "running", "the quick tunnel");
    expect(quick).toMatchObject({ mode: "quick", url: "https://fake-quick-tunnel-demo.trycloudflare.com" });
    const quickRoute = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: quick.endpointId! } });
    expect(quickRoute).toMatchObject({ kind: "quick", transport: "cloudflare", url: quick.url });
    expect(await publishedIds()).toEqual([quickRoute.id]);

    // Switching to another route of the household's stops the tunnel; its route stays for next time.
    await put({ mode: "named", endpointId: tailnet.id });
    expect(await state()).toMatchObject({ mode: "named", status: "running", endpointId: tailnet.id });
    expect(await publishedIds()).toEqual([tailnet.id]);
    expect(await prisma().connectionEndpoint.count({ where: { kind: "quick" } })).toBe(1);

    // A second quick tunnel reuses the same route, so phones that paired through it follow.
    await put({ mode: "quick" });
    expect((await waitFor((t) => t.status === "running", "the quick tunnel again")).endpointId).toBe(quickRoute.id);

    await put({ mode: "off" });
    expect(await state()).toMatchObject({ mode: "off", status: "off", endpointId: null });
    expect(await publishedIds()).toEqual([]);
  });

  it("publishes only a route the household runs, never one FamilyFi's tunnel owns", async () => {
    await put({ mode: "quick" });
    const quick = await waitFor((t) => t.status === "running", "the quick tunnel");
    const home = await ownRoute("https://192.168.1.10:8443", "lan", false);

    expect((await put({ mode: "named", endpointId: quick.endpointId })).status).toBe(400);
    expect((await put({ mode: "named", endpointId: "no-such-route" })).status).toBe(400);
    expect((await put({ mode: "named", endpointId: home.id, hostname: "familyfi.example.com" })).status).toBe(400);
    expect((await put({ mode: "named", hostname: "localhost" })).status).toBe(400);
    // None of the refusals touched what was published, or stopped the tunnel behind it.
    expect(await publishedIds()).toEqual([quick.endpointId]);
    expect(await state()).toMatchObject({ mode: "quick", status: "running", url: quick.url });
  });

  it("switches from a route the household runs back to its domain without signing in again", async () => {
    await put({ mode: "named", hostname: "familyfi.example.com" });
    const domain = await waitFor((t) => t.status === "running", "the domain tunnel");
    const home = await ownRoute("https://192.168.1.10:8443");

    await put({ mode: "named", endpointId: home.id });
    // The domain stays set up while the household's own route is published.
    expect(await state()).toMatchObject({ endpointId: home.id, hostname: "familyfi.example.com" });
    const kept = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: domain.endpointId! } });
    expect(kept).toMatchObject({ kind: "domain", enabled: false });
    expect(kept.tunnelCredentialCiphertext).not.toBeNull();

    rmSync(log, { force: true });
    await put({ mode: "named" });
    expect(await waitFor((t) => t.status === "running", "the domain tunnel again")).toMatchObject({ endpointId: domain.endpointId, url: "https://familyfi.example.com" });
    expect(readFileSync(log, "utf8")).not.toContain("tunnel login");
    expect(await publishedIds()).toEqual([domain.endpointId]);
  });

  it("resumes at boot by the published route's kind", async () => {
    const home = await ownRoute("https://192.168.1.10:8443");
    await put({ mode: "named", endpointId: home.id });
    rmSync(log, { force: true });
    await resumeRemoteAccess();
    expect(cloudflaredRuns()).toBe("");

    await put({ mode: "quick" });
    const quick = await waitFor((t) => t.status === "running", "the quick tunnel");
    await put({ mode: "off" });
    // As if FamilyFi restarted with the quick tunnel's route still published.
    await prisma().household.update({ where: { id: "default" }, data: { remoteEndpointId: quick.endpointId } });
    await resumeRemoteAccess();
    expect(await waitFor((t) => t.status === "running", "the resumed quick tunnel")).toMatchObject({ mode: "quick", endpointId: quick.endpointId });
  });
  it("restarts a tunnel that stops while it is still wanted", async () => {
    await put({ mode: "quick" });
    const first = await waitFor((t) => t.status === "running", "the quick tunnel");
    const pid = lastTunnelPid();
    process.kill(pid);

    const stopped = await waitFor((t) => t.status === "error", "the stopped tunnel");
    expect(stopped.error).toContain("stopped");
    // The route stays published: phones keep its address while the tunnel comes back.
    expect(stopped.endpointId).toBe(first.endpointId);
    const back = await waitFor((t) => t.status === "running", "the restarted tunnel", 150);
    expect(lastTunnelPid()).not.toBe(pid);
    expect(back).toMatchObject({ mode: "quick", endpointId: first.endpointId });
  });

  it("stops its tunnel when another FamilyFi process takes the lease", async () => {
    await put({ mode: "quick" });
    await waitFor((t) => t.status === "running", "the quick tunnel");
    await prisma().reconciliationLock.update({ where: { id: "tunnel" }, data: { owner: "some-other-process", expiresAt: new Date(Date.now() + 60_000) } });

    // The lease is renewed every 20 seconds; the renewal that finds it taken stops this tunnel.
    const lost = await waitFor((t) => t.status === "error", "the lost lease", 260);
    expect(lost.error).toContain("Another FamilyFi process");
    expect(lost.url).toBeNull();
  }, 30_000);

  it("refuses a hostname another route already uses", async () => {
    const taken = await ownRoute("https://familyfi.example.com", "cloudflare", false);
    await put({ mode: "named", hostname: "familyfi.example.com" });
    const failed = await waitFor((t) => t.status === "error", "the refusal");
    expect(failed.error).toBe("Another route already uses https://familyfi.example.com. Remove it first, or choose another hostname.");
    expect(await prisma().connectionEndpoint.count({ where: { kind: "domain" } })).toBe(0);
    expect(await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: taken.id } })).toMatchObject({ kind: "own", url: "https://familyfi.example.com" });
  });
});
