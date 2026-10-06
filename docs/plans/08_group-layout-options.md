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

## Connected chains: options (2026-10-06)

Source: user at work still saw a long grouped process in one column ([runbook 05](../runbook/05_group-layout-spike.md#connected-chains-measured-2026-10-06) has the measurements and a correction). These refine option C.

**Status:** options 1 and 2 are built, with both looks as a host setting `groupFlow` (`'alternate'` default, `'same'`); see [runbook 05](../runbook/05_group-layout-spike.md#implementation-exact-arrows-between-phases-and-groupflow-2026-10-06). Options 3 and 4 are still open.

**Corrected finding:** on Mermaid 11.16.0, an explicit `direction` on each group compacts a connected chain while keeping the real step-to-step arrows. The library simply never emits a direction for connected groups. Options 1 and 2 below build on that.

| Option | How | Gives | Gives up | Cost |
| --- | --- | --- | --- | --- |
| 1. Direction for connected groups | Emit the across-the-flow direction (optionally alternating per group) for connected groups too, when the host has not set one | 10 × 6 chain from 0.13 to 0.53 fit (TD), 0.61 (LR); steps and their arrows stay Mermaid's own | Mermaid draws the arrow between phases box to box, not step to step | Small |
| 2. Option 1 + exact arrows between phases | Hide Mermaid's cross-group arrows and draw them ourselves from the measured last/first steps (straight when alternating directions) | Arrows start and end on the real steps | Replay pulses and edge labels on those arrows need mapping to the drawn arrows | Medium |
| 3. Wrap very long chains | Split a chain that is still too tall into columns or rows chosen from the viewport (reuses `chooseGroupsPerLine`); draw the joining arrows ourselves | Chains past ~15 phases fit | Only pays off for long chains (20 × 6: fit 0.26 as one stack) | Medium-high |
| 4. Collapsed phases | One summary node per group (rolled-up progress and time), expanded on click or zoom | 60 steps read as 10 nodes; fits the zoomed-out detail request | Steps hidden until expanded | Medium-high |

**Mock-up of option 2 with fan-out and fan-in (2026-10-06, scratch spike, not in the repo):** four synthetic phases, one step feeding three parallel steps, two parallel steps feeding one. Mermaid's own cross-group arrows were hidden and elbow arrows drawn from the measured steps. Each arrow leaves a step by its outer side, runs down a lane inside the group's margin (so stacked parallel steps are never crossed), and enters the target from its outer side; parallel arrows share the lane and read as a bus. This worked the same in both looks:

- **Snake** (rows alternate direction): the last steps and the next group's first steps sit on the same side, so each hand-off is one straight lane. Reading order flips every row.
- **All left to right:** the lane drops to the gap, runs back along the gap, then down the next group's left margin. Reading order is the same in every row; arrows are longer.

Fan-in and fan-out do not favour either look; the difference is reading order versus arrow length. The same router serves both, so the look can be a host setting (`groupFlow`, name not decided). Not yet covered: edges that skip a phase, groups wrapped into several columns, and matching the arrow style (Mermaid's arrows inside groups are curved, the drawn ones are elbows).

ELK was tried and ruled out (still one strip; group direction ignored). **Recommendation:** option 1 now, since it is the actual fix and small, then option 2 so arrows meet the real steps. Option 3 only if real chains exceed ~15 phases. Option 4 belongs with the zoomed-out node detail work ([runbook 08](../runbook/08_outstanding-requests.md)).

## Open questions

- Is a behaviour change to the default (A) OK for the daemon's existing graphs, or should it be opt-in?
- For C: is it acceptable that an inter-group arrow points at the group box rather than a specific step?
- Preferred wrap: fixed column count, or auto-fit to the viewport?
