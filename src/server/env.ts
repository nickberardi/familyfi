import { z } from "zod";
import { buildDatabaseUrl } from "./database-url";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional(),
  DEFAULT_PASSWORD: z.string().min(12),
  SESSION_SECRET: z.string().min(32),
  APP_ENCRYPTION_KEY: z.string().min(32),
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

function parseEncryptionKey(value: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  const buf = Buffer.from(value, "base64");
  if (buf.length === 32) return buf;
  throw new Error("APP_ENCRYPTION_KEY must be 32 bytes as 64 hex characters (or base64).");
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.parse({
    NODE_ENV: source.NODE_ENV,
    DEFAULT_PASSWORD: source.DEFAULT_PASSWORD,
    SESSION_SECRET: source.SESSION_SECRET,
    APP_ENCRYPTION_KEY: source.APP_ENCRYPTION_KEY,
    DB_MODE: source.DB_MODE || "bundled",
    DB_HOST: source.DB_HOST,
    DB_PORT: source.DB_PORT,
    DB_NAME: source.DB_NAME,
    DB_USER: source.DB_USER,
    DB_PASSWORD: source.DB_PASSWORD,
    DB_SSL_MODE: source.DB_SSL_MODE,
    DB_SSL_ROOT_CERT: source.DB_SSL_ROOT_CERT,
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

export function encryptionKey(): Buffer {
  return parseEncryptionKey(env().APP_ENCRYPTION_KEY);
}
