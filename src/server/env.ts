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
  DEFAULT_PASSWORD: z.string().min(12),
  SESSION_SECRET: z.string().min(32),
  APP_ENCRYPTION_KEY: z.string().min(1),
  DB_MODE: z.enum(["bundled", "external"]).default("bundled"),
  DB_HOST: z.string().default("127.0.0.1"),
  DB_PORT: z.string().default("5432"),
  DB_NAME: z.string().default("familyfi"),
  DB_USER: z.string().default("familyfi"),
  DB_PASSWORD: z.string().min(1),
  DB_SSL_MODE: z.string().optional(),
  DB_SSL_ROOT_CERT: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema> & { DATABASE_URL: string };

let cached: AppEnv | undefined;

const ISSUE_BY_FIELD: Record<string, string> = {
  DEFAULT_PASSWORD: "DEFAULT_PASSWORD must be at least 12 characters.",
  SESSION_SECRET: "SESSION_SECRET must be at least 32 characters.",
  APP_ENCRYPTION_KEY: "APP_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64).",
  DB_PASSWORD: "DB_PASSWORD must be set.",
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
  throw new ConfigurationError([ISSUE_BY_FIELD.APP_ENCRYPTION_KEY]);
}

export function envIssues(source: Record<string, string | undefined> = process.env): string[] {
  const parsed = EnvSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    DEFAULT_PASSWORD: read(source, "DEFAULT_PASSWORD"),
    SESSION_SECRET: read(source, "SESSION_SECRET"),
    APP_ENCRYPTION_KEY: read(source, "APP_ENCRYPTION_KEY"),
    DB_MODE: read(source, "DB_MODE") || "bundled",
    DB_HOST: read(source, "DB_HOST"),
    DB_PORT: read(source, "DB_PORT"),
    DB_NAME: read(source, "DB_NAME"),
    DB_USER: read(source, "DB_USER"),
    DB_PASSWORD: read(source, "DB_PASSWORD"),
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
    parseEncryptionKey(read(source, "APP_ENCRYPTION_KEY") ?? "");
  } catch (error) {
    if (error instanceof ConfigurationError) error.issues.forEach(add);
    else add(ISSUE_BY_FIELD.APP_ENCRYPTION_KEY);
  }
  return issues;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const issues = envIssues(source);
  if (issues.length) throw new ConfigurationError(issues);
  const parsed = EnvSchema.parse({
    NODE_ENV: source.NODE_ENV,
    DEFAULT_PASSWORD: read(source, "DEFAULT_PASSWORD"),
    SESSION_SECRET: read(source, "SESSION_SECRET"),
    APP_ENCRYPTION_KEY: read(source, "APP_ENCRYPTION_KEY"),
    DB_MODE: read(source, "DB_MODE") || "bundled",
    DB_HOST: read(source, "DB_HOST"),
    DB_PORT: read(source, "DB_PORT"),
    DB_NAME: read(source, "DB_NAME"),
    DB_USER: read(source, "DB_USER"),
    DB_PASSWORD: read(source, "DB_PASSWORD"),
    DB_SSL_MODE: read(source, "DB_SSL_MODE"),
    DB_SSL_ROOT_CERT: read(source, "DB_SSL_ROOT_CERT"),
  });
  parseEncryptionKey(parsed.APP_ENCRYPTION_KEY);
  const DATABASE_URL = buildDatabaseUrl(parsed);
  source.DATABASE_URL = DATABASE_URL;
  return { ...parsed, DATABASE_URL };
}

export function env(): AppEnv {
  if (!cached) cached = loadEnv();
  return cached;
}

export function resetEnvCacheForTests() {
  cached = undefined;
}

/** Live recovery password. Avoids a stale env() cache and Next inlining process.env.DEFAULT_PASSWORD. */
export function recoveryPassword(): string {
  return (process.env["DEFAULT_PASSWORD"] ?? env().DEFAULT_PASSWORD).trim();
}

export function encryptionKey(): Buffer {
  return parseEncryptionKey(env().APP_ENCRYPTION_KEY);
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError;
}
