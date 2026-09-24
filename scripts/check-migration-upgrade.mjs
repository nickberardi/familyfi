#!/usr/bin/env node
/**
 * Upgrades a database built by an earlier release to the current migrations, the way every
 * household upgrades. For each start release it builds a scratch database from that
 * release's own migrations, fills every table with synthetic household data, applies
 * today's migrations, and fails if a migration errors, loses rows, or leaves the database
 * different from prisma/schema.prisma.
 *
 * The rows are generated from the release's schema as read from PostgreSQL, so nothing
 * here is written for any one version.
 *
 *   check-migration-upgrade.mjs              every supported release (the default)
 *   check-migration-upgrade.mjs --latest     the newest release only
 *   check-migration-upgrade.mjs --from v0.5.0  (or just `v0.5.0`) that release only
 *
 * Releases whose prisma/migrations are identical build identical databases, so each
 * distinct set is upgraded once and the releases that share it are reported with it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyDatabaseUrl } from "./print-database-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The oldest release a household may upgrade from. Every release from v0.1.0 on is a
 * published image, built on Prisma 7, and its migrations are still byte-for-byte the
 * start of today's history, so any of them can be running in a household today. Raise
 * this only with a release note telling households on older versions to step through an
 * intermediate release first.
 */
export const OLDEST_SUPPORTED_RELEASE = "v0.1.0";

