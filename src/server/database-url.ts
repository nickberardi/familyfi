export type DatabaseSettings = {
  DB_HOST?: string;
  DB_PORT?: string;
  DB_NAME?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
  DB_SSL_MODE?: string;
  DB_SSL_ROOT_CERT?: string;
};

/**
 * The database settings' names before they all took the `DB_` prefix. Each is still read, with a
 * startup warning, while the new name is unset. `scripts/runtime/mode.mjs` keeps its own copy.
 */
export const OLD_DATABASE_NAMES = {
  DB_SERVER: "DB_MODE",
  DB_PORT: "POSTGRES_PORT",
  DB_NAME: "POSTGRES_DB",
  DB_USER: "POSTGRES_USER",
  DB_PASSWORD: "POSTGRES_PASSWORD",
} as const;

/** Where the in-memory database is served unless `DB_PORT` names another port. */
export const MEMORY_DATABASE_PORT = "5433";

/**
 * The in-memory PGlite database (demo, or `DB_SERVER=memory` in dev and test), served on loopback by
 * `scripts/runtime/memory-database.mjs`, which keeps its own copy in `print-database-url.mjs`. Only
 * the port can be chosen. Loopback only, so no TLS (`pglite-server.mjs` offers none).
 */
export function memoryDatabase(port?: string) {
  return {
    DB_HOST: "127.0.0.1",
    DB_PORT: port || MEMORY_DATABASE_PORT,
    DB_NAME: "template1",
    DB_USER: "postgres",
    DB_PASSWORD: "postgres",
    DB_SSL_MODE: "disable",
  } satisfies DatabaseSettings;
}

export function buildDatabaseUrl(settings: DatabaseSettings): string {
  const host = settings.DB_HOST || "127.0.0.1";
  const port = settings.DB_PORT || "5432";
  const name = settings.DB_NAME || "familyfi";
  const user = settings.DB_USER || "familyfi";
  const password = settings.DB_PASSWORD ?? "";
  let url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
  const params: string[] = [];
  if (settings.DB_SSL_MODE) params.push(`sslmode=${encodeURIComponent(settings.DB_SSL_MODE)}`);
  if (settings.DB_SSL_ROOT_CERT) {
    params.push(`sslrootcert=${encodeURIComponent(settings.DB_SSL_ROOT_CERT)}`);
  }
  if (params.length) url += `?${params.join("&")}`;
  return url;
}
