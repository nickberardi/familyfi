import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as tunnelState, PUT as setTunnel } from "@/app/api/v1/connection/tunnel/route";
import { prisma } from "@/server/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const FAKE = path.join(process.cwd(), "tests/fixtures/cloudflared/cloudflared");

type Tunnel = { mode: string; status: string; url: string | null; error: string | null; hostname: string | null; loginUrl: string | null; endpointId: string | null };

describe("remote access with your own domain", () => {
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

  async function waitFor(check: (tunnel: Tunnel) => boolean, label: string): Promise<Tunnel> {
    for (let i = 0; i < 80; i++) {
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

    const route = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { id: running.endpointId! } });
    expect(route).toMatchObject({ url: "https://familyfi.example.com", transport: "cloudflare", trustMode: "system", enabled: true });

    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(Buffer.from(household.tunnelCredentialCiphertext!).toString("utf8")).not.toContain("TunnelSecret");

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
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household).toMatchObject({ tunnelMode: "off", tunnelHostname: null, tunnelCredentialCiphertext: null });
    expect(await state()).toMatchObject({ status: "off", hostname: null });
  });

  it("refuses to take over a hostname that already has a DNS record", async () => {
    await put({ mode: "named", hostname: "taken.example.com" });
    const failed = await waitFor((t) => t.status === "error", "the DNS refusal");
    expect(failed.error).toContain("already has a DNS record");
    expect(failed.mode).toBe("off");
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.tunnelCredentialCiphertext).toBeNull();
    // The tunnel it had just created is deleted again rather than left behind.
    expect(readFileSync(log, "utf8")).toMatch(/argv: tunnel --origincert \S+ delete 11111111-2222-3333-4444-555555555555/);
  });

  it("rejects hostnames that are not on a household domain", async () => {
    for (const hostname of ["localhost", "x.trycloudflare.com", "bad host.example.com", "https://familyfi.example.com"]) {
      expect((await put({ mode: "named", hostname })).status).toBe(400);
    }
    expect((await put({ mode: "named" })).status).toBe(400);
  });
});
