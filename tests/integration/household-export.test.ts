import { AccountKind, AssignmentState, DeviceScope, FamilyRole, GroupKind, PairedDeviceClient, SessionKind } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { GET as exportRoute } from "@/app/api/v1/settings/export/route";
import { POST as importRoute } from "@/app/api/v1/settings/import/route";
import { CSRF_COOKIE, SESSION_COOKIE } from "@/lib/constants";
import type { ImportSummary } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";
import { readArchive, writeArchive } from "@/server/archive";
import { createSession, hashPassword } from "@/server/auth";
import { dumpDatabase, setDatabaseDumpForTests } from "@/server/database-dump";
import { prisma } from "@/server/db";
import { householdConfig, IMPORT_MAX_BYTES, type HouseholdConfig } from "@/server/household-export";
import { runReconcileOnce, setReconcileClientForTests } from "@/server/reconciliation";
import { stopAutoUpdateForTests } from "@/server/updater";
import { stopUpstreamProbeForTests } from "@/server/upstream/schedule";
import { ensureUpstreamCategories } from "@/server/upstream-seed";
import { ADMIN_POLICY_ID, configureConnectedHousehold, createFamilyGroup, resetDatabase, seedDevice } from "../helpers/db";
import { authFromLogin, request, type SessionAuth } from "../helpers/http";
import { fixtureUnifiClient } from "../helpers/unifi-world";

const PASSWORD = process.env.FAMILYFI_DEFAULT_PASSWORD ?? "ci-recovery-password";
const FILES = { allowed: ["manifest.json", "config.json", "database.dump"], maxFileBytes: 50 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 };
const SECRET_BYTES = new Uint8Array([7, 7, 7, 7]);

async function recoveryAuth(): Promise<SessionAuth> {
  return authFromLogin(
    await login(
      request("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "admin", password: PASSWORD, client: "browser" }),
      }),
    ),
  );
}

async function sessionFor(username: string): Promise<SessionAuth> {
  const account = await prisma().account.findUniqueOrThrow({ where: { username } });
  const issued = await createSession({ accountId: account.id, username, kind: SessionKind.cookie });
  return { cookie: `${SESSION_COOKIE}=${issued.raw}; ${CSRF_COOKIE}=${issued.csrf}`, csrf: issued.csrf };
}

async function exportArchive(auth: SessionAuth): Promise<Buffer> {
  const response = await exportRoute(request("/api/v1/settings/export", { auth }));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/gzip");
  expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="familyfi-export-\d{4}-\d{2}-\d{2}\.tar\.gz"$/);
  return Buffer.from(await response.arrayBuffer());
}

function importRequest(auth: SessionAuth, mode: string, body: Buffer) {
  return importRoute(
    request(`/api/v1/settings/import?mode=${mode}`, { method: "POST", auth, headers: { "content-type": "application/gzip" }, body: new Uint8Array(body) }),
  );
}

async function imported(auth: SessionAuth, body: Buffer): Promise<ImportSummary> {
  const response = await importRequest(auth, "apply", body);
  expect(response.status).toBe(200);
  const json = (await response.json()) as { summary: ImportSummary; change: { changeId: string } };
  expect(json.change.changeId).toBeTruthy();
  return json.summary;
}

