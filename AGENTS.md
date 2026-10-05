# Mermaid Runtime — agent instructions

Shared rules for every coding agent working in this repo: **Claude Code**, **Codex**, **GitHub Copilot**, **Cursor** and **Antigravity (`agy`)**.

`@daxur-studios/mermaid-runtime` is a public Angular 20 library that renders live task graphs (Mermaid flowcharts with pan/zoom, status colours, groups, drill-down, replay and previews). The repo holds the library, a demo app and the tests.

| Path | What it is |
| --- | --- |
| `projects/mermaid-runtime/` | The library. Public surface: `src/public-api.ts` |
| `projects/demo/` | Demo app (`npm run demo`), also the Playwright test host |
| `e2e/` | Playwright browser tests |
| `docs/runbook/`, `docs/plans/` | What happened and what's next (see below) |
| `.claude/agents/use-mermaid-runtime.md` | Guide for agents **consuming** the library in another app |

## Instruction files

| File | Read by | Edit? |
| --- | --- | --- |
| `AGENTS.md` (this file) | Codex, Cursor, Antigravity, Copilot | **Source of truth** |
| `CLAUDE.md`, `.github/copilot-instructions.md` | Claude Code, Copilot | Generated |
| `.claude/agents/*.md` | Claude Code subagents | **Source of truth** |
| `.codex/agents/*.toml` | Codex custom agents | Generated |
| `.cursor/rules/*.mdc` | Cursor | Short pointers to these docs |
| [`docs/agent-standards.md`](docs/agent-standards.md) | Everyone | Naming, JSDoc, constants, terminology |
| [`docs/angular-standards.md`](docs/angular-standards.md) | Everyone | Angular and styling rules |

After editing `AGENTS.md` or `.claude/agents/*.md`, run `npm run sync:agent-instructions` and commit the source and generated files together. CI runs `npm run check:agent-instructions` and fails when a copy is stale.

## Before you edit

1. Read the [runbook index](docs/runbook/00_index.md): its session ledger is the latest state of the work.
2. Open the plan that covers your task in the [plan index](docs/plans/00_index.md), if one exists.
3. Read [`docs/agent-standards.md`](docs/agent-standards.md) and [`docs/angular-standards.md`](docs/angular-standards.md).
4. Ask the user when terminology or the intended look is unclear. Don't guess on UX.

## Runbook and plans

The full convention is in the [runbook index](docs/runbook/00_index.md#working-convention). The rules you must follow:

- **Runbook** (`docs/runbook/NN_name.md`) records what was discussed, found, tried and decided. **Plans** (`docs/plans/NN_name.md`) describe work still to do. Numbering starts at `00` in each folder; never renumber existing files.
- **When a session finds or decides something**, write it down: a new runbook entry, or an added section in the active one. Label claims **user-reported**, **code-verified**, **proposed** or **open**.
- **When you implement plan work**, record in the runbook what changed, how it was validated, and its limits. Then update the plan's `Status` line. Never mark work done from docs alone.
- **Before you finish a session**, add a row to the runbook index's session ledger (date, work, outcome linked to the entry, next step) and add any new docs to both indexes.
- **Design questions get option papers**: 3–4 genuinely different options, each with how / cost / what it gives up, then one recommendation and open questions. Don't narrow to one path before the user picks.
- Every plan links back to its runbook source; runbook entries link to their plan. Keep docs compact: tables and short bullets over prose.
- This repo is **public**: keep examples synthetic. No private paths, hostnames, company names or real work data in docs, code or tests.

## Library rules

- **Host-agnostic.** No consumer-specific types or names in the library. Hosts adapt their data to `MermaidRuntime.*` (see the daemon's execution adapter pattern in [runbook 06](docs/runbook/06_agent-setup-and-daemon-inventory.md)).
- **Public API** is only what `src/public-api.ts` exports. Data types live in the `MermaidRuntime` namespace (`task-graph-model.ts`). Selectors use the `mr-` prefix.
- **Additive by default.** New behaviour arrives as an input with a safe default. If a default changes existing hosts' output, say so in the runbook entry and the README.
- **When the public API changes**, update the [README](README.md) and `.claude/agents/use-mermaid-runtime.md` in the same change, then run the sync.
- **Show it in the demo.** New capabilities get a demo page or control, so the user can try them at `npm run demo`.
- **Status updates never re-render Mermaid**: they toggle classes on the existing SVG. Only structural changes (nodes, edges, groups, direction, arrangement) re-render.

## Validate

| Command | When |
| --- | --- |
| `npm run build` | Every library change |
| `npm run demo:build` | Demo or public API changes |
| `npm run test:unit` | Every library change (Karma, ChromeHeadless) |
| `npm run test:e2e` | Rendering, layout, camera or navigation changes (Playwright starts the demo itself) |
| `npm run check:agent-instructions` | After touching agent instruction files |

- Report results as they are: failing tests with their output, skipped steps as skipped.
- Rendering waits on `requestAnimationFrame`. A hidden or background browser pane never fires it, so renders stall in "settling". Check visuals with headless Playwright instead.
- Layout changes: record measured SVG sizes (before/after) in the runbook, as in [runbook 05](docs/runbook/05_group-layout-spike.md).

## Consumers

The main consumer is **Daxur Daemon** (Angular 20, zoneless). It installs a packed tarball via `npm run deploy` (consumer path in the gitignored `scripts/deploy.local.json`). Before changing a default or removing an API, search the consumer's usage and note the impact in the runbook. Daemon parts that may move into this library are tracked in [plan 09](docs/plans/09_daemon-extraction-candidates.md).

## Git safety — never destroy uncommitted work

Several agents and the human may share this working tree at the same time. Treat every file you didn't write this session as someone else's work in progress.

- **Forbidden:** `git stash` (any form), `git reset --hard`/`--merge`/`--keep`, `git checkout -- <path>`, `git checkout .`, `git restore` (any form), `git clean -f*`, `git rm` / recursive deletes of tracked files, `git push --force`/`--force-with-lease`, `git branch -D`/`-f`, `git rebase`, `git commit --amend` on shared branches, switching branches with a dirty tree.
- **Allowed:** read-only commands (`status`, `diff`, `log`, `show`, `blame`); `git add <specific paths>` + `git commit` for files **you** edited (never `git add .` or `-A`); `git switch -c <new-branch>`; `git pull --ff-only` on a clean tree.
- Commit or push only when the user asks.
- **If a dirty tree blocks you**, stop and ask the human. Don't tidy up.
