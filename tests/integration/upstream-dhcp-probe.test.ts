import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getSharedDevMockClient } from "@/server/unifi/dev-mock";
import { refreshResolverContexts } from "@/server/upstream/discovery";
import { probeCategory } from "@/server/upstream/probe";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { configureConnectedHousehold, createFamilyGroup, IOT_NETWORK, INTERNAL_NETWORK, resetDatabase, seedDevice } from "../helpers/db";

const previousMock = process.env.UNIFI_MOCK;

async function setupNetworks() {
  process.env.UNIFI_MOCK = "1";
  await configureConnectedHousehold();
  await prisma().household.update({ where: { id: "default" }, data: {
    dohUrl: null,
    unifiKeyCiphertext: Buffer.from([1]), unifiKeyIv: Buffer.from([1]), unifiKeyAuthTag: Buffer.from([1]),
  } });
  const mock = getSharedDevMockClient();
  for (const network of mock.state.networks) {
    network.ipv4Configuration!.dhcpConfiguration = {
      mode: "SERVER",
      dnsServerIpAddressesOverride: [network.id === INTERNAL_NETWORK ? "192.0.2.53" : "198.51.100.53"],
    };
  }
  return mock;
}

describe("DHCP-backed category checks", () => {
  beforeEach(async () => { await resetDatabase(); await ensureUpstreamCategories(); });
  afterEach(() => { if (previousMock === undefined) delete process.env.UNIFI_MOCK; else process.env.UNIFI_MOCK = previousMock; });

  it("measures each assigned server and gives groups their own network verdict", async () => {
    await setupNetworks();
    const blockedGroup = await createFamilyGroup("Blocked");
    const openGroup = await createFamilyGroup("Open");
    const mixedGroup = await createFamilyGroup("Mixed");
    await seedDevice({ mac: "02:00:00:00:02:01", groupId: blockedGroup.id, networkId: INTERNAL_NETWORK });
    await seedDevice({ mac: "02:00:00:00:02:02", groupId: openGroup.id, networkId: IOT_NETWORK });
    await seedDevice({ mac: "02:00:00:00:02:03", groupId: mixedGroup.id, networkId: INTERNAL_NETWORK });
    await seedDevice({ mac: "02:00:00:00:02:04", groupId: mixedGroup.id, networkId: IOT_NETWORK });
    const category = await prisma().upstreamCategory.findUniqueOrThrow({ where: { slug: "video" } });
    const asked: string[] = [];
    const outcomes = await probeCategory(category.id, { dnsResolver: (server) => async (domain) => {
      asked.push(server);
      const blocked = server === "192.0.2.53";
      return { domain, blocked, rcode: blocked ? 3 : 0, answers: [] };
    } });
    expect(outcomes.find((row) => row.groupId === blockedGroup.id)?.verdict).toBe("blocked");
    expect(outcomes.find((row) => row.groupId === openGroup.id)?.verdict).toBe("open");
    expect(outcomes.find((row) => row.groupId === mixedGroup.id)?.verdict).toBe("partial");
    expect(outcomes.find((row) => row.groupId === null)?.verdict).toBe("partial");
    expect(asked.filter((server) => server === "192.0.2.53")).toHaveLength(category.slug === "video" ? 20 : 0);
    const saved = await prisma().upstreamCheck.findFirstOrThrow({ where: { categoryId: category.id, groupId: mixedGroup.id } });
    expect(saved.resolverContext).toMatchObject({ source: "dhcp" });
    expect(saved.networkResults).toHaveLength(2);
  });

  it("invalidates changed DHCP servers and rejects a sweep started before the change", async () => {
    const mock = await setupNetworks();
    const category = await prisma().upstreamCategory.findUniqueOrThrow({ where: { slug: "video" } });
    await probeCategory(category.id, { dnsResolver: () => async (domain) => ({ domain, blocked: false, rcode: 0, answers: [] }) });
    expect(await prisma().upstreamCheck.count({ where: { categoryId: category.id } })).toBe(1);

    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const running = probeCategory(category.id, { dnsResolver: () => async (domain) => {
      entered();
      await pending;
      return { domain, blocked: true, rcode: 3, answers: [] };
    } });
    await started;
    mock.state.networks[0]!.ipv4Configuration!.dhcpConfiguration!.dnsServerIpAddressesOverride = ["192.0.2.54"];
    await refreshResolverContexts();
    expect(await prisma().upstreamCheck.count({ where: { categoryId: category.id } })).toBe(0);
    release();
    expect(await running).toEqual([]);
    expect(await prisma().upstreamCheck.count({ where: { categoryId: category.id } })).toBe(0);
  });

  it("reports unknown if one assigned DNS server cannot be reached", async () => {
    const mock = await setupNetworks();
    mock.state.networks[0]!.ipv4Configuration!.dhcpConfiguration!.dnsServerIpAddressesOverride =
      ["192.0.2.53", "192.0.2.54"];
    const category = await prisma().upstreamCategory.findUniqueOrThrow({ where: { slug: "video" } });
    const outcomes = await probeCategory(category.id, { dnsResolver: (server) => async (domain) =>
      server === "192.0.2.54"
        ? { domain, blocked: null, rcode: null, answers: [], error: "unreachable" }
        : { domain, blocked: false, rcode: 0, answers: [] },
    });
    expect(outcomes.find((row) => row.groupId === null)?.verdict).toBe("unknown");
    const saved = await prisma().upstreamCheck.findFirstOrThrow({ where: { categoryId: category.id, groupId: null } });
    expect(saved.error).toBe("unreachable");
  });
});
