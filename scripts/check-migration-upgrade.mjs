#!/usr/bin/env node
/**
 * Upgrades a database built by the last release to the current migrations, the way every
 * household upgrades. It builds a scratch database from the release's own migrations,
 * puts one row in every table, applies today's migrations, and fails if a migration
 * errors, loses rows, or leaves the database different from prisma/schema.prisma.
 *
 * The rows are generated from the release's schema as read from PostgreSQL, so nothing
 * here is written for any one version. Pass a tag to upgrade from that release; by
 * default it is the newest v* tag that is not a pre-release.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyDatabaseUrl } from "./print-database-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_DB = "familyfi_upgrade_check";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** The newest release before this commit: a release run tests the upgrade to its own tag. */
function latestRelease() {
  const head = git("rev-parse", "HEAD");
  const commits = new Map();
  for (const line of git("ls-remote", "--tags", "origin", "v*").split("\n")) {
    const [sha, ref] = line.split("\t");
    const tag = ref?.replace("refs/tags/", "").replace("^{}", "");
    // An annotated tag is listed twice; its peeled `^{}` line names the commit.
    if (tag && (ref.endsWith("^{}") || !commits.has(tag))) commits.set(tag, sha);
  }
  const tags = [...commits].filter(([tag, sha]) => !tag.includes("-") && sha !== head).map(([tag]) => tag);
  const version = (tag) => tag.slice(1).split(".").map(Number);
  tags.sort((a, b) => {
    const [x, y] = [version(a), version(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  if (!tags.length) throw new Error("No release tag found on origin.");
  return tags.at(-1);
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

/** A value of the column's type, or null to let a nullable or defaulted column be. */
async function sampleValue(client, table, column, references) {
  const reference = references.get(column.name);
  if (reference) return reference;
  if (column.nullable || column.hasDefault) return null;
  if (column.dataType === "ARRAY") return "{}";
  if (column.dataType === "USER-DEFINED") {
    const { rows } = await client.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
      [column.udt],
    );
    return rows[0].enumlabel;
  }
  if (/^(int|numeric|float)/.test(column.udt)) return 1;
  if (column.udt === "bool") return true;
  if (/^(timestamp|date)/.test(column.udt)) return new Date();
  if (/^json/.test(column.udt)) return "{}";
  if (column.udt === "bytea") return Buffer.from([0]);
  return `upgrade-${table}-${column.name}`;
}

/** One row in every table, parents before children, so every foreign key has a target. */
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
                is_nullable = 'YES' AS nullable, column_default IS NOT NULL AS "hasDefault"
         FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );
      const references = new Map(
        keys.filter((key) => key.child === table && key.parent !== table).map((key) => [key.column, inserted.get(key.parent)]),
      );
      const values = [];
      for (const column of columns) {
        const value = await sampleValue(client, table, column, references);
        if (value !== null) values.push([column.name, value]);
      }
      const { rows } = await client.query(
        `INSERT INTO "${table}" (${values.map(([name]) => `"${name}"`).join(", ")})
         VALUES (${values.map((_, n) => `$${n + 1}`).join(", ")}) RETURNING id`,
        values.map(([, value]) => value),
      );
      inserted.set(table, rows[0].id);
      remaining.delete(table);
    }
  }
  return inserted.size;
}

async function main() {
  applyDatabaseUrl();
  const base = new URL(process.env.DATABASE_URL);
  const scratch = new URL(base);
  scratch.pathname = `/${SCRATCH_DB}`;
  const url = scratch.toString();
  const admin = new URL(base);
  admin.pathname = "/postgres";

  const release = process.argv[2] || latestRelease();
  git("fetch", "--quiet", "--depth=1", "origin", "tag", release, "--no-tags");
  const work = mkdtempSync(path.join(tmpdir(), "familyfi-upgrade-"));
  mkdirSync(path.join(work, "release"));
  execFileSync("sh", ["-c", `git archive ${release} prisma | tar -x -C "${path.join(work, "release")}"`], { cwd: root });
  console.log(`Upgrading a database built by ${release} to this checkout's migrations.`);

  const server = new pg.Client({ connectionString: admin.toString() });
  await server.connect();
  await server.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await server.query(`CREATE DATABASE ${SCRATCH_DB}`);

  const fail = async (message) => {
    await server.end();
    console.error(message);
    process.exit(1);
  };
  const step = (name, result) => {
    if (result.status === 0) return true;
    console.error(`${name} failed:\n${result.stdout}${result.stderr}`);
    return false;
  };

  const releaseDir = path.join(work, "release/prisma");
  if (!step(`${release} migrations`, prisma(work, url, "release", path.join(releaseDir, "schema.prisma"), path.join(releaseDir, "migrations"), ["migrate", "deploy"]))) {
    await fail(`Could not build the ${release} database.`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const filled = await fillEveryTable(client);
  const before = await rowCounts(client);
  await client.end();
  console.log(`Put a row in each of ${filled} tables.`);

  const schema = path.join(root, "prisma/schema.prisma");
  const migrations = path.join(root, "prisma/migrations");
  if (!step("Current migrations", prisma(work, url, "current", schema, migrations, ["migrate", "deploy"]))) {
    await fail(`Upgrading from ${release} failed.`);
  }

  const upgraded = new pg.Client({ connectionString: url });
  await upgraded.connect();
  const after = await rowCounts(upgraded);
  await upgraded.end();
  const lost = Object.entries(before)
    .filter(([table, count]) => table in after && after[table] < count)
    .map(([table, count]) => `${table} ${count} → ${after[table]}`);
  const total = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (lost.length || total(after) < total(before)) {
    await fail(`Upgrading from ${release} lost rows: ${lost.join(", ") || `${total(before)} → ${total(after)} in all`}.`);
  }

  const drift = prisma(work, url, "current-diff", schema, migrations, [
    "migrate", "diff", "--from-config-datasource", "--to-schema", schema, "--exit-code",
  ]);
  if (drift.status !== 0) {
    await fail(`After upgrading from ${release} the database does not match prisma/schema.prisma:\n${drift.stdout}${drift.stderr}`);
  }

  await server.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await server.end();
  console.log(`Upgraded from ${release}: every migration applied, no rows lost, schema matches.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
