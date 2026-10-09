import {
  AccountKind,
  AssignmentState,
  ConnectionTransport,
  ConnectionTrustMode,
  EdgeAuth,
  FamilyRole,
  GroupKind,
  RouteKind,
  RuleKind,
  RuleLiftKind,
  RuleMode,
  RuleScope,
  UpstreamSource,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import { RECOVERY_USERNAME } from "@/lib/constants";
import { QUARANTINE_RULE_ID } from "@/lib/rules";
import type { ImportSummary } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";
import { ArchiveError, readArchive, writeArchive } from "./archive";
import { ensureConnectionIdentity, removeAccountDevices } from "./connection";
import { dumpDatabase } from "./database-dump";
import { assertManagedNetworkIds, RuleInputError, validateRuleShape } from "./rules";
import { normalizeResolverUrl, ResolverConfigError } from "./upstream/resolver-settings";
import { customSlugFor } from "./upstream-seed";
import { prisma } from "./db";
import { jsonError } from "./http";
import { compareSemver, parseSemver } from "./update-check";

/**
 * A household export: the configuration an administrator built (groups, rules and their windows,
 * device assignments, administrator accounts, DNS categories, routes and settings) as JSON that import
 * applies, beside a `pg_dump` for an exact restore from the command line. Nothing secret is in the JSON:
 * no UniFi key, tunnel credential or Access token, no sessions, pairings or paired devices, no
 * history, and no record of the gateway's policies, which reconciliation rebuilds. Import keeps a
 * secret this install already holds, so it asks only for the ones it lacks.
 */
export const EXPORT_FORMAT = "familyfi-export";
export const EXPORT_FORMAT_VERSION = 1;
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
/** Tar headers and padding for the three files, beyond their contents. */
const ARCHIVE_OVERHEAD_BYTES = 64 * 1024;
const FILES = ["manifest.json", "config.json", "database.dump"] as const;

const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Days = z.array(z.number().int().min(0).max(6)).max(7);
const Id = z.string().min(1).max(100);

const Manifest = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.number().int().positive(),
  appVersion: z.string(),
  createdAt: z.iso.datetime(),
  instanceId: z.string().nullable(),
  gateway: z.object({ consoleId: z.string().nullable(), siteId: z.string().nullable() }),
  databaseDump: z.object({ included: z.boolean(), reason: z.string().nullable() }),
});
type Manifest = z.infer<typeof Manifest>;

