export type DatabaseSettings = {
  DB_HOST?: string;
  POSTGRES_PORT?: string;
  POSTGRES_DB?: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  DB_SSL_MODE?: string;
  DB_SSL_ROOT_CERT?: string;
};

/** Where the in-memory database is served unless `POSTGRES_PORT` names another port. */
export const MEMORY_DATABASE_PORT = "5433";

/**
 * The in-memory PGlite database (demo, or `DB_MODE=memory` in dev and test), served on loopback by
 * `scripts/runtime/memory-database.mjs`, which keeps its own copy in `print-database-url.mjs`. Only
 * the port can be chosen. Loopback only, so no TLS (`pglite-server.mjs` offers none).
 */
export function memoryDatabase(port?: string) {
  return {
    DB_HOST: "127.0.0.1",
    POSTGRES_PORT: port || MEMORY_DATABASE_PORT,
    POSTGRES_DB: "template1",
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: "postgres",
    DB_SSL_MODE: "disable",
  } satisfies DatabaseSettings;
}

export function buildDatabaseUrl(settings: DatabaseSettings): string {
  const host = settings.DB_HOST || "127.0.0.1";
  const port = settings.POSTGRES_PORT || "5432";
  const name = settings.POSTGRES_DB || "familyfi";
  const user = settings.POSTGRES_USER || "familyfi";
  const password = settings.POSTGRES_PASSWORD ?? "";
  let url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
  const params: string[] = [];
  if (settings.DB_SSL_MODE) params.push(`sslmode=${encodeURIComponent(settings.DB_SSL_MODE)}`);
  if (settings.DB_SSL_ROOT_CERT) {
    params.push(`sslrootcert=${encodeURIComponent(settings.DB_SSL_ROOT_CERT)}`);
  }
  if (params.length) url += `?${params.join("&")}`;
  return url;
}
