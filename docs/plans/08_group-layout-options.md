# Group layout — options

Date: 2026-10-05. Status: **A + B done** as `groupArrangement: 'auto'` (see [runbook 05](../runbook/05_group-layout-spike.md#implementation-same-day)); C next, D parked. Highest-priority UX issue per user feedback.

Source: [Group layout spike](../runbook/05_group-layout-spike.md), [work-style demos](../runbook/04_work-style-demos.md). Related: [Roadmap](00_index.md), [LiteGraph feel gap](05_litegraph-feel-gap.md).

## Problem

Groups render as one long strip (one column in LR, one row in TD), so large flows never fit the
screen. Users want groups placed next to each other so the whole flow is visible compactly. Root
cause and measurements: [spike](../runbook/05_group-layout-spike.md).

## Options

### A — Always emit group direction (default fix)

When `NodeGroup.direction` is unset, emit `direction <outer>` (TD → `TB`) instead of nothing. Stops
Mermaid's perpendicular flip, so independent groups (trips, parallel subflows) sit side by side.

- **Cost:** ~1 line in `buildNodeDefinitionBlocks()` + layout-regression update. Harmless for groups with external edges (Mermaid ignores direction there anyway).
- **Gives:** 5-trip view goes from 317 × 4086 to roughly 1500 × 550.
- **Gives up:** changes layout for existing hosts that relied on the flip. Could ship behind `groupDirection: 'inherit' | 'mermaid-default'` if that matters (daemon is the only other consumer).
- **Doesn't fix:** connected chains of groups.

### B — Grid wrapping for independent groups

New input, e.g. `groupWrap: number | 'auto'`. Library adds invisible `groupN ~~~ groupN+k` links so
unconnected groups wrap into rows of `k` (`'auto'` picks `k ≈ √count` or from viewport aspect). Builds on A.

- **Cost:** small; pure source generation. `'auto'` needs a structural re-render when the viewport aspect changes a lot. Debounce it, or compute it only on data change.
- **Gives:** 10 trips → 2 × 5 grid (1415 × 1172) instead of a 2830-wide row.
- **Gives up:** only for groups with no edges between them.

### C — Compact chain mode (group-to-group edges)

New opt-in input, e.g. `groupLayout: 'compact'`. Node edges that cross a group boundary are drawn
as one **group → group** edge instead; each group gets an explicit direction perpendicular to the
outer flow. A 6-phase chain becomes a stack of short rows (TD: 600 × 636 vs 195 × 1776 today).

- **Cost:** medium. De-duplicate cross-group edges. Keep an edge-ID map so replay `edge-traversed` pulses and edge labels still resolve. Fan-in edges (parallel sync) inside a group are unaffected.
- **Gives:** compact view of the common case: a long sequential run split into phases.
- **Gives up:** the exact source/target node of inter-group edges is not drawn; inspector or tooltip must show it. Edge labels on cross-group edges merge.

### D — Different layout engine

Mermaid's optional ELK layout (`@mermaid-js/layout-elk`), or computing group positions ourselves
(Mermaid renders each group, the library packs them). The rectangle packing could be a small
shelf-packing algorithm.

- **Cost:** ELK: one extra Mermaid-owned dependency and a spike to see if it packs components (untested). Own packing: high, since cross-group edges must be routed manually.
- **Gives:** potentially true 2D packing of arbitrary graphs.
- **Gives up:** "it's just Mermaid" simplicity; ELK has its own cluster quirks.

## Recommendation

**A + B now, C next, D only if C falls short.**

1. **A** is effectively a bug fix: it makes the demo's subflow/trip views compact immediately.
2. **B** gives the "fits the screen" grid for parallel/independent work (multi-trip runs, parallel branches).
3. **C** fixes long sequential runs. It's the bigger semantic change, so it's opt-in and comes after the user has seen A + B in the Large-flow lab.

Validate each with the Large-flow lab (24/120/240 steps, both directions) and the layout-regression suite.
Add the measured SVG sizes to the runbook.

## Open questions

- Is a behaviour change to the default (A) OK for the daemon's existing graphs, or should it be opt-in?
- For C: is it acceptable that an inter-group arrow points at the group box rather than a specific step?
- Preferred wrap: fixed column count, or auto-fit to the viewport?