const Config = z
  .object({
    household: z.object({
      timezone: z.string().min(1),
      displayName: z.string().min(1).max(200),
      quarantineEnforced: z.boolean(),
      unifi: z.object({
        mode: z.string().nullable(),
        baseUrl: z.string().nullable(),
        consoleId: z.string().nullable(),
        siteId: z.string().nullable(),
        tlsInsecure: z.boolean(),
        manageAllNetworks: z.boolean(),
        managedNetworkIds: z.array(z.string()),
      }),
      resolver: z.object({
        dohUrl: z.string().nullable(),
        probeEnabled: z.boolean(),
        probeTime: Hhmm,
        probeDays: Days,
        probeTimeoutMs: z.number().int().positive(),
      }),
      autoUpdate: z.object({ enabled: z.boolean(), days: Days, time: Hhmm }),
    }),
    groups: z.array(
      z.object({
        id: Id,
        kind: z.enum(GroupKind),
        name: z.string().min(1),
        monogram: z.string().nullable(),
        familyRole: z.enum(FamilyRole).nullable(),
        dohOverrideUrl: z.string().nullable(),
      }),
    ),
    accounts: z.array(
      z.object({
        username: z.string().regex(/^[a-z0-9._-]{2,}$/),
        displayName: z.string().min(1),
        passwordHash: z.string().nullable(),
        isAdmin: z.boolean(),
        groupId: Id.nullable(),
      }),
    ),
    devices: z.array(
      z.object({
        mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/),
        hostname: z.string().nullable(),
        groupId: Id.nullable(),
        assignment: z.enum(AssignmentState),
      }),
    ),
    rules: z.array(
      z.object({
        id: Id,
        name: z.string().min(1),
        useGeneratedName: z.boolean(),
        kind: z.enum(RuleKind),
        scope: z.enum(RuleScope),
        networkIds: z.array(z.string()),
        targetIds: z.array(z.number().int()),
        domains: z.array(z.string()),
        enabled: z.boolean(),
        mode: z.enum(RuleMode),
        groupIds: z.array(Id),
        windows: z.array(
          z.object({ id: Id, position: z.number().int(), name: z.string(), days: Days, start: Hhmm, end: Hhmm }),
        ),
      }),
    ),
    categories: z.array(
      z.object({
        slug: z.string().min(1),
        label: z.string().min(1),
        monogram: z.string(),
        source: z.enum(UpstreamSource),
        enabled: z.boolean(),
        domains: z.array(z.object({ domain: z.string().min(1), source: z.enum(UpstreamSource), removed: z.boolean() })),
      }),
    ),
    endpoints: z.array(
      z.object({
        url: z.string().url(),
        kind: z.enum(RouteKind),
        transport: z.enum(ConnectionTransport),
        trustMode: z.enum(ConnectionTrustMode),
        spkiSha256: z.string().nullable(),
        priority: z.number().int(),
        enabled: z.boolean(),
        edgeAuth: z.enum(EdgeAuth),
      }),
    ),
  })
  .superRefine((config, context) => {
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    const unique = (label: string, values: string[]) => {
      if (new Set(values).size !== values.length) issue(`Two ${label} share an identifier.`);
    };
    unique("groups", config.groups.map((group) => group.id));
    unique("accounts", config.accounts.map((account) => account.username));
    unique("devices", config.devices.map((device) => device.mac));
    unique("rules", config.rules.map((rule) => rule.id));
    unique("rule windows", config.rules.flatMap((rule) => rule.windows.map((window) => window.id)));
    unique("categories", config.categories.map((category) => category.slug));
    unique("routes", config.endpoints.map((endpoint) => endpoint.url));
    const groups = new Set(config.groups.map((group) => group.id));
    const known = (id: string | null) => id === null || groups.has(id);
    if (!config.accounts.every((account) => known(account.groupId))) issue("An account names a group the export does not have.");
    if (!config.devices.every((device) => known(device.groupId))) issue("A device names a group the export does not have.");
    if (!config.rules.every((rule) => rule.groupIds.every((id) => groups.has(id)))) issue("A rule names a group the export does not have.");
    if (config.rules.some((rule) => rule.id === QUARANTINE_RULE_ID)) issue("The quarantine rule is built in and never exported.");
    if (config.accounts.some((account) => account.username === RECOVERY_USERNAME)) issue("The recovery account is never exported.");
    if (config.endpoints.some((endpoint) => endpoint.edgeAuth === EdgeAuth.serviceToken && (endpoint.kind !== RouteKind.own || endpoint.transport !== ConnectionTransport.cloudflare))) {
      issue("Only a Cloudflare route the household runs can sit behind Cloudflare Access.");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: config.household.timezone });
    } catch {
      issue("The household's timezone is not an IANA name.");
    }
  });
export type HouseholdConfig = z.infer<typeof Config>;

export class HouseholdImportError extends Error {
  constructor(
    readonly code: "invalid_export" | "export_too_new",
    message: string,
  ) {
    super(message);
    this.name = "HouseholdImportError";
  }
}

/**
 * Export and import are for an administrator's browser on Settings, never a paired device: an export
 * carries every administrator's password hash, and an import replaces the household, so neither goes
 * to a phone or through the remote access tunnel.
 */
export function browserOnly(session: { deviceId?: string | null }): Response | null {
  return session.deviceId ? jsonError(403, "browser_session_required", "Export and import a household from FamilyFi in a browser.") : null;
}

