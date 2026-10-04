import { z } from "zod";
import { buildDatabaseUrl, memoryDatabase } from "./database-url";

export class ConfigurationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  FAMILYFI_DEFAULT_PASSWORD: z.string().min(12),
  FAMILYFI_SESSION_SECRET: z.string().min(32),
  FAMILYFI_ENCRYPTION_KEY: z.string().min(1),
  DB_MODE: z.enum(["bundled", "external", "memory"]).default("bundled"),
  DB_HOST: z.string().default("127.0.0.1"),
  POSTGRES_PORT: z.string().default("5432"),
  POSTGRES_DB: z.string().default("familyfi"),
  POSTGRES_USER: z.string().default("familyfi"),
  POSTGRES_PASSWORD: z.string().min(1),
  DB_SSL_MODE: z.string().optional(),
  DB_SSL_ROOT_CERT: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema> & { DATABASE_URL: string; FAMILYFI_MODE: FamilyFiMode; UNIFI_MOCK: boolean };

/**
 * The kind of work this process does, picked by `FAMILYFI_MODE`. Each mode fixes the gateway (real
 * or the UniFi mock), the database (PostgreSQL, or in memory), the starting data and whether
 * configuration is locked:
 *
 * - `prod`: a household's real gateway on PostgreSQL. The default.
 * - `dev`: the UniFi mock and the seed household, for local work. PostgreSQL, or in memory with `DB_MODE=memory`.
 * - `test`: as `dev`, for automated runs, including a production build under CI.
 * - `demo`: the hosted public demo. The mock and the seed on an in-memory database, reset nightly, configuration locked.
 *
 * Under `NODE_ENV=production` only `prod` and `demo` start (and `test` under CI); `modeIssues` refuses the rest.
 */
export const FAMILYFI_MODES = ["dev", "test", "demo", "prod"] as const;
export type FamilyFiMode = (typeof FAMILYFI_MODES)[number];

function truthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isMode(value: string | undefined): value is FamilyFiMode {
  return (FAMILYFI_MODES as readonly string[]).includes(value ?? "");
}

/** `UNIFI_MOCK=1`, the deprecated name for `FAMILYFI_MODE=dev`. Read only while `FAMILYFI_MODE` is unset, and never in production. */
export function legacyUnifiMock(source: Record<string, string | undefined> = process.env): boolean {
  return !read(source, "FAMILYFI_MODE") && truthyFlag(read(source, "UNIFI_MOCK"));
}

function modeRefusal(source: Record<string, string | undefined>): string | undefined {
  const value = read(source, "FAMILYFI_MODE")?.toLowerCase();
  if (value && !isMode(value)) return "FAMILYFI_MODE must be dev, test, demo or prod.";
  if (source.NODE_ENV !== "production") return undefined;
  if (value === "dev") return "FAMILYFI_MODE=dev is not allowed in production; use prod or demo.";
  // `next start` forces production, and browser CI runs the production build in test mode.
  if (value === "test" && !truthyFlag(read(source, "CI"))) {
    return "FAMILYFI_MODE=test runs in production only under CI; use prod or demo.";
  }
  return undefined;
}

/**
 * The mode in effect. A mode that `modeIssues` refuses reads as `prod`, so a misconfigured process
 * never runs the mock or the seed: startup reports the issue instead.
 */
export function familyfiMode(source: Record<string, string | undefined> = process.env): FamilyFiMode {
  if (modeRefusal(source)) return "prod";
  const value = read(source, "FAMILYFI_MODE")?.toLowerCase();
  if (isMode(value)) return value;
  return legacyUnifiMock(source) && source.NODE_ENV !== "production" ? "dev" : "prod";
}

export function modeIssues(source: Record<string, string | undefined> = process.env): string[] {
  const issues: string[] = [];
  const refusal = modeRefusal(source);
  if (refusal) issues.push(refusal);
  if (read(source, "DB_MODE") === "memory" && familyfiMode(source) === "prod") {
    issues.push("DB_MODE=memory is for dev, test and demo; prod keeps its household in PostgreSQL.");
  }
  return issues;
}

/** The hosted public demo (`FAMILYFI_MODE=demo`). */
export function demoModeEnabled(source: Record<string, string | undefined> = process.env): boolean {
  return familyfiMode(source) === "demo";
}

/** The UniFi mock stands in for the gateway in every mode but `prod`. */
export function unifiMockEnabled(source: Record<string, string | undefined> = process.env): boolean {
  return familyfiMode(source) !== "prod";
}

