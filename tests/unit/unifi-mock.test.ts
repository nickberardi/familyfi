import { afterEach, describe, expect, it } from "vitest";
import type { Household } from "@prisma/client";
import { loadEnv, unifiMockEnabled } from "@/server/env";
import { MockUnifiClient } from "@/server/unifi/mock";
import { clientForHousehold, probeClient } from "@/server/unifi/connection";
import { HttpUnifiClient } from "@/server/unifi/client";
import { resetDevMockClientForTests, getSharedDevMockClient } from "@/server/unifi/dev-mock";
import { unifiMockBanner } from "@/server/startup-banner";

const validEnv = {
  FAMILYFI_DEFAULT_PASSWORD: "recovery-pass",
  FAMILYFI_SESSION_SECRET: "abcdefghijklmnopqrstuvwxyz012345",
  FAMILYFI_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  POSTGRES_PASSWORD: "db-pass",
};

function stubHousehold(): Household {
  return {
    unifiKeyCiphertext: Buffer.from("cipher"),
    unifiKeyIv: Buffer.from("iv"),
    unifiKeyAuthTag: Buffer.from("tag"),
    unifiBaseUrl: "https://127.0.0.1/proxy/network/integration",
    unifiTlsInsecure: true,
  } as unknown as Household;
}

function setMode(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.FAMILYFI_MODE;
  else env.FAMILYFI_MODE = value;
}

describe("UniFi mock", () => {
  const previousMode = process.env.FAMILYFI_MODE;

  afterEach(() => {
    setMode(previousMode);
    resetDevMockClientForTests();
  });

  it("is opt-in, and the retired UNIFI_MOCK turns nothing on", () => {
    expect(unifiMockEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(unifiMockEnabled({ NODE_ENV: "development", FAMILYFI_MODE: "dev" })).toBe(true);
    expect(unifiMockEnabled({ NODE_ENV: "development", UNIFI_MOCK: "1" })).toBe(false);
    expect(unifiMockEnabled({ NODE_ENV: "production", UNIFI_MOCK: "1" })).toBe(false);
    expect(unifiMockEnabled({ NODE_ENV: "production", CI: "1", FAMILYFI_MODE: "test" })).toBe(true);
    expect(loadEnv({ ...validEnv, NODE_ENV: "development", UNIFI_MOCK: "1" }).FAMILYFI_MODE).toBe("prod");
    expect(loadEnv({ ...validEnv, NODE_ENV: "test", FAMILYFI_MODE: "test" }).FAMILYFI_MODE).toBe("test");
  });

  it("returns a shared MockUnifiClient for probe and household clients", async () => {
    setMode("dev");
    const probed = probeClient({
      apiKey: "mock-unifi-key",
      baseUrl: "https://127.0.0.1/proxy/network/integration",
    });
    const household = clientForHousehold(stubHousehold());
    expect(probed).toBeInstanceOf(MockUnifiClient);
    expect(household).toBeInstanceOf(MockUnifiClient);
    // The household client is that same shared mock behind the policy ownership guard.
    expect(probed).toBe(getSharedDevMockClient());
    expect(household).not.toBe(probed);
    const created = await probed.createPolicy("11111111-1111-4111-8111-111111111111", {
      name: "FamilyFi Test",
      enabled: true,
      loggingEnabled: false,
      action: { type: "BLOCK" },
      ipProtocolScope: { ipVersion: "IPV4_AND_IPV6" },
      source: { zoneId: "33333333-3333-4333-8333-333333333333" },
      destination: { zoneId: "33333333-3333-4333-8333-333333333335" },
    });
    const again = clientForHousehold(stubHousehold());
    const policies = await again.listPolicies("11111111-1111-4111-8111-111111111111");
    expect(policies.some((policy) => policy.id === created.id)).toBe(true);
    expect(getSharedDevMockClient().state.clients.some((client) => client.name === "Kids iPad")).toBe(true);
  });

  it("uses HttpUnifiClient in prod", () => {
    setMode("prod");
    const client = probeClient({
      apiKey: "live-key-value",
      baseUrl: "https://127.0.0.1/proxy/network/integration",
    });
    expect(client).toBeInstanceOf(HttpUnifiClient);
  });

  it("documents the dummy key in the startup banner", () => {
    expect(unifiMockBanner()).toContain("UniFi mock enabled");
    expect(unifiMockBanner()).toContain("mock-unifi-key");
    expect(unifiMockBanner()).toContain("pat");
  });
});
