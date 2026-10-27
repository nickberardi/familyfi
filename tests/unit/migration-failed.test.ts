import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import packageJson from "../../package.json";

const script = path.resolve(__dirname, "../../scripts/runtime/migration-failed.sh");

describe("the entrypoint's help when a migration fails", () => {
  let work: string;
  let backups: string;
  let bin: string;

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), "familyfi-migration-failed-"));
    backups = path.join(work, "backups");
    bin = path.join(work, "bin");
    mkdirSync(backups);
    mkdirSync(bin);
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  /** A stand-in psql that answers the failed migration's name, or fails as an unreachable database does. */
  function psql(answer: string | null) {
    const file = path.join(bin, "psql");
    writeFileSync(file, answer === null ? "#!/bin/sh\nexit 2\n" : `#!/bin/sh\necho ${answer}\n`);
    chmodSync(file, 0o755);
  }

  function backup(name: string, secondsAgo: number) {
    const file = path.join(backups, name);
    writeFileSync(file, "");
    const at = Date.now() / 1000 - secondsAgo;
    utimesSync(file, at, at);
    return file;
  }

  const run = () => {
    const result = spawnSync("sh", [script, backups], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, DATABASE_URL: "postgresql://familyfi@db/familyfi" },
    });
    expect(result.status).toBe(0);
    return result.stdout;
  };

  it("names the failed step and the way back to the release the newest backup came from", () => {
    psql("20261026120000_policy_operation_prune_index");
    backup("familyfi-v0.33.0-20261019T000000Z.dump", 600);
    const newest = backup("familyfi-v0.34.0-20261026T000000Z.dump", 60);

    const out = run();
    expect(out).toContain(`FamilyFi ${packageJson.version} could not update its database, so it has not started.`);
    expect(out).toContain("The step that failed is 20261026120000_policy_operation_prune_index");
    expect(out).toContain("The newest backup was taken 2026-10-26 00:00 UTC. If that was before this update");
    expect(out).toContain("  1. docker compose stop app");
    expect(out).toContain(
      `  2. docker compose run --rm --no-deps -T --entrypoint /app/scripts/runtime/restore-database.sh app ${newest}`,
    );
    // No image is tagged with its version: each release's notes name its image by digest.
    expect(out).toContain("  3. Add FAMILYFI_IMAGE=ghcr.io/nickberardi/familyfi@sha256:<digest> to .env, the image the notes of");
    expect(out).toContain("     https://github.com/nickberardi/familyfi/releases/tag/v0.34.0 name");
    expect(out).toContain("  4. docker compose up -d app");
  });

  it("says where the backup would be when there is none from before this update", () => {
    psql("20261026120000_policy_operation_prune_index");
    // Taken by this release before an earlier update: not a way back from this one.
    backup(`familyfi-v${packageJson.version}-20261020T000000Z.dump`, 60);
    const out = run();
    expect(out).toContain(`No backup from before this update is in ${backups}.`);
    expect(out).not.toContain("docker compose run");
  });

  it("offers no rollback when no migration failed, such as when the database refused the connection", () => {
    psql(null);
    backup("familyfi-v0.34.0-20261026T000000Z.dump", 60);
    const out = run();
    expect(out).toContain("could not update its database, so it has not started.");
    expect(out).not.toContain("The step that failed");
    expect(out).not.toContain("docker compose run");
  });
});
