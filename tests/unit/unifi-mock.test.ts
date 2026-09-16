import { afterEach, describe, expect, it } from "vitest";
import type { Household } from "@prisma/client";
import { unifiMockEnabled, unifiMockRequested, loadEnv } from "@/server/env";
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

function setMockFlag(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.FAMILYFI_UNIFI_MOCK;
  else env.FAMILYFI_UNIFI_MOCK = value;
}

describe("FAMILYFI_UNIFI_MOCK", () => {
  const previousMock = process.env.FAMILYFI_UNIFI_MOCK;

  afterEach(() => {
    setMockFlag(previousMock);
    resetDevMockClientForTests();
  });

  it("is opt-in and ignored in production", () => {
    expect(unifiMockEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(unifiMockEnabled({ NODE_ENV: "development", FAMILYFI_UNIFI_MOCK: "1" })).toBe(true);
    expect(unifiMockEnabled({ NODE_ENV: "test", FAMILYFI_UNIFI_MOCK: "true" })).toBe(true);
    expect(unifiMockRequested({ NODE_ENV: "production", FAMILYFI_UNIFI_MOCK: "1" })).toBe(true);
    expect(unifiMockEnabled({ NODE_ENV: "production", FAMILYFI_UNIFI_MOCK: "1" })).toBe(false);
    expect(unifiMockEnabled({ NODE_ENV: "production", CI: "1", FAMILYFI_UNIFI_MOCK: "1" })).toBe(true);
    expect(loadEnv({ ...validEnv, NODE_ENV: "production", FAMILYFI_UNIFI_MOCK: "1" }).FAMILYFI_UNIFI_MOCK).toBe(false);
    expect(loadEnv({ ...validEnv, NODE_ENV: "test", FAMILYFI_UNIFI_MOCK: "1" }).FAMILYFI_UNIFI_MOCK).toBe(true);
  });

  it("returns a shared MockUnifiClient for probe and household clients", async () => {
    setMockFlag("1");
    const probed = probeClient({
      apiKey: "mock-unifi-key",
      baseUrl: "https://127.0.0.1/proxy/network/integration",
    });
    const household = clientForHousehold(stubHousehold());
    expect(probed).toBeInstanceOf(MockUnifiClient);
    expect(household).toBeInstanceOf(MockUnifiClient);
    expect(probed).toBe(household);
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

  it("uses HttpUnifiClient when the flag is off", () => {
    setMockFlag("0");
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
