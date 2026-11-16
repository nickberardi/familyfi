import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "@/server/crypto";
import { prisma } from "@/server/db";
import { getUnifiSettings as readUnifiSettings, saveUnifiConnection } from "@/server/unifi-settings";
import { DEV_MOCK_BASE_URL, resetDevMockClientForTests } from "@/server/unifi/dev-mock";
import { answered } from "../helpers/answered";
import { resetDatabase } from "../helpers/db";

const API_KEY = "unifi-key-that-must-never-be-stored-in-plaintext";

/** AGENTS.md: FamilyFi encrypts the operator's Integration API key with FAMILYFI_ENCRYPTION_KEY. */
describe("stored UniFi API key", () => {
  const previous = process.env.FAMILYFI_MODE;

  beforeEach(async () => {
    process.env.FAMILYFI_MODE = "dev";
    resetDevMockClientForTests();
    await resetDatabase();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.FAMILYFI_MODE;
    else process.env.FAMILYFI_MODE = previous;
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

    const settings = await answered("GET /api/v1/settings/unifi", async () => ({ unifi: await readUnifiSettings() }));
    expect(settings.status).toBe(200);
    expect(await settings.text()).not.toContain(API_KEY);
  });
});
