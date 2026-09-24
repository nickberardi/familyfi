#!/usr/bin/env node
/**
 * Stryker's Vitest runner (10.0.0) picks the tests for each mutant with a name pattern
 * built by joining a test's describe blocks and title with spaces. Vitest 5 matches that
 * pattern against the name joined with " > ", so it matches nothing, no test runs, and
 * every mutant is reported as surviving. This joins the parts the way Vitest 5 does, in
 * both copies of the function: the runner's, and the one inlined into the setup file
 * that records coverage inside the test worker. The two must agree.
 *
 * Run before `stryker run`. It is idempotent, and it fails if the line it fixes is gone:
 * that means Stryker changed these files, so check whether they now match Vitest and
 * delete this script if they do.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "node_modules/@stryker-mutator/vitest-runner/dist/src");
const spaced = "return nameParts.join(' ').trim();";
const vitest = "return nameParts.filter((part) => part).join(' > ');";

for (const name of ["test-helpers.js", "stryker-setup.js"]) {
  const file = path.join(dist, name);
  const source = readFileSync(file, "utf8");
  if (source.includes(vitest)) continue;
  if (!source.includes(spaced)) {
    console.error(`${file} no longer builds test names the way scripts/stryker-vitest-names.mjs expects; see its comment.`);
    process.exit(1);
  }
  writeFileSync(file, source.replace(spaced, vitest));
}