/** A household with something of everything an export carries, and secrets it must not. */
async function buildHousehold() {
  await configureConnectedHousehold();
  await prisma().household.update({
    where: { id: "default" },
    data: {
      timezone: "Europe/London",
      displayName: "The Testers",
      quarantineEnforced: true,
      unifiKeyCiphertext: SECRET_BYTES,
      unifiKeyIv: SECRET_BYTES,
      unifiKeyAuthTag: SECRET_BYTES,
      unifiKeyLastFour: "abcd",
      autoUpdateDays: [6],
      autoUpdateTime: "03:15",
      // Import re-arms the DNS check, whose catch-up would otherwise sweep into the next test.
      dohProbeEnabled: false,
    },
  });
  const child = await createFamilyGroup("Betsy");
  const parents = await prisma().group.create({ data: { kind: GroupKind.family, name: "Parents", familyRole: FamilyRole.adult } });
  const things = await prisma().group.create({ data: { kind: GroupKind.things, name: "TVs", monogram: "TV" } });
  await prisma().account.create({
    data: { username: "parent", displayName: "Parent", kind: AccountKind.personal, isAdmin: true, groupId: parents.id, passwordHash: await hashPassword("parent-password-1") },
  });
  await seedDevice({ mac: "02:00:00:00:00:01", groupId: child.id });
  await seedDevice({ mac: "02:00:00:00:00:02", groupId: things.id });
  await seedDevice({ mac: "02:00:00:00:00:03" });
  await ensureUpstreamCategories();
  const seeded = await prisma().upstreamCategory.findFirstOrThrow({ where: { source: "seed" }, include: { domains: true }, orderBy: { slug: "asc" } });
  await prisma().upstreamCategory.update({ where: { id: seeded.id }, data: { enabled: false, disabledAt: new Date() } });
  await prisma().upstreamDomain.update({ where: { id: seeded.domains[0].id }, data: { removedAt: new Date() } });
  await prisma().upstreamCategory.create({
    data: { slug: "homework", label: "Homework", monogram: "HW", source: "user", domains: { create: [{ domain: "games.example.com", source: "user" }] } },
  });
  await prisma().connectionEndpoint.createMany({
    data: [
      { url: "https://familyfi.home.example", kind: "own", transport: "lan", priority: 1 },
      {
        url: "https://familyfi.example.com",
        kind: "own",
        transport: "cloudflare",
        edgeAuth: "serviceToken",
        edgeTokenCiphertext: SECRET_BYTES,
        edgeTokenIv: SECRET_BYTES,
        edgeTokenAuthTag: SECRET_BYTES,
        edgeTokenVersion: 1,
        priority: 2,
      },
      { url: "https://quick-words.trycloudflare.com", kind: "quick", transport: "cloudflare", priority: 3 },
    ],
  });
  return { child, parents, things, seededSlug: seeded.slug, struckDomain: seeded.domains[0].domain };
}

const DUMP = Buffer.from("PGDMP stand-in");

beforeEach(async () => {
  await resetDatabase();
  setDatabaseDumpForTests(async () => ({ data: DUMP }));
});

afterEach(() => {
  // Import re-arms both schedules; a later test's reset must not race them.
  stopUpstreamProbeForTests();
  stopAutoUpdateForTests();
  setDatabaseDumpForTests(async () => ({ data: null, reason: "Integration tests do not run pg_dump." }));
  setReconcileClientForTests(undefined);
});