/** The household's configuration as export writes it. */
export async function householdConfig(): Promise<HouseholdConfig> {
  const db = prisma();
  const [household, groups, accounts, devices, rules, categories, endpoints] = await Promise.all([
    db.household.findUniqueOrThrow({ where: { id: "default" } }),
    db.group.findMany({ orderBy: { createdAt: "asc" } }),
    db.account.findMany({ where: { kind: AccountKind.personal }, orderBy: { username: "asc" } }),
    db.device.findMany({ orderBy: { mac: "asc" } }),
    db.rule.findMany({
      where: { systemGroupId: null, id: { not: QUARANTINE_RULE_ID } },
      include: { groups: true, windows: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.upstreamCategory.findMany({ include: { domains: { orderBy: { domain: "asc" } } }, orderBy: { slug: "asc" } }),
    db.connectionEndpoint.findMany({ orderBy: [{ priority: "asc" }, { url: "asc" }] }),
  ]);
  return {
    household: {
      timezone: household.timezone,
      displayName: household.displayName,
      quarantineEnforced: household.quarantineEnforced,
      unifi: {
        mode: household.unifiMode,
        baseUrl: household.unifiBaseUrl,
        consoleId: household.unifiConsoleId,
        siteId: household.unifiSiteId,
        tlsInsecure: household.unifiTlsInsecure,
        manageAllNetworks: household.unifiManageAllNetworks,
        managedNetworkIds: household.unifiManagedNetworkIds,
      },
      resolver: {
        dohUrl: household.dohUrl,
        probeEnabled: household.dohProbeEnabled,
        probeTime: household.dohProbeTime,
        probeDays: household.dohProbeDays,
        probeTimeoutMs: household.dohProbeTimeoutMs,
      },
      autoUpdate: { enabled: household.autoUpdateEnabled, days: household.autoUpdateDays, time: household.autoUpdateTime },
    },
    groups: groups.map((group) => ({
      id: group.id,
      kind: group.kind,
      name: group.name,
      monogram: group.monogram,
      familyRole: group.familyRole,
      dohOverrideUrl: group.dohOverrideUrl,
    })),
    accounts: accounts.map((account) => ({
      username: account.username,
      displayName: account.displayName,
      passwordHash: account.passwordHash,
      isAdmin: account.isAdmin,
      groupId: account.groupId,
    })),
    devices: devices.map((device) => ({ mac: device.mac, hostname: device.hostname, groupId: device.groupId, assignment: device.assignment })),
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      useGeneratedName: rule.useGeneratedName,
      kind: rule.kind,
      scope: rule.scope,
      networkIds: rule.networkIds,
      targetIds: rule.targetIds,
      domains: rule.domains,
      enabled: rule.enabled,
      mode: rule.mode,
      groupIds: rule.groups.map((link) => link.groupId),
      windows: rule.windows.map((window) => ({
        id: window.id,
        position: window.position,
        name: window.name,
        days: window.days,
        start: window.start,
        end: window.end,
      })),
    })),
    categories: categories.map((category) => ({
      slug: category.slug,
      label: category.label,
      monogram: category.monogram,
      source: category.source,
      enabled: category.enabled,
      domains: category.domains.map((domain) => ({ domain: domain.domain, source: domain.source, removed: domain.removedAt !== null })),
    })),
    endpoints: endpoints.map((endpoint) => ({
      url: endpoint.url,
      kind: endpoint.kind,
      transport: endpoint.transport,
      trustMode: endpoint.trustMode,
      spkiSha256: endpoint.spkiSha256,
      priority: endpoint.priority,
      enabled: endpoint.enabled,
      edgeAuth: endpoint.edgeAuth,
    })),
  };
}

export async function exportHousehold(now = new Date()): Promise<{ archive: Buffer; filename: string }> {
  const config = await householdConfig();
  // Which install wrote it, so an import elsewhere on the same gateway can warn about this one's policies.
  const household = await ensureConnectionIdentity();
  const configJson = Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
  // Import reads at most IMPORT_MAX_BYTES of contents, so a dump that would push the export past it
  // is left out (named in the manifest) rather than making the file unimportable.
  const dumped = await dumpDatabase();
  const room = IMPORT_MAX_BYTES - configJson.length - 4096;
  const dump = dumped.data && dumped.data.length > room
    ? { data: null, reason: "The database dump would make the export too large to import; back up the database itself instead." }
    : dumped;
  const manifest: Manifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion: APP_VERSION,
    createdAt: now.toISOString(),
    instanceId: household.instanceId,
    gateway: { consoleId: config.household.unifi.consoleId, siteId: config.household.unifi.siteId },
    databaseDump: dump.data ? { included: true, reason: null } : { included: false, reason: dump.reason },
  };
  const files = [
    { name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: "config.json", data: configJson },
    ...(dump.data ? [{ name: "database.dump", data: dump.data }] : []),
  ];
  return { archive: writeArchive(files, now), filename: `familyfi-export-${now.toISOString().slice(0, 10)}.tar.gz` };
}

