/**
 * AGENTS.md: before a PR, the `reviewer` subagent reviews the change. Claude reads it from
 * `.claude/agents/reviewer.md` and Codex from `.codex/agents/reviewer.toml`; the two must
 * give the same instructions, or one tool's review quietly checks less than the other's.
 * Every other subagent (`crash-hunter`, `bug-hunter`) follows the same rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
const agentNames = (dir: string, extension: string) =>
  readdirSync(path.join(repoRoot, dir))
    .filter((file) => file.endsWith(extension))
    .map((file) => file.slice(0, -extension.length))
    .sort();

function claudeAgent(name: string) {
  const [, frontmatter, body] = read(`.claude/agents/${name}.md`).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
  const field = (key: string) => frontmatter.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];
  return {
    name: field("name"),
    description: field("description"),
    permissionMode: field("permissionMode"),
    instructions: body.trim(),
  };
}

function codexAgent(name: string) {
  const toml = read(`.codex/agents/${name}.toml`);
  const field = (key: string) => toml.match(new RegExp(`^${key} = "(.*)"$`, "m"))?.[1];
  const instructions = toml.match(/^developer_instructions = """\n([\s\S]*?)"""$/m)?.[1];
  return {
    name: field("name"),
    description: field("description"),
    sandbox: field("sandbox_mode"),
    instructions: instructions?.trim(),
  };
}

const agents = agentNames(".claude/agents", ".md");

describe("subagents (AGENTS.md)", () => {
  it("defines every subagent for both Claude and Codex", () => {
    expect(agents).toEqual(expect.arrayContaining(["bug-hunter", "crash-hunter", "reviewer"]));
    expect(agentNames(".codex/agents", ".toml")).toEqual(agents);
  });

  it.each(agents)("gives Claude and Codex the same %s", (name) => {
    const claude = claudeAgent(name);
    const codex = codexAgent(name);
    expect(claude.name).toBe(name);
    expect(codex.name).toBe(name);
    expect(codex.description).toBe(claude.description);
    expect(claude.instructions).toBeTruthy();
    expect(codex.instructions).toBe(claude.instructions);
  });

  it.each(agents)("keeps the Codex %s read-only", (name) => {
    expect(codexAgent(name).sandbox).toBe("read-only");
  });

  it.each(["bug-hunter", "crash-hunter"])("keeps the Claude %s in plan mode", (name) => {
    expect(claudeAgent(name).permissionMode).toBe("plan");
  });
});
