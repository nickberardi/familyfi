/**
 * AGENTS.md: before a PR, the `reviewer` subagent reviews the change. Claude reads it from
 * `.claude/agents/reviewer.md` and Codex from `.codex/agents/reviewer.toml`; the two must
 * give the same instructions, or one tool's review quietly checks less than the other's.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

function claudeReviewer() {
  const [, frontmatter, body] = read(".claude/agents/reviewer.md").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  const field = (key: string) => frontmatter.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];
  return { name: field("name"), description: field("description"), instructions: body.trim() };
}

function codexReviewer() {
  const toml = read(".codex/agents/reviewer.toml");
  const field = (key: string) => toml.match(new RegExp(`^${key} = "(.*)"$`, "m"))?.[1];
  const instructions = toml.match(/^developer_instructions = """\n([\s\S]*?)"""$/m)?.[1];
  return {
    name: field("name"),
    description: field("description"),
    sandbox: field("sandbox_mode"),
    instructions: instructions?.trim(),
  };
}

describe("reviewer subagent (AGENTS.md)", () => {
  it("gives Claude and Codex the same reviewer", () => {
    const claude = claudeReviewer();
    const codex = codexReviewer();
    expect(claude.name).toBe("reviewer");
    expect(codex.name).toBe("reviewer");
    expect(codex.description).toBe(claude.description);
    expect(claude.instructions).toBeTruthy();
    expect(codex.instructions).toBe(claude.instructions);
  });

  it("keeps the Codex reviewer read-only", () => {
    expect(codexReviewer().sandbox).toBe("read-only");
  });
});