function parseJson<T>(schema: z.ZodType<T>, data: Buffer | undefined, name: string): T {
  if (!data) throw new HouseholdImportError("invalid_export", `This export has no ${name}.`);
  let value: unknown;
  try {
    value = JSON.parse(data.toString("utf8"));
  } catch {
    throw new HouseholdImportError("invalid_export", `${name} is not JSON.`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const custom = parsed.error.issues.find((issue) => issue.code === "custom");
    throw new HouseholdImportError("invalid_export", custom?.message ?? `${name} is not one FamilyFi wrote.`);
  }
  return parsed.data;
}

/** Reads and checks an uploaded export without changing anything. */
export function readExport(upload: Buffer): { manifest: Manifest; config: HouseholdConfig; hasDump: boolean } {
  let files: Map<string, Buffer>;
  try {
    files = readArchive(upload, { allowed: FILES, maxFileBytes: IMPORT_MAX_BYTES, maxTotalBytes: IMPORT_MAX_BYTES + ARCHIVE_OVERHEAD_BYTES });
  } catch (error) {
    if (error instanceof ArchiveError) throw new HouseholdImportError("invalid_export", error.message);
    throw error;
  }
  const manifest = parseJson(Manifest, files.get("manifest.json"), "manifest.json");
  if (manifest.formatVersion > EXPORT_FORMAT_VERSION) {
    throw new HouseholdImportError("export_too_new", "A newer FamilyFi wrote this export. Update FamilyFi, then import it.");
  }
  const exported = parseSemver(manifest.appVersion);
  const running = parseSemver(APP_VERSION);
  if (!exported || !running) throw new HouseholdImportError("invalid_export", "manifest.json names no FamilyFi version.");
  if (compareSemver(exported, running) > 0) {
    throw new HouseholdImportError("export_too_new", `FamilyFi v${manifest.appVersion} wrote this export. Update FamilyFi, then import it.`);
  }
  return { manifest, config: checkWrites(parseJson(Config, files.get("config.json"), "config.json")), hasDump: files.has("database.dump") };
}

/**
 * The same checks the API makes on the way in, so an edited or damaged export cannot store a rule or
 * resolver the routes would refuse: rules through `validateRuleShape` (their groups are checked
 * against the export itself), network rules against the export's networks, resolvers through
 * `normalizeResolverUrl`. Returns the configuration as those checks normalise it.
 */
function checkWrites(config: HouseholdConfig): HouseholdConfig {
  const scope = { manageAllNetworks: config.household.unifi.manageAllNetworks, managedNetworkIds: config.household.unifi.managedNetworkIds };
  const rules = config.rules.map((rule) => {
    try {
      const shaped = validateRuleShape({ ...rule, windows: rule.windows.map(({ id, name, days, start, end }) => ({ id, name, days, start, end })) });
      if (shaped.scope === RuleScope.network) assertManagedNetworkIds(shaped.networkIds, scope);
      const positions = new Map(rule.windows.map((window) => [window.id, window.position]));
      return {
        ...rule,
        name: shaped.name,
        targetIds: shaped.targetIds,
        domains: shaped.domains,
        groupIds: shaped.groupIds,
        networkIds: shaped.networkIds,
        windows: shaped.windows.map((window, index) => ({
          id: window.id!,
          position: positions.get(window.id!) ?? index,
          name: window.name,
          days: window.days,
          start: window.start,
          end: window.end,
        })),
      };
    } catch (error) {
      if (error instanceof RuleInputError) throw new HouseholdImportError("invalid_export", `The rule “${rule.name}” cannot be imported: ${error.message}`);
      throw error;
    }
  });
  const resolver = (url: string | null, owner: string) => {
    if (url === null) return null;
    try {
      return normalizeResolverUrl(url);
    } catch (error) {
      if (error instanceof ResolverConfigError) throw new HouseholdImportError("invalid_export", `${owner}'s DNS-over-HTTPS endpoint cannot be imported: ${error.message}`);
      throw error;
    }
  };
  return {
    ...config,
    household: { ...config.household, resolver: { ...config.household.resolver, dohUrl: resolver(config.household.resolver.dohUrl, "The household") } },
    groups: config.groups.map((group) => ({ ...group, dohOverrideUrl: resolver(group.dohOverrideUrl, group.name) })),
    rules,
  };
}

type Current = Prisma.HouseholdGetPayload<object>;
type EndpointRow = { url: string; kind: RouteKind; edgeAuth: EdgeAuth; tunnelCredentialCiphertext: Uint8Array | null; edgeTokenCiphertext: Uint8Array | null };

/**
 * Only routes the household runs are imported. FamilyFi's own quick tunnel and its tunnel on the
 * household's domain stay with the install that made them.
 */
const imports = (endpoint: HouseholdConfig["endpoints"][number]) => endpoint.kind === RouteKind.own;

/** An `own` Cloudflare route behind Access needs its token; without one here it is imported switched off. */
function needsToken(endpoint: HouseholdConfig["endpoints"][number], existing: EndpointRow | undefined): boolean {
  return endpoint.edgeAuth === EdgeAuth.serviceToken && !existing?.edgeTokenCiphertext;
}

/**
 * The gateway connection comes from the export unless this install already holds a key for another
 * gateway. Changing the connection under a saved key would move this install's policies to a new
 * identity without the cleanup Settings does (`saveUnifiConnection`), so then the connection stays.
 */
function importsGateway(current: Current, config: HouseholdConfig): boolean {
  if (!current.unifiKeyLastFour) return true;
  const { unifi } = config.household;
  return (
    current.unifiMode === unifi.mode &&
    current.unifiBaseUrl === unifi.baseUrl &&
    current.unifiConsoleId === unifi.consoleId &&
    current.unifiSiteId === unifi.siteId
  );
}

function summarize(current: Current, endpoints: EndpointRow[], manifest: Manifest, config: HouseholdConfig, hasDump: boolean): ImportSummary {
  const byUrl = new Map(endpoints.map((endpoint) => [endpoint.url, endpoint]));
  const gateway = importsGateway(current, config) ? "imported" : "kept";
  const sameSite =
    manifest.gateway.siteId !== null &&
    manifest.gateway.consoleId === (gateway === "imported" ? config.household.unifi.consoleId : current.unifiConsoleId) &&
    manifest.gateway.siteId === (gateway === "imported" ? config.household.unifi.siteId : current.unifiSiteId);
  return {
    exportedAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    counts: {
      groups: config.groups.length,
      accounts: config.accounts.length,
      devices: config.devices.length,
      rules: config.rules.length,
      categories: config.categories.length,
      endpoints: config.endpoints.filter(imports).length,
    },
    gateway,
    unifiKey: current.unifiKeyLastFour ? "kept" : "missing",
    endpointsNeedingToken: config.endpoints.filter((endpoint) => imports(endpoint) && needsToken(endpoint, byUrl.get(endpoint.url))).map((endpoint) => endpoint.url),
    skippedEndpoints: config.endpoints.filter((endpoint) => !imports(endpoint)).map((endpoint) => endpoint.url),
    otherInstallPolicies: sameSite && manifest.instanceId !== current.instanceId,
    databaseDump: hasDump,
  };
}

async function currentState() {
  await ensureConnectionIdentity();
  const [household, endpoints] = await Promise.all([
    prisma().household.findUniqueOrThrow({ where: { id: "default" } }),
    prisma().connectionEndpoint.findMany({
      select: { url: true, kind: true, edgeAuth: true, tunnelCredentialCiphertext: true, edgeTokenCiphertext: true },
    }),
  ]);
  return { household, endpoints };
}

export async function previewImport(upload: Buffer): Promise<ImportSummary> {
  const { manifest, config, hasDump } = readExport(upload);
  const { household, endpoints } = await currentState();
  return summarize(household, endpoints, manifest, config, hasDump);
}

/**
 * Replaces the household with the export's, in one transaction under the household row lock that
 * every upstream write takes. Rule and group rows go, and their policy ownership rows with them; the
 * applied creation records stay, so the next reconciliation removes this install's own old policies
 * and nothing else (`removeOrphanedPolicies`). The importing account is never removed or demoted, and
 * keeps its password and sessions.
 */
export async function applyImport(upload: Buffer, importer: { accountId: string | null }, now = new Date()): Promise<ImportSummary> {
  const { manifest, config, hasDump } = readExport(upload);
  await ensureConnectionIdentity();
  return prisma().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = 'default' FOR UPDATE`;
      const household = await tx.household.findUniqueOrThrow({ where: { id: "default" } });
      const endpoints = await tx.connectionEndpoint.findMany({
        select: { url: true, kind: true, edgeAuth: true, tunnelCredentialCiphertext: true, edgeTokenCiphertext: true },
      });
      const summary = summarize(household, endpoints, manifest, config, hasDump);
      const { unifi, resolver, autoUpdate } = config.household;

      await tx.household.update({
        where: { id: "default" },
        data: {
          timezone: config.household.timezone,
          displayName: config.household.displayName,
          quarantineEnforced: config.household.quarantineEnforced,
          ...(summary.gateway === "imported"
            ? {
                unifiMode: unifi.mode,
                unifiBaseUrl: unifi.baseUrl,
                unifiConsoleId: unifi.consoleId,
                unifiSiteId: unifi.siteId,
                unifiTlsInsecure: unifi.tlsInsecure,
                unifiManageAllNetworks: unifi.manageAllNetworks,
                unifiManagedNetworkIds: unifi.managedNetworkIds,
              }
            : {}),
          dohUrl: resolver.dohUrl,
          dohProbeEnabled: resolver.probeEnabled,
          dohProbeTime: resolver.probeTime,
          dohProbeDays: resolver.probeDays,
          dohProbeTimeoutMs: resolver.probeTimeoutMs,
          autoUpdateEnabled: autoUpdate.enabled,
          autoUpdateDays: autoUpdate.days,
          autoUpdateTime: autoUpdate.time,
        },
      });
      // Pauses are moments, not configuration: the quarantine rule starts the import unpaused.
      await tx.rule.update({
        where: { id: QUARANTINE_RULE_ID },
        data: { pauseActive: false, pauseUntil: null, pauseKind: RuleLiftKind.pause, pausedByAccountId: null, pausedByName: null },
      });

      // Rules (system rules go with their groups), then groups; devices and accounts let go of them.
      await tx.rule.deleteMany({ where: { systemGroupId: null, id: { not: QUARANTINE_RULE_ID } } });
      await tx.group.deleteMany({});
      for (const group of config.groups) await tx.group.create({ data: group });

      const groupKinds = new Map(config.groups.map((group) => [group.id, group]));
      const adultGroup = (id: string | null) => {
        const group = id ? groupKinds.get(id) : undefined;
        return group?.kind === GroupKind.family && group.familyRole === FamilyRole.adult ? group.id : null;
      };
      const existingAccounts = await tx.account.findMany({ where: { kind: AccountKind.personal } });
      const byUsername = new Map(existingAccounts.map((account) => [account.username, account]));
      for (const account of config.accounts) {
        const existing = byUsername.get(account.username);
        // The administrator importing keeps their password, their sign-in and their access.
        const isImporter = existing !== undefined && existing.id === importer.accountId;
        const data = {
          displayName: account.displayName,
          passwordHash: isImporter ? existing.passwordHash : account.passwordHash,
          isAdmin: isImporter ? true : account.isAdmin,
          groupId: adultGroup(account.groupId),
        };
        if (!existing) {
          await tx.account.create({ data: { ...data, username: account.username, kind: AccountKind.personal } });
          continue;
        }
        await tx.account.update({ where: { id: existing.id }, data });
        if (existing.passwordHash !== data.passwordHash) {
          await tx.session.updateMany({ where: { accountId: existing.id, revokedAt: null }, data: { revokedAt: now } });
        }
        if (existing.isAdmin && !data.isAdmin) {
          await removeAccountDevices(existing.id, tx as never, now);
          await tx.session.updateMany({ where: { accountId: existing.id, revokedAt: null }, data: { revokedAt: now } });
        }
      }
      const keep = new Set(config.accounts.map((account) => account.username));
      for (const account of existingAccounts) {
        if (keep.has(account.username) || account.id === importer.accountId) continue;
        await removeAccountDevices(account.id, tx as never, now);
        await tx.session.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: now } });
        await tx.account.delete({ where: { id: account.id } });
      }

      await tx.device.updateMany({ data: { groupId: null, assignment: AssignmentState.quarantined } });
      for (const device of config.devices) {
        const assigned = device.groupId !== null && device.assignment === AssignmentState.assigned;
        const data = { groupId: assigned ? device.groupId : null, assignment: assigned ? AssignmentState.assigned : AssignmentState.quarantined };
        await tx.device.upsert({
          where: { mac: device.mac },
          update: data,
          create: { mac: device.mac, hostname: device.hostname, ...data },
        });
      }

      for (const rule of config.rules) {
        const { groupIds, windows, ...fields } = rule;
        await tx.rule.create({
          data: {
            ...fields,
            groups: { create: groupIds.map((groupId) => ({ groupId })) },
            windows: { create: windows },
          },
        });
      }

      await importCategories(tx, config.categories, now);

      const byUrl = new Map(endpoints.map((endpoint) => [endpoint.url, endpoint]));
      for (const endpoint of config.endpoints.filter(imports)) {
        const missingToken = needsToken(endpoint, byUrl.get(endpoint.url));
        const data = { ...endpoint, enabled: endpoint.enabled && !missingToken };
        await tx.connectionEndpoint.upsert({ where: { url: endpoint.url }, update: data, create: data });
      }
      return summary;
    },
    { timeout: 60_000 },
  );
}

/**
 * Seeded categories are matched by slug and keep their seed; only whether they are checked and which
 * seeded domains were struck through come from the export. The household's own categories, and its
 * own domains in seeded ones, are replaced.
 */
async function importCategories(tx: Prisma.TransactionClient, categories: HouseholdConfig["categories"], now: Date) {
  const existing = await tx.upstreamCategory.findMany({ select: { slug: true, source: true } });
  const seeds = new Set(existing.filter((category) => category.source === UpstreamSource.seed).map((category) => category.slug));
  // A household category whose slug is a seed of this release stays its own category, under the
  // slug the boot seed would give it (`customSlugFor`), never merged into the seed's.
  const placed: { category: HouseholdConfig["categories"][number]; slug: string }[] = [];
  const taken = new Set(categories.map((category) => category.slug));
  for (const category of categories) {
    if (category.source === UpstreamSource.seed) {
      // A seed this release no longer ships is not brought back.
      if (seeds.has(category.slug)) placed.push({ category, slug: category.slug });
      continue;
    }
    if (!seeds.has(category.slug)) {
      placed.push({ category, slug: category.slug });
      continue;
    }
    const slug = await customSlugFor(tx, category.slug, taken);
    taken.add(slug);
    placed.push({ category, slug });
  }
  const kept = placed.filter((entry) => entry.category.source === UpstreamSource.user).map((entry) => entry.slug);
  await tx.upstreamCategory.deleteMany({ where: { source: UpstreamSource.user, slug: { notIn: kept } } });
  for (const { category, slug } of placed) {
    const row =
      category.source === UpstreamSource.seed
      ? await tx.upstreamCategory.update({
          where: { slug },
          data: { enabled: category.enabled, disabledAt: category.enabled ? null : now },
        })
      : await tx.upstreamCategory.upsert({
          where: { slug },
          update: { label: category.label, monogram: category.monogram, enabled: category.enabled, disabledAt: category.enabled ? null : now },
          create: {
            slug,
            label: category.label,
            monogram: category.monogram,
            source: UpstreamSource.user,
            enabled: category.enabled,
            disabledAt: category.enabled ? null : now,
          },
        });
    await tx.upstreamDomain.deleteMany({ where: { categoryId: row.id, source: UpstreamSource.user } });
    for (const domain of category.domains) {
      if (domain.source === UpstreamSource.seed) {
        // A seeded domain this release no longer ships is not brought back.
        await tx.upstreamDomain.updateMany({
          where: { categoryId: row.id, domain: domain.domain, source: UpstreamSource.seed },
          data: { removedAt: domain.removed ? now : null },
        });
      } else if (!domain.removed) {
        await tx.upstreamDomain.upsert({
          where: { categoryId_domain: { categoryId: row.id, domain: domain.domain } },
          update: { removedAt: null },
          create: { categoryId: row.id, domain: domain.domain, source: UpstreamSource.user },
        });
      }
    }
  }
}
