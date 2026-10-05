#!/usr/bin/env node
/**
 * Copies canonical agent instructions to each tool's own file so agents stay aligned.
 *
 * PURPOSE: One source per topic prevents drift between Claude Code, Codex, Copilot,
 * Cursor and Antigravity, which each read instructions from a different path.
 *
 * VALUE: Edit `AGENTS.md` or `.claude/agents/*.md` once, run `npm run sync:agent-instructions`,
 * commit the source and the generated copies together. `--check` (used in CI) fails when a
 * generated copy is stale instead of writing it.
 *
 * Example:
 *   - `AGENTS.md` → `CLAUDE.md`, `.github/copilot-instructions.md` (Codex, Cursor and
 *     Antigravity read `AGENTS.md` directly).
 *   - `.claude/agents/use-mermaid-runtime.md` → `.codex/agents/use-mermaid-runtime.toml`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_SOURCE = path.join(REPO_ROOT, "AGENTS.md");
const CLAUDE_AGENTS_DIR = path.join(REPO_ROOT, ".claude", "agents");
const CODEX_AGENTS_DIR = path.join(REPO_ROOT, ".codex", "agents");

/** Command that regenerates every copy; shown in banners and in `--check` failures. */
const SYNC_COMMAND = "npm run sync:agent-instructions";

/** Banner prepended to `AGENTS.md` copies so editors know not to edit them directly. */
const AGENTS_GENERATED_BANNER = `<!-- Synced from AGENTS.md. Edit AGENTS.md only, then: ${SYNC_COMMAND} -->\n\n`;

/** Files that receive a verbatim copy of `AGENTS.md` (plus the banner). */
const AGENTS_TARGETS = [path.join(REPO_ROOT, "CLAUDE.md"), path.join(REPO_ROOT, ".github", "copilot-instructions.md")];

const isCheckMode = process.argv.includes("--check");

/**
 * Normalises line endings so a Windows checkout (`core.autocrlf`) never reads as drift.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Writes a generated file, or in `--check` mode reports whether it is stale.
 *
 * @param {string} target Absolute path of the generated file.
 * @param {string} content Expected content (LF line endings).
 * @returns {boolean} `true` when the file already matched.
 */
function syncGeneratedFile(target, content) {
  const relative = path.relative(REPO_ROOT, target);
  const current = fs.existsSync(target) ? normalizeNewlines(fs.readFileSync(target, "utf8")) : null;
  if (current === content) {
    if (!isCheckMode) console.log(`Up to date ${relative}`);
    return true;
  }
  if (isCheckMode) {
    console.error(`Stale ${relative}`);
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  console.log(`Wrote ${relative}`);
  return true;
}

/**
 * Splits a Claude subagent file into its frontmatter fields and Markdown body.
 *
 * @param {string} source Full `.claude/agents/*.md` text.
 * @param {string} fileName For error messages.
 * @returns {{ name: string, description: string, body: string }}
 */
function readClaudeAgent(source, fileName) {
  const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${fileName}: missing --- frontmatter ---`);
  const [, frontmatter, body] = match;
  const readField = (field) => {
    const line = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(frontmatter);
    if (!line) throw new Error(`${fileName}: frontmatter has no "${field}"`);
    return line[1].trim();
  };
  return { name: readField("name"), description: readField("description"), body };
}

/**
 * Escapes text for a TOML basic string (single-line or `"""` multi-line).
 *
 * @param {string} text
 * @param {boolean} multiline Keep raw newlines (multi-line string) instead of escaping them.
 * @returns {string}
 */
function escapeTomlString(text, multiline) {
  const escaped = text.replace(/\\/g, "\\\\");
  return multiline ? escaped.replace(/"""/g, '""\\"') : escaped.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Renders a Claude subagent as a Codex custom-agent TOML file.
 *
 * @param {{ name: string, description: string, body: string }} agent
 * @returns {string}
 */
function renderCodexAgent(agent) {
  return [
    `name = "${escapeTomlString(agent.name, false)}"`,
    `description = "${escapeTomlString(agent.description, false)}"`,
    `developer_instructions = """`,
    `${escapeTomlString(agent.body.replace(/\n+$/, ""), true)}"""`,
    "",
  ].join("\n");
}

let allInSync = true;

const agentsBody = normalizeNewlines(fs.readFileSync(AGENTS_SOURCE, "utf8"));
for (const target of AGENTS_TARGETS) {
  allInSync = syncGeneratedFile(target, AGENTS_GENERATED_BANNER + agentsBody) && allInSync;
}

const claudeAgentFiles = fs.existsSync(CLAUDE_AGENTS_DIR)
  ? fs.readdirSync(CLAUDE_AGENTS_DIR).filter((file) => file.endsWith(".md"))
  : [];
for (const file of claudeAgentFiles) {
  const agent = readClaudeAgent(normalizeNewlines(fs.readFileSync(path.join(CLAUDE_AGENTS_DIR, file), "utf8")), file);
  const target = path.join(CODEX_AGENTS_DIR, file.replace(/\.md$/, ".toml"));
  allInSync = syncGeneratedFile(target, renderCodexAgent(agent)) && allInSync;
}

if (!allInSync) {
  console.error(`Agent instruction copies are stale. Run: ${SYNC_COMMAND}`);
  process.exit(1);
}