/** In memory in demo, and in dev or test with `DB_MODE=memory`; never in prod. */
export function inMemoryDatabase(source: Record<string, string | undefined> = process.env): boolean {
  const mode = familyfiMode(source);
  return mode === "demo" || (mode !== "prod" && read(source, "DB_MODE") === "memory");
}

let cached: AppEnv | undefined;

const ISSUE_BY_FIELD: Record<string, string> = {
  FAMILYFI_DEFAULT_PASSWORD: "FAMILYFI_DEFAULT_PASSWORD must be at least 12 characters.",
  FAMILYFI_SESSION_SECRET: "FAMILYFI_SESSION_SECRET must be at least 32 characters.",
  FAMILYFI_ENCRYPTION_KEY: "FAMILYFI_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64).",
  POSTGRES_PASSWORD: "POSTGRES_PASSWORD must be set.",
  DB_MODE: "DB_MODE must be bundled, external or memory.",
};

function read(source: Record<string, string | undefined>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value.trim() : undefined;
}

function parseEncryptionKey(value: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const buf = Buffer.from(value, "base64");
  if (buf.length === 32) return buf;
  throw new ConfigurationError([ISSUE_BY_FIELD.FAMILYFI_ENCRYPTION_KEY]);
}

/** The settings as read, with the in-memory database in place of any configured one when it is in use. */
function settingsFrom(source: Record<string, string | undefined>) {
  const settings = {
    NODE_ENV: source.NODE_ENV,
    FAMILYFI_DEFAULT_PASSWORD: read(source, "FAMILYFI_DEFAULT_PASSWORD"),
    FAMILYFI_SESSION_SECRET: read(source, "FAMILYFI_SESSION_SECRET"),
    FAMILYFI_ENCRYPTION_KEY: read(source, "FAMILYFI_ENCRYPTION_KEY"),
    DB_MODE: read(source, "DB_MODE") || "bundled",
    DB_HOST: read(source, "DB_HOST"),
    POSTGRES_PORT: read(source, "POSTGRES_PORT"),
    POSTGRES_DB: read(source, "POSTGRES_DB"),
    POSTGRES_USER: read(source, "POSTGRES_USER"),
    POSTGRES_PASSWORD: read(source, "POSTGRES_PASSWORD"),
    DB_SSL_MODE: read(source, "DB_SSL_MODE"),
    DB_SSL_ROOT_CERT: read(source, "DB_SSL_ROOT_CERT"),
  };
  if (!inMemoryDatabase(source)) return settings;
  return { ...settings, DB_MODE: "memory", DB_SSL_ROOT_CERT: undefined, ...memoryDatabase(settings.POSTGRES_PORT) };
}

export function envIssues(source: Record<string, string | undefined> = process.env): string[] {
  const parsed = EnvSchema.safeParse(settingsFrom(source));
  const issues: string[] = [];
  const seen = new Set<string>();
  const add = (message: string) => {
    if (!seen.has(message)) {
      seen.add(message);
      issues.push(message);
    }
  };
  modeIssues(source).forEach(add);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      add(ISSUE_BY_FIELD[field] ?? `${field || "environment"} is invalid.`);
    }
  }
  try {
    parseEncryptionKey(read(source, "FAMILYFI_ENCRYPTION_KEY") ?? "");
  } catch (error) {
    if (error instanceof ConfigurationError) error.issues.forEach(add);
    else add(ISSUE_BY_FIELD.FAMILYFI_ENCRYPTION_KEY);
  }
  return issues;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const issues = envIssues(source);
  if (issues.length) throw new ConfigurationError(issues);
  const parsed = EnvSchema.parse(settingsFrom(source));
  parseEncryptionKey(parsed.FAMILYFI_ENCRYPTION_KEY);
  const DATABASE_URL = buildDatabaseUrl(parsed);
  source.DATABASE_URL = DATABASE_URL;
  const FAMILYFI_MODE = familyfiMode(source);
  return { ...parsed, DATABASE_URL, FAMILYFI_MODE, UNIFI_MOCK: FAMILYFI_MODE !== "prod" };
}

export function env(): AppEnv {
  if (!cached) cached = loadEnv();
  return cached;
}

export function resetEnvCacheForTests() {
  cached = undefined;
}

/** Live recovery password. Avoids a stale env() cache and Next inlining process.env.FAMILYFI_DEFAULT_PASSWORD. */
export function recoveryPassword(): string {
  return (process.env["FAMILYFI_DEFAULT_PASSWORD"] ?? env().FAMILYFI_DEFAULT_PASSWORD).trim();
}

export function encryptionKey(): Buffer {
  return parseEncryptionKey(env().FAMILYFI_ENCRYPTION_KEY);
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError;
}
