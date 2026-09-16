import { z } from "zod";
import { buildDatabaseUrl } from "./database-url";

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
  DB_MODE: z.enum(["bundled", "external"]).default("bundled"),
  DB_HOST: z.string().default("127.0.0.1"),
  POSTGRES_PORT: z.string().default("5432"),
  POSTGRES_DB: z.string().default("familyfi"),
  POSTGRES_USER: z.string().default("familyfi"),
  POSTGRES_PASSWORD: z.string().min(1),
  DB_SSL_MODE: z.string().optional(),
  DB_SSL_ROOT_CERT: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema> & { DATABASE_URL: string; UNIFI_MOCK: boolean };

function truthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/** True when UNIFI_MOCK is 1/true/yes, ignoring NODE_ENV. */
export function unifiMockRequested(source: Record<string, string | undefined> = process.env): boolean {
  return truthyFlag(read(source, "UNIFI_MOCK"));
}

/** Opt-in UniFi stand-in for local UI work. Never enabled in production unless CI opts in. */
export function unifiMockEnabled(source: Record<string, string | undefined> = process.env): boolean {
  if (source.NODE_ENV === "production") {
    // `next start` forces production; browser CI still needs the mock household.
    if (!(truthyFlag(read(source, "CI")) && unifiMockRequested(source))) return false;
    return true;
  }
  return unifiMockRequested(source);
}

let cached: AppEnv | undefined;

const ISSUE_BY_FIELD: Record<string, string> = {
  FAMILYFI_DEFAULT_PASSWORD: "FAMILYFI_DEFAULT_PASSWORD must be at least 12 characters.",
  FAMILYFI_SESSION_SECRET: "FAMILYFI_SESSION_SECRET must be at least 32 characters.",
  FAMILYFI_ENCRYPTION_KEY: "FAMILYFI_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64).",
  POSTGRES_PASSWORD: "POSTGRES_PASSWORD must be set.",
  DB_MODE: "DB_MODE must be bundled or external.",
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

export function envIssues(source: Record<string, string | undefined> = process.env): string[] {
  const parsed = EnvSchema.safeParse({
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
  });
  const issues: string[] = [];
  const seen = new Set<string>();
  const add = (message: string) => {
    if (!seen.has(message)) {
      seen.add(message);
      issues.push(message);
    }
  };
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
  const parsed = EnvSchema.parse({
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
  });
  parseEncryptionKey(parsed.FAMILYFI_ENCRYPTION_KEY);
  const DATABASE_URL = buildDatabaseUrl(parsed);
  source.DATABASE_URL = DATABASE_URL;
  return { ...parsed, DATABASE_URL, UNIFI_MOCK: unifiMockEnabled(source) };
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
