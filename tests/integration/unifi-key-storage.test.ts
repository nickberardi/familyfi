import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as getUnifiSettings } from "@/app/api/v1/settings/unifi/route";
import { decryptSecret } from "@/server/crypto";
import { prisma } from "@/server/db";
import { saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_BASE_URL, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { authFromLogin, request } from "../helpers/http";
import { resetDatabase } from "../helpers/db";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const API_KEY = "unifi-key-that-must-never-be-stored-in-plaintext";

/** AGENTS.md: FamilyFi encrypts the operator's Integration API key with FAMILYFI_ENCRYPTION_KEY. */
describe("stored UniFi API key", () => {
  const previous = process.env.UNIFI_MOCK;

  beforeEach(async () => {
    process.env.UNIFI_MOCK = "1";
    resetDevMockClientForTests();
    await resetDatabase();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.UNIFI_MOCK;
    else process.env.UNIFI_MOCK = previous;
    resetDevMockClientForTests();
  });

  it("is stored only encrypted, and never returned by the API", async () => {
    await saveUnifiConnection({ apiKey: API_KEY, baseUrl: DEV_MOCK_BASE_URL });
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });

    // Nowhere in the row, whether read as text or as the bytes of any column.
    const everything = Object.values(household)
      .map((value) => (Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value).toString("latin1") : JSON.stringify(value)))
      .join("\n");
    expect(everything).not.toContain(API_KEY);
    expect(household.unifiKeyLastFour).toBe(API_KEY.slice(-4));
    expect(
      decryptSecret({
        ciphertext: Buffer.from(household.unifiKeyCiphertext!),
        iv: Buffer.from(household.unifiKeyIv!),
        authTag: Buffer.from(household.unifiKeyAuthTag!),
      }),
    ).toBe(API_KEY);

    const signedIn = authFromLogin(
      await login(
        request("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
        }),
      ),
    );
    const settings = await getUnifiSettings(request("/api/v1/settings/unifi", { auth: signedIn }));
    expect(settings.status).toBe(200);
    expect(await settings.text()).not.toContain(API_KEY);
  });
});
