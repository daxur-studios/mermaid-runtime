# Agent setup and daemon inventory

Date: 2026-10-05. Status: Agent instructions set up and checked in CI; daemon inventory recorded, nothing moved yet; Mermaid config-cache bug fixed.

Source: User request after the group-layout work. Related: [AGENTS.md](../../AGENTS.md), [Daemon extraction candidates](../plans/09_daemon-extraction-candidates.md), [Repository baseline](02_repository-baseline.md).

## Request (user-reported)

1. Make the agent instructions clear about runbooks and plans, and keep them in sync across Claude, Codex, Antigravity and other tools, like Daxur Daemon does.
2. Put standards in place, e.g. for Angular.
3. The daemon's Kanban page shows small live mini-flows. Check whether that and other daemon parts the user likes are in the library yet.

## Before (code-verified)

- No `AGENTS.md`, `CLAUDE.md` or Copilot/Cursor rules. The runbook convention lived only in the [runbook index](00_index.md#working-convention), which agents don't load automatically.
- The consumer guide existed twice, `.claude/agents/use-mermaid-runtime.md` and `.codex/agents/use-mermaid-runtime.toml`, copied by hand (still identical, but missing `groupArrangement`).
- The daemon has `AGENTS.md` copied to `CLAUDE.md` and `.github/copilot-instructions.md` by `npm run sync:agent-instructions --prefix cli`, plus Cursor `.mdc` pointer rules. Nothing checks that the copies stay current.

## Set up

| File | Role |
| --- | --- |
| `AGENTS.md` | Source of truth: repo map, runbook/plan duties, library rules, validation, consumers, git safety |
| `CLAUDE.md`, `.github/copilot-instructions.md` | Generated from `AGENTS.md` with a "don't edit" banner |
| `.codex/agents/*.toml` | Now generated from `.claude/agents/*.md`, so the consumer guide has one source |
| `.cursor/rules/*.mdc` | Pointers: always-apply standards, plus Angular rules for `projects/**` |
| [`docs/agent-standards.md`](../agent-standards.md) | Naming, JSDoc, constants, and a **terms** table (group vs drill-down subgraph, structural render vs status update, …) |
| [`docs/angular-standards.md`](../angular-standards.md) | Daemon rules 1–8, plus library rules: zoneless-safe, theming tokens, Mermaid render path, public API |
| `scripts/sync-agent-instructions.mjs` | `npm run sync:agent-instructions` writes copies; `npm run check:agent-instructions` fails on drift |
| `.github/workflows/test.yml` | Runs the check after `npm ci` |

Differences from the daemon's setup: CI catches stale copies, the Codex agent file is generated too, and copies are compared with normalised line endings (Windows `autocrlf`). Codex, Cursor and Antigravity read `AGENTS.md` directly, so they need no copy.

Validation: the generator reproduced the existing Codex file byte for byte, plus the new paragraph. A hand-edited `CLAUDE.md` makes `--check` exit 1; re-running the sync restores it.

## Code against the new Angular standards (code-verified)

| Rule | State |
| --- | --- |
| `@if`/`@for`, `input()`/`output()`, `inject()` | Fully followed: 0 legacy uses |
| OnPush in library | 10 of 11 components (`task-graph-replay.component.ts` lacks it) |
| Separate files | Library yes; 5 older demo pages have inline templates |
| Reactive forms | Demo `work-e2e.page.html` uses `ngModel` |
| Zoneless | Library must support it (daemon is zoneless), but the demo runs with Zone.js, so tests don't catch zone reliance |

All of these are left as they are (migrate-when-touched). Switching the demo to zoneless is a candidate in [plan 09](../plans/09_daemon-extraction-candidates.md).

## Finding: Mermaid config cache

**Code-verified, fixed 2026-10-05.** `graph-canvas.component.ts`, `graph-preview-mermaid.component.ts` and `graph-preview-simple.component.ts` each defined their own `ensureMermaidConfigured` with **their own** "last applied config" variable, but Mermaid's config is one global.

Failure scenario: a page shows a canvas and a simple preview. The canvas applies its config (canvas key = A). The preview applies its compact config with `htmlLabels: false` (global = B). The canvas re-renders: its own key still says A, so it skips `initialize()` and renders with B. Labels and spacing come out wrong.

### Fix (code-verified)

| Change | Where |
| --- | --- |
| One `ensureMermaidConfigured` and one `activeMermaidConfigKey`, keyed by `readMermaidRuntimeConfigKey` | New `projects/mermaid-runtime/src/lib/mermaid-config.ts` |
| Local copies and cache variables removed; all three import the shared function | `graph-canvas.component.ts`, `graph-preview-mermaid.component.ts`, `graph-preview-simple.component.ts` |
| Unit test: A → B → A calls `mermaid.initialize` 3 times; the same config twice calls it once | `mermaid-config.spec.ts` (spies on `mermaid.initialize`) |

`mermaid.initialize` is now called only from `mermaid-config.ts`. Not exported from `public-api.ts`; no public API, default or rendered output change for hosts that use one config.

Validation: `npm run build` passed; `npm run test:unit` 12/12 (incl. the 2 new specs); `npm run test:e2e` 12/12.

Limits: no e2e asserts canvas + standalone preview with different configs on one page; the unit test covers the cache logic. The canvas's own subgraph previews (`GraphPreviewSimpleComponent`) were already the mixed-config case, and those e2e paths pass.

## Daemon inventory (code-verified)

The Kanban mini-flows **are already in the library**: `KanbanTaskCardComponent` renders `<mr-graph-preview mode="simple" direction="LR">`. They stay live because the board passes a new graph object on each run-doc update, and the preview recolours in place without re-laying out.

What the daemon still does itself:

| Daemon part | What it does | Fit for the library? |
| --- | --- | --- |
| `kanban-board.ts` `toIdleGraph` | Resets a finished run's statuses so the card shows the task's "template" shape | Yes, as a small helper or preview input |
| `kanban-board.ts` `nodeProgress` / `hasNodes` | Percent of nodes complete, for the card's progress bar | Yes, as a helper (and optionally a built-in preview progress bar) |
| `kanban-task-card.scss` | Re-declares `--app-color-*` so preview colours match the card palette | Signals the preview's defaults don't match hosts; document or align |
| `task-graph-execution-adapter.ts` | Maps daemon records to `MermaidRuntime`; keeps one edge per node pair by priority; hides noisy labels | Mapping stays in the daemon; edge de-duplication could be a generic option |
| `task-live-page.ts` | Decorations (diamond, subroutine), `statusStyles` for a custom status, a subgraph resolver | Already uses library seams; stays |
| `shared/graph-*-overlay`, `graph-inspector-panel` | Place minimap, camera controls and inspector into the daemon's shell | Daemon shell wiring via the library's `*Placement="host"` seams; stays |
| `features/mermaid-runtime-lab` | Fixtures for nested and wide graphs | Overlaps the library demo; could move there |
| `cli/.../task-run-store.ts` `deriveChildRunProgress` | Rolls a child run up for its parent node: `progressPercent` = settled ÷ total nodes, `progressLabel` = first running node, `activeChildNodeProgresses` = each running node's % | Yes, as a pure helper; today only the daemon backend computes it |

**Multi-ring progress (code-verified):** the *drawing* is already in the library. `graph-canvas` draws `progressPercent` as a ring tracing the node's shape, and each entry of `activeChildNodeProgresses` as an extra, fainter ring 4 px further out, with text such as `50% | 20% | 90%`. The inspector shows the same values. Gaps:
- the roll-up from a subgraph's nodes is daemon-only, so other hosts must compute it themselves. The demo's subflows compute only the overall % (by hand, with a hard-coded node count) and never set `activeChildNodeProgresses`, so the demo never shows the extra rings;
- `mr-graph-preview` (Kanban) draws no progress;
- there is no host switch to show the overall ring without the running-node rings;
- it is not in the README, and the stack offset and opacity are unnamed constants inside the function.

All of these, plus the label overlap, finished-node ring and dark-mode tooltip, are tracked in [plan 11](../plans/11_node-progress-and-overlay-fixes.md).

## Next

- User picks from [plan 09](../plans/09_daemon-extraction-candidates.md).
- ~~Fix the config cache (small, independent).~~ Done: [fix](#fix-code-verified).