describe("household export", () => {
  it("carries the configuration without secrets, and imports back to the same household", async () => {
    const built = await buildHousehold();
    const auth = await recoveryAuth();
    const files = readArchive(await exportArchive(auth), FILES);
    const manifest = JSON.parse(files.get("manifest.json")!.toString()) as { format: string; appVersion: string; instanceId: string | null };
    expect(manifest).toMatchObject({ format: "familyfi-export", appVersion: APP_VERSION });
    expect(manifest.instanceId).toMatch(/^ff_/);
    expect(files.get("database.dump")?.equals(DUMP)).toBe(true);
    const text = files.get("config.json")!.toString();
    for (const secret of ["Ciphertext", "AuthTag", "abcd", "tokenHash", "edgeToken", "instancePrivateKey"]) expect(text).not.toContain(secret);
    const before = await householdConfig();
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(before)));

    // Undo most of it, as a mistake would, then restore.
    await prisma().rule.deleteMany({ where: { id: { not: "quarantine" } } });
    await prisma().group.deleteMany({ where: { id: { in: [built.child.id, built.things.id] } } });
    await prisma().upstreamCategory.deleteMany({ where: { slug: "homework" } });
    await prisma().household.update({ where: { id: "default" }, data: { timezone: "UTC", autoUpdateEnabled: false } });
    await prisma().account.create({ data: { username: "stranger", displayName: "Stranger", kind: AccountKind.personal, isAdmin: true } });

    const summary = await imported(auth, writeArchive([...files].map(([name, data]) => ({ name, data }))));
    expect(summary).toMatchObject({
      counts: { groups: 3, accounts: 1, devices: 3, rules: 1, endpoints: 2 },
      gateway: "imported",
      unifiKey: "kept",
      endpointsNeedingToken: [],
      skippedEndpoints: ["https://quick-words.trycloudflare.com"],
      otherInstallPolicies: false,
    });
    expect(await householdConfig()).toEqual(before);
    // Secrets this install holds stay where they were.
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household.unifiKeyLastFour).toBe("abcd");
    const protectedRoute = await prisma().connectionEndpoint.findUniqueOrThrow({ where: { url: "https://familyfi.example.com" } });
    expect(protectedRoute).toMatchObject({ enabled: true, edgeTokenVersion: 1 });
    expect(protectedRoute.edgeTokenCiphertext).not.toBeNull();
    expect(await prisma().account.findUnique({ where: { username: "stranger" } })).toBeNull();
  });

  it("previews without changing anything, and on a fresh install asks only for what it lacks", async () => {
    await buildHousehold();
    const archive = await exportArchive(await recoveryAuth());
    await resetDatabase();
    await ensureUpstreamCategories();
    const auth = await recoveryAuth();
    const preview = await importRequest(auth, "preview", archive);
    expect(preview.status).toBe(200);
    const { summary } = (await preview.json()) as { summary: ImportSummary };
    expect(summary).toMatchObject({
      gateway: "imported",
      unifiKey: "missing",
      endpointsNeedingToken: ["https://familyfi.example.com"],
      otherInstallPolicies: true,
    });
    expect(await prisma().group.count()).toBe(0);

    await imported(auth, archive);
    expect(await prisma().group.count()).toBe(3);
    const household = await prisma().household.findUniqueOrThrow({ where: { id: "default" } });
    expect(household).toMatchObject({ timezone: "Europe/London", unifiKeyLastFour: null, autoUpdateDays: [6], autoUpdateTime: "03:15" });
    expect(await prisma().connectionEndpoint.findUniqueOrThrow({ where: { url: "https://familyfi.example.com" } })).toMatchObject({ enabled: false });
    expect(await prisma().connectionEndpoint.findUnique({ where: { url: "https://quick-words.trycloudflare.com" } })).toBeNull();
    // The parent signs in with the password they had.
    const parent = await prisma().account.findUniqueOrThrow({ where: { username: "parent" } });
    expect(parent.passwordHash).not.toBeNull();
    expect(parent.isAdmin).toBe(true);
  });

  it("keeps the importing administrator, and signs out an account whose password changes", async () => {
    await buildHousehold();
    const archive = await exportArchive(await recoveryAuth());
    const parent = await prisma().account.findUniqueOrThrow({ where: { username: "parent" } });
    await prisma().account.update({ where: { id: parent.id }, data: { passwordHash: await hashPassword("changed-password-1") } });
    await sessionFor("parent");
    await prisma().account.create({ data: { username: "importer", displayName: "Importer", kind: AccountKind.personal, isAdmin: true, passwordHash: await hashPassword("importer-password-1") } });
    await imported(await sessionFor("importer"), archive);
    expect(await prisma().account.findUniqueOrThrow({ where: { username: "importer" } })).toMatchObject({ isAdmin: true });
    const sessions = await prisma().session.findMany({ where: { accountId: parent.id } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it("lets the importing administrator keep the password they changed since the export, and their session", async () => {
    await buildHousehold();
    const archive = await exportArchive(await recoveryAuth());
    const parent = await prisma().account.findUniqueOrThrow({ where: { username: "parent" } });
    const changed = await hashPassword("changed-password-1");
    await prisma().account.update({ where: { id: parent.id }, data: { passwordHash: changed } });
    await imported(await sessionFor("parent"), archive);
    expect(await prisma().account.findUniqueOrThrow({ where: { id: parent.id } })).toMatchObject({ passwordHash: changed, isAdmin: true });
    const sessions = await prisma().session.findMany({ where: { accountId: parent.id } });
    expect(sessions.some((session) => session.revokedAt === null)).toBe(true);
  });

  it("refuses a paired phone, which is never handed the household or allowed to replace it", async () => {
    await buildHousehold();
    const parent = await prisma().account.findUniqueOrThrow({ where: { username: "parent" } });
    const phone = await prisma().pairedDevice.create({
      data: { displayName: "Parent's iPhone", client: PairedDeviceClient.phone, scope: DeviceScope.full, accountId: parent.id },
    });
    const issued = await createSession({ accountId: parent.id, username: "parent", kind: SessionKind.bearer, deviceId: phone.id });
    const bearer: SessionAuth = { cookie: "", csrf: "", token: issued.raw };
    const archive = await exportArchive(await recoveryAuth());
    for (const response of [
      await exportRoute(request("/api/v1/settings/export", { auth: bearer })),
      await importRequest(bearer, "apply", archive),
    ]) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("browser_session_required");
    }
  });

  it("refuses what FamilyFi did not write, a newer FamilyFi's export, and a missing mode", async () => {
    const auth = await recoveryAuth();
    const garbage = await importRequest(auth, "preview", Buffer.from("not an export"));
    expect(garbage.status).toBe(400);
    expect(((await garbage.json()) as { error: { code: string } }).error.code).toBe("invalid_export");

    await buildHousehold();
    const files = readArchive(await exportArchive(auth), FILES);
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    const newer = writeArchive([
      { name: "manifest.json", data: Buffer.from(JSON.stringify({ ...manifest, appVersion: "999.0.0" })) },
      { name: "config.json", data: files.get("config.json")! },
    ]);
    const tooNew = await importRequest(auth, "apply", newer);
    expect(tooNew.status).toBe(409);
    expect(((await tooNew.json()) as { error: { code: string } }).error.code).toBe("export_too_new");

    const config = JSON.parse(files.get("config.json")!.toString());
    config.devices[0].groupId = "no-such-group";
    const dangling = writeArchive([
      { name: "manifest.json", data: files.get("manifest.json")! },
      { name: "config.json", data: Buffer.from(JSON.stringify(config)) },
    ]);
    const refused = await importRequest(auth, "apply", dangling);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe("A device names a group the export does not have.");

    expect((await importRequest(auth, "now", newer)).status).toBe(400);
    expect(await prisma().group.count()).toBe(3);
  });

  it("lets the next sync remove this install's old policies and never an administrator's", async () => {
    await configureConnectedHousehold();
    const child = await createFamilyGroup("Betsy");
    await seedDevice({ mac: "02:00:00:00:00:01", groupId: child.id });
    const client = fixtureUnifiClient();
    setReconcileClientForTests(client);
    expect(await runReconcileOnce()).toBe(true);
    const ours = (await prisma().rulePolicy.findMany()).map((row) => row.unifiPolicyId!);
    expect(ours.length).toBeGreaterThan(0);

    const auth = await recoveryAuth();
    await imported(auth, await exportArchive(auth));
    expect(await runReconcileOnce()).toBe(true);
    const onGateway = new Set(client.state.policies.map((policy) => policy.id));
    for (const id of ours) expect(onGateway.has(id)).toBe(false);
    expect(await prisma().rulePolicy.count()).toBe(ours.length);
    expect(onGateway.has(ADMIN_POLICY_ID)).toBe(true);
    expect(client.calls.some((call) => (call.method === "PUT" || call.method === "DELETE") && call.path.includes(ADMIN_POLICY_ID))).toBe(false);
    const device = await prisma().device.findUniqueOrThrow({ where: { mac: "02:00:00:00:00:01" } });
    expect(device).toMatchObject({ groupId: child.id, assignment: AssignmentState.assigned });
  });

  it("still exports the configuration when pg_dump cannot run, and says why", async () => {
    setDatabaseDumpForTests(undefined);
    expect(await dumpDatabase("familyfi-no-such-pg-dump")).toEqual({ data: null, reason: "pg_dump is not installed here." });
    setDatabaseDumpForTests(async () => ({ data: null, reason: "pg_dump failed: server version mismatch" }));
    const files = readArchive(await exportArchive(await recoveryAuth()), FILES);
    expect(files.has("database.dump")).toBe(false);
    expect(JSON.parse(files.get("manifest.json")!.toString()).databaseDump).toEqual({ included: false, reason: "pg_dump failed: server version mismatch" });
  });

  it("keeps a household category whose slug is now built in as its own category", async () => {
    await ensureUpstreamCategories();
    const seed = await prisma().upstreamCategory.findFirstOrThrow({ where: { source: "seed" }, orderBy: { slug: "asc" } });
    const auth = await recoveryAuth();
    const files = readArchive(await exportArchive(auth), FILES);
    const config = JSON.parse(files.get("config.json")!.toString());
    // As an older release that shipped no such seed would have exported it.
    config.categories.push({ slug: seed.slug, label: "Ours", monogram: "OU", source: "user", enabled: true, domains: [{ domain: "ours.example.com", source: "user", removed: false }] });
    config.categories = config.categories.filter((category: { slug: string; source: string }) => !(category.slug === seed.slug && category.source === "seed"));
    await imported(auth, writeArchive([{ name: "manifest.json", data: files.get("manifest.json")! }, { name: "config.json", data: Buffer.from(JSON.stringify(config)) }]));
    const ours = await prisma().upstreamCategory.findUniqueOrThrow({ where: { slug: `${seed.slug}-custom` }, include: { domains: true } });
    expect(ours).toMatchObject({ source: "user", label: "Ours" });
    expect(ours.domains.map((domain) => domain.domain)).toEqual(["ours.example.com"]);
    const seeded = await prisma().upstreamCategory.findUniqueOrThrow({ where: { slug: seed.slug }, include: { domains: true } });
    expect(seeded).toMatchObject({ source: "seed", label: seed.label });
    expect(seeded.domains.some((domain) => domain.domain === "ours.example.com")).toBe(false);
  });

  it("refuses a rule or resolver the API would refuse, before changing anything", async () => {
    await buildHousehold();
    const auth = await recoveryAuth();
    const files = readArchive(await exportArchive(auth), FILES);
    type Editable = HouseholdConfig & { rules: Array<HouseholdConfig["rules"][number] & Record<string, unknown>> };
    const edited = (change: (config: Editable) => void) => {
      const config = JSON.parse(files.get("config.json")!.toString());
      change(config);
      return writeArchive([{ name: "manifest.json", data: files.get("manifest.json")! }, { name: "config.json", data: Buffer.from(JSON.stringify(config)) }]);
    };
    const before = await householdConfig();
    for (const [archive, message] of [
      [edited((config) => (config.rules[0].windows[0].end = config.rules[0].windows[0].start)), /Bedtime.*cannot be imported/],
      [edited((config) => (config.rules[0].windows = [])), /needs at least one window/],
      [edited((config) => config.rules.push({ ...config.rules[0], id: "website", name: "Sites", kind: "domain", mode: "always", domains: [], windows: [] })), /Add at least one website/],
      [edited((config) => (config.household.resolver.dohUrl = "http://dns.example.com/dns-query")), /must start with https/],
    ] as const) {
      const response = await importRequest(auth, "preview", archive);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(message);
    }
    expect(await householdConfig()).toEqual(before);
  });

  it("leaves out a database dump that would make the export too large to import back", async () => {
    setDatabaseDumpForTests(async () => ({ data: Buffer.alloc(IMPORT_MAX_BYTES) }));
    const archive = await exportArchive(await recoveryAuth());
    const files = readArchive(archive, FILES);
    expect(files.has("database.dump")).toBe(false);
    expect(JSON.parse(files.get("manifest.json")!.toString()).databaseDump).toMatchObject({ included: false });
    expect((await importRequest(await recoveryAuth(), "preview", archive)).status).toBe(200);
  });
});
