import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as testConnection } from "@/app/api/v1/settings/unifi/test/route";
import { prisma } from "@/server/db";
import { saveUnifiConnection } from "@/server/unifi-settings";
import {
  DEV_MOCK_API_KEY,
  DEV_MOCK_BASE_URL,
  DEV_MOCK_SITE_ID,
  resetDevMockClientForTests,
} from "@/server/unifi/dev-mock";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";

async function signedIn(): Promise<SessionAuth> {
  const response = await login(
    request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
    }),
  );
  expect(response.status).toBe(200);
  return authFromLogin(response);
}

function probe(auth: SessionAuth | undefined, body: unknown) {
  return testConnection(
    request("/api/v1/settings/unifi/test", {
      method: "POST",
      auth,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/settings/unifi/test", () => {
  const previous = process.env.UNIFI_MOCK;
  let auth: SessionAuth;

  beforeEach(async () => {
    process.env.UNIFI_MOCK = "1";
    resetDevMockClientForTests();
    await resetDatabase();
    auth = await signedIn();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.UNIFI_MOCK;
    else process.env.UNIFI_MOCK = previous;
    resetDevMockClientForTests();
  });

  it("needs a session and the CSRF header", async () => {
    expect((await probe(undefined, { apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL })).status).toBe(401);
    const withoutCsrf = await testConnection(
      request("/api/v1/settings/unifi/test", {
        method: "POST",
        headers: { cookie: auth.cookie, "content-type": "application/json" },
        body: JSON.stringify({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL }),
      }),
    );
    expect(withoutCsrf.status).toBe(403);
  });

  it("probes a new key and target without saving either", async () => {
    const response = await probe(auth, { apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; site: { id: string }; networks: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.site.id).toBe(DEV_MOCK_SITE_ID);
    expect(body.networks.length).toBeGreaterThan(0);

    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.unifiKeyLastFour).toBeNull();
    expect(household.unifiKeyCiphertext).toBeNull();
    expect(household.unifiSiteId).toBeNull();
  });

  it("tests the saved connection when no key is sent, and says so when none is saved", async () => {
    const unsaved = await probe(auth, {});
    expect(unsaved.status).toBe(400);
    expect(((await unsaved.json()) as { error: { code: string } }).error.code).toBe("unifi_invalid");

    await saveUnifiConnection({ apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    const saved = await probe(auth, {});
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { site: { id: string } }).site.id).toBe(DEV_MOCK_SITE_ID);
  });

  it("refuses a key without exactly one target", async () => {
    const neither = await probe(auth, { apiKey: DEV_MOCK_API_KEY });
    expect(neither.status).toBe(400);
    expect(((await neither.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
    const both = await probe(auth, { apiKey: DEV_MOCK_API_KEY, baseUrl: DEV_MOCK_BASE_URL, consoleId: "console" });
    expect(both.status).toBe(400);
  });

  it("reports a console it cannot reach as a failed probe, not a server error", async () => {
    delete process.env.UNIFI_MOCK;
    const response = await probe(auth, { apiKey: "not-a-real-key", baseUrl: "https://127.0.0.1:1/proxy/network/integration" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("unifi_invalid");
  });
});