/** Every scratch database starts with this, and nothing without it is ever dropped. */
export const SCRATCH_PREFIX = "familyfi_upgrade_";
/** Rows per table: one bare (nulls and defaults), the rest with every column filled. */
const ROWS_PER_TABLE = 3;

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** `[major, minor, patch]` of a `vX.Y.Z` tag. */
export const version = (tag) => tag.slice(1).split(".").map(Number);
export const compareReleases = (a, b) => {
  const [x, y] = [version(a), version(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** Release tags and their commits from `git ls-remote --tags` output, oldest first. */
export function parseReleaseTags(lsRemote) {
  const commits = new Map();
  for (const line of lsRemote.split("\n")) {
    const [sha, ref] = line.split("\t");
    const tag = ref?.replace("refs/tags/", "").replace("^{}", "");
    // An annotated tag is listed twice; its peeled `^{}` line names the commit.
    if (tag && (ref.endsWith("^{}") || !commits.has(tag))) commits.set(tag, sha);
  }
  return [...commits]
    .filter(([tag]) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map(([tag, sha]) => ({ tag, sha }))
    .sort((a, b) => compareReleases(a.tag, b.tag));
}

/**
 * The releases to upgrade from: every release from `oldest` on, leaving out the one at
 * this commit, since a release run tests the upgrade to its own tag.
 */
export function supportedReleases(releases, head, oldest = OLDEST_SUPPORTED_RELEASE) {
  return releases.filter(({ tag, sha }) => sha !== head && compareReleases(tag, oldest) >= 0).map(({ tag }) => tag);
}

/** `{ from }` names one release, `{ latest: true }` the newest, `{}` every supported one. */
export function parseArgs(argv) {
  const options = {};
  for (let n = 0; n < argv.length; n += 1) {
    const arg = argv[n];
    if (arg === "--latest") options.latest = true;
    else if (arg === "--from") options.from = argv[++n] ?? "";
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
    else if (!arg.startsWith("-") && !("from" in options)) options.from = arg;
    else throw new Error(`Unknown option ${arg}. Use --from <tag>, --latest, or nothing for every supported release.`);
  }
  if (options.from !== undefined && !/^v\d+\.\d+\.\d+$/.test(options.from)) {
    throw new Error(`--from takes a release tag like v0.5.0, not ${options.from || "nothing"}.`);
  }
  if (options.from && options.latest) throw new Error("Use --from or --latest, not both.");
  return options;
}

/** The scratch database for one start release: `v0.5.0` → `familyfi_upgrade_v0_5_0`. */
export function scratchDatabaseName(tag) {
  return `${SCRATCH_PREFIX}${tag.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
}

/** Drops a scratch database, refusing any name this script did not make. */
async function dropScratch(server, name) {
  if (!name.startsWith(SCRATCH_PREFIX) || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to drop ${name}: only ${SCRATCH_PREFIX}* scratch databases are dropped.`);
  }
  await server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}

/** Runs the Prisma CLI against the scratch database with the given schema and migrations. */
function prisma(work, url, name, schema, migrations, args) {
  const config = path.join(work, `${name}.prisma.config.mjs`);
  writeFileSync(
    config,
    `export default ${JSON.stringify({ schema, migrations: { path: migrations }, datasource: { url } })};\n`,
  );
  return spawnSync(path.join(root, "node_modules/.bin/prisma"), [...args, "--config", config], {
    cwd: root,
    encoding: "utf8",
  });
}

async function tables(client) {
  const { rows } = await client.query(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`,
  );
  return rows.map((row) => row.name);
}

async function rowCounts(client) {
  const counts = {};
  for (const table of await tables(client)) {
    counts[table] = Number((await client.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
  }
  return counts;
}

/** A household-shaped string for a text column, recognised by name. */
function sampleText(table, column, row) {
  const name = column.name;
  const hex = (n) => n.toString(16).padStart(2, "0");
  // Locally administered MACs and documentation IPs, as repository-hygiene requires.
  if (/mac$/i.test(name)) return `02:00:00:00:${hex(table.length)}:${hex(row)}`;
  if (/^ip$/i.test(name)) return `192.0.2.${10 + row}`;
  if (/url$/i.test(name)) return `https://192.0.2.1/upgrade/${table}/${name}/${row}`;
  if (/hostname$/i.test(name)) return `upgrade-${row}.${table.toLowerCase()}.example`;
  if (name === "domain") return `upgrade-${row}.example.com`;
  if (/^schedule(Start|End)$|Time$/.test(name)) return ["21:00", "07:00", "19:30"][row % 3];
  if (name === "timezone") return ["America/New_York", "Europe/London", "Pacific/Kiritimati"][row % 3];
  if (/LastFour$/.test(name)) return `${1000 + row}`;
  if (/(Hash|Fingerprint|spkiSha256)$/.test(name)) return `${table}${name}${row}`.replace(/[^a-z0-9]/gi, "").toLowerCase().padEnd(64, "0");
  return `upgrade-${table}-${name}-${row}`;
}

/**
 * A value of the column's type for the given row, or null to leave the column to its
 * default. Row 0 is bare: nullable and defaulted columns are left alone, the shape a
 * household has before it touches a setting. Later rows fill every column, varying enum
 * labels, booleans and arrays, so a migration that reads existing data sees more than one
 * shape of it.
 */
async function sampleValue(client, table, column, reference, row) {
  if (reference !== undefined) return reference;
  if (column.identity) return null;
  if (row === 0 && (column.nullable || column.hasDefault)) return null;
  const element = column.dataType === "ARRAY" ? column.udt.slice(1) : column.udt;
  let value;
  if (column.dataType === "USER-DEFINED") {
    const { rows } = await client.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder`,
      [column.udt],
    );
    return rows[row % rows.length].enumlabel;
  }
  if (/^(int|numeric|float)/.test(element)) value = row + 1;
  else if (element === "bool") value = row % 2 === 1;
  else if (/^(timestamp|date)/.test(element)) value = new Date(Date.UTC(2026, 8, 14 + row, 21));
  else if (/^json/.test(element)) return JSON.stringify({ upgrade: row, items: [row] });
  else if (element === "bytea") return Buffer.from([row, 1, 2, 3]);
  else value = sampleText(table, column, row);
  if (column.dataType !== "ARRAY") return value;
  if (row === 0) return [];
  // Integer arrays hold weekdays in this schema, so keep them in 0–6.
  return typeof value === "number" ? [1, 3, 5].slice(0, row + 1) : [value, `${value}-b`];
}

/**
 * Rows in every table, parents before children, so every foreign key has a target. A table
 * whose id has a default (the household singleton) gets one row, filled. A row that would
 * break a unique constraint, such as a second child of a one-to-one parent, is skipped.
 */
async function fillEveryTable(client) {
  const names = await tables(client);
  const { rows: keys } = await client.query(`
    SELECT child.relname AS child, parent.relname AS parent,
           (SELECT attname FROM pg_attribute WHERE attrelid = fk.conrelid AND attnum = fk.conkey[1]) AS column
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_class parent ON parent.oid = fk.confrelid
    WHERE fk.contype = 'f' AND fk.connamespace = current_schema()::regnamespace`);
  const inserted = new Map();
  const remaining = new Set(names);
  while (remaining.size) {
    const ready = [...remaining].filter((table) =>
      keys.every((key) => key.child !== table || key.parent === table || inserted.has(key.parent)),
    );
    if (!ready.length) throw new Error(`Foreign keys form a cycle among: ${[...remaining].join(", ")}`);
    for (const table of ready) {
      const { rows: columns } = await client.query(
        `SELECT column_name AS name, data_type AS "dataType", udt_name AS udt,
                is_nullable = 'YES' AS nullable, column_default IS NOT NULL AS "hasDefault",
                is_identity = 'YES' OR column_default LIKE 'nextval(%' AS identity
         FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );
      const singleton = columns.some((column) => column.name === "id" && column.hasDefault);
      const parents = keys.filter((key) => key.child === table && key.parent !== table);
      const ids = [];
      for (let row = singleton ? 1 : 0; row < (singleton ? 2 : ROWS_PER_TABLE); row += 1) {
        const values = [];
        for (const column of columns) {
          if (singleton && column.name === "id") continue;
          const parent = parents.find((key) => key.column === column.name);
          const targets = parent && inserted.get(parent.parent);
          const value = await sampleValue(client, table, column, targets?.[row % targets.length], row);
          if (value !== null) values.push([column.name, value]);
        }
        await client.query("SAVEPOINT fill_row");
        try {
          const { rows } = await client.query(
            `INSERT INTO "${table}" (${values.map(([name]) => `"${name}"`).join(", ")})
             VALUES (${values.map((_, n) => `$${n + 1}`).join(", ")}) RETURNING id`,
            values.map(([, value]) => value),
          );
          await client.query("RELEASE SAVEPOINT fill_row");
          ids.push(rows[0].id);
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT fill_row");
          if (error.code !== "23505" || !ids.length) throw new Error(`Filling ${table}: ${error.message}`);
        }
      }
      inserted.set(table, ids);
      remaining.delete(table);
    }
  }
  return [...inserted.values()].reduce((sum, ids) => sum + ids.length, 0);
}

/**
 * Builds `release`'s database in its own scratch database, fills it, upgrades it to this
 * checkout, and checks the result. Throws with the release in the message on any failure.
 */
async function upgradeFrom(release, server, base, work) {
  const name = scratchDatabaseName(release);
  const scratch = new URL(base);
  scratch.pathname = `/${name}`;
  const url = scratch.toString();
  const step = (what, result) => {
    if (result.status !== 0) throw new Error(`${what} failed:\n${result.stdout}${result.stderr}`);
  };

  const releaseDir = path.join(work, release, "prisma");
  mkdirSync(path.join(work, release));
  execFileSync("sh", ["-c", `git archive ${release} prisma | tar -x -C "${path.join(work, release)}"`], { cwd: root });

  await dropScratch(server, name);
  await server.query(`CREATE DATABASE ${name}`);
  try {
    step(
      `Building the ${release} database`,
      prisma(work, url, `${release}-release`, path.join(releaseDir, "schema.prisma"), path.join(releaseDir, "migrations"), ["migrate", "deploy"]),
    );

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    let filled;
    let before;
    try {
      // The same guard as resetDatabase: never fill anything but this run's scratch database.
      const { rows } = await client.query("SELECT current_database() AS name");
      if (rows[0].name !== name) throw new Error(`Refusing to fill ${rows[0].name}; expected ${name}.`);
      await client.query("BEGIN");
      filled = await fillEveryTable(client);
      await client.query("COMMIT");
      before = await rowCounts(client);
    } finally {
      await client.end();
    }

    const schema = path.join(root, "prisma/schema.prisma");
    const migrations = path.join(root, "prisma/migrations");
    step("Applying the current migrations", prisma(work, url, `${release}-current`, schema, migrations, ["migrate", "deploy"]));

    const upgraded = new pg.Client({ connectionString: url });
    await upgraded.connect();
    const after = await rowCounts(upgraded);
    await upgraded.end();
    const lost = Object.entries(before)
      .filter(([table, count]) => table in after && after[table] < count)
      .map(([table, count]) => `${table} ${count} → ${after[table]}`);
    const total = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (lost.length || total(after) < total(before)) {
      throw new Error(`Rows were lost: ${lost.join(", ") || `${total(before)} → ${total(after)} in all`}.`);
    }

    const drift = prisma(work, url, `${release}-diff`, schema, migrations, [
      "migrate", "diff", "--from-config-datasource", "--to-schema", schema, "--exit-code",
    ]);
    if (drift.status !== 0) {
      throw new Error(`The upgraded database does not match prisma/schema.prisma:\n${drift.stdout}${drift.stderr}`);
    }
    return { filled, tables: Object.keys(before).length };
  } finally {
    await dropScratch(server, name);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  applyDatabaseUrl();
  const base = new URL(process.env.DATABASE_URL);
  const admin = new URL(base);
  admin.pathname = "/postgres";

  let starts;
  if (options.from) {
    starts = [options.from];
  } else {
    const all = supportedReleases(parseReleaseTags(git("ls-remote", "--tags", "origin", "v*")), git("rev-parse", "HEAD"));
    if (!all.length) throw new Error("No release tag found on origin.");
    starts = options.latest ? all.slice(-1) : all;
  }
  git("fetch", "--quiet", "--depth=1", "origin", "--no-tags", ...starts.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`));

  // Releases with the same migrations build the same database: upgrade each set once.
  const byMigrations = new Map();
  for (const tag of starts) {
    const tree = git("rev-parse", `${tag}:prisma/migrations`);
    byMigrations.set(tree, [...(byMigrations.get(tree) ?? []), tag]);
  }
  const groups = [...byMigrations.values()];
  console.log(
    `Upgrading ${starts.length} release${starts.length === 1 ? "" : "s"} (${groups.length} distinct migration histories) to this checkout: ${starts.join(", ")}.`,
  );

  const work = mkdtempSync(path.join(tmpdir(), "familyfi-upgrade-"));
  const server = new pg.Client({ connectionString: admin.toString() });
  await server.connect();
  const started = Date.now();
  try {
    for (const [release, ...same] of groups) {
      const at = Date.now();
      try {
        const { filled, tables: count } = await upgradeFrom(release, server, base, work);
        const seconds = ((Date.now() - at) / 1000).toFixed(1);
        console.log(`✓ ${release}: ${filled} rows in ${count} tables upgraded, no rows lost, schema matches (${seconds}s).`);
        for (const tag of same) console.log(`✓ ${tag}: same migrations as ${release}.`);
      } catch (error) {
        throw new Error(`✗ Upgrading from ${release} failed. ${error instanceof Error ? error.message : error}`);
      }
    }
  } finally {
    await server.end();
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`Every start release upgraded (${((Date.now() - started) / 1000).toFixed(1)}s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
