# Daemon extraction candidates — options

Date: 2026-10-05. Status: Draft (option paper; waiting for the user's pick). Config-cache item done.

Source: [Agent setup and daemon inventory](../runbook/06_agent-setup-and-daemon-inventory.md#daemon-inventory-code-verified). Related: [Roadmap](00_index.md), [Live run observability](06_live-run-observability-options.md).

## Problem

The user likes parts of the daemon's graph UI, mainly the Kanban mini-flows (small nodes that update live), and wants them reusable, e.g. for the work e2e runner's run list. The preview itself is already in the library (`mr-graph-preview`). What's still daemon code is the glue around it: the idle "template" view, the progress percentage, the colour palette, and edge clean-up.

## Options

### A — Export small helpers

Add pure functions: `resetGraphStatuses(graph, status)` (template view) and `computeGraphProgress(graph)` (done / total / percent, ignoring single-node graphs). The daemon swaps its private copies for these.

- **Cost:** small. Pure functions plus unit tests; no UI change.
- **Gives:** any host builds a Kanban-style card the same way.
- **Gives up:** every host still assembles the card (preview + bar + labels) itself.

### B — Smarter preview inputs

`mr-graph-preview` gains `showProgress` (thin built-in progress bar) and `template` (render all nodes idle, keep the shape). Builds on A.

- **Cost:** medium. Two inputs, styling through `--app-color-*`, demo page, e2e check.
- **Gives:** a live mini-flow card is one element: `<mr-graph-preview [graph]="g" template showProgress />`.
- **Gives up:** the progress bar's look is the library's, themed only through tokens.

### C — Run card component

A new `mr-run-card`: preview + progress + title/status slot, with content projection for host badges and actions.

- **Cost:** high. A new public component, and the daemon's card would have to be rebuilt on it.
- **Gives:** the same run card in the daemon and the e2e runner.
- **Gives up:** risks baking the daemon's card design into the library; most of the daemon card (schedules, queue, cooldown, ComfyUI link) would still be projected in.

### D — Document a recipe only

Add a README "Live mini-flow card" recipe showing the daemon's pattern (new graph object per update, idle template, palette tokens). No code.

- **Cost:** tiny.
- **Gives:** a shared pattern without new API.
- **Gives up:** hosts keep duplicating the helpers.

## Independent items (any option)

| Item | Why | Size |
| --- | --- | --- |
| ~~Shared Mermaid config cache~~ **Done 2026-10-05** | [Bug](../runbook/06_agent-setup-and-daemon-inventory.md#finding-mermaid-config-cache): canvas + preview on one page could render with the wrong config. [Fixed and validated](../runbook/06_agent-setup-and-daemon-inventory.md#fix-code-verified) | Small |
| Edge de-duplication option | The daemon's adapter keeps one edge per node pair; any host with dependency + transition facts needs it | Small–medium |
| Demo in zoneless mode | The daemon is zoneless; the demo runs Zone.js, so tests miss zone reliance | Small, but may expose bugs |
| Subgraph progress roll-up | Moved to [plan 11](11_node-progress-and-overlay-fixes.md) (items 5, 7, 8), with the other progress fixes. Preview progress (item 6) stays with option B here | Small–medium |
| Move the daemon's lab fixtures to the demo | Nested and wide fixtures belong with the library's regression pages | Small |

## Recommendation

**A + the config-cache fix now; B when the e2e runner needs run cards; C parked; D folded into A's README update.** A is cheap and removes the daemon duplication. B is the real "Kanban mini-flow in one tag", but it's worth designing against a second host (the runner) rather than just the daemon.

## Open questions

- Is the e2e runner's run list going to show mini-flows like the Kanban? That decides whether B is worth it.
- Should the preview's default colours match the daemon's Kanban palette, so hosts don't need the override?
- Edge de-duplication: library option, or keep it as host adapter logic?
