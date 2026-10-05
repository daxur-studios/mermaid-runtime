# Closing the LiteGraph "feel" gap

Date: 2026-10-05. Status: Option paper; awaiting hands-on feedback from the [work-style demos](03_work-style-demos.md).

Source: [Context](../runbook/01_context-and-use-cases.md), [work-style demos runbook](../runbook/04_work-style-demos.md). Related: [Roadmap](00_index.md), [rich node content options](04_rich-node-content-options.md).

**Update (same day):** the user clarified that LiteGraph is itself somewhat laggy, smoothness
on large flows is a priority, and its likely advantages are grouping that fits the screen, node
colours, right-click details, and subgraph navigation. That shifts weight away from the
"Canvas2D is faster" row below and toward options A/C. The demos exist to confirm which rows apply.

## Problem

The work runner moved from litegraph to this Mermaid runtime (fewer deps, Mermaid is more
trusted, different look), but the litegraph version still feels better, so the Mermaid one
goes unused. Until it's the one people *want* to open, other features don't matter.

## Likely causes (hypotheses — confirm with the human)

| litegraph has | Mermaid runtime has | Likely felt as |
|---|---|---|
| Nodes stay where you put them; drag to arrange | Auto-layout (dagre); positions recomputed | "the graph jumps / I can't organise it" |
| Widgets in nodes (toggle, combo, number, text) | Text + decorations only | "I can't *do* anything on the node" → [rich node content options](04_rich-node-content-options.md) |
| Typed input/output slots with links | Plain edges | "data flow isn't visible" |
| Canvas2D: instant redraw, any node count | SVG re-render per structural change | "laggy on edits / big graphs" |
| Uniform node sizes, dense | Size from label text | "messy, uneven" |
| Editor feel (add/connect/delete) | Viewer only | "it's a picture, not a tool" |

## Options

### A — Close gaps within Mermaid

Keep Mermaid for layout + shapes. Add rich node content ([rich node content options](04_rich-node-content-options.md)),
fixed node width/height (pad labels), stable layout (deterministic ordering, minimise
structural re-renders), and edge labels for data flow.

- **Cost:** incremental, fits current code.
- **Gives up:** no manual positioning; no in-canvas editing.

### B — Mermaid as layout engine only, own renderer

Run `mermaid.render()` off-screen just to get node/edge geometry, then draw nodes ourselves
as Angular HTML cards and edges as our own SVG paths. Mermaid remains the trusted
dependency and the *text format*; the visual layer is ours.

- **Cost:** high — reimplementing node/edge drawing, but full control (widgets, ports, animations, sizes).
- **Gives up:** "it's just Mermaid" simplicity; diverges from what Mermaid renders elsewhere (docs, GitHub).

### C — Switch/offer ELK layout + pinned positions

Mermaid supports the ELK layout engine (`@mermaid-js/layout-elk`) — better for
wide/parallel graphs, port-aware edge routing, more stable ordering. Combine with optional
host-persisted *hints* (rank/order constraints) instead of free positioning.

- **Cost:** low–medium; adds one Mermaid-owned dependency.
- **Gives up:** still not free-drag; ELK has its own quirks with clusters.

### D — Split roles: litegraph to author, Mermaid to run/observe

Accept they're different tools. Litegraph (or the JSON) stays the *editor*; the Mermaid
runtime is the *run monitor + replay + system views* ([live observability options](06_live-run-observability-options.md),
[system visualisation options](07_system-visualisation-options.md)), where auto-layout is an advantage.

- **Cost:** none upfront; focuses effort.
- **Gives up:** two UIs to maintain; the dependency-reduction goal only half met.

## Recommendation

**Answer the open questions first** — the right option depends on which row of the table
hurts. Default if unanswered: **D + A** — position the runtime as the run/observe surface,
and close the in-node interaction gap via [rich node content options](04_rich-node-content-options.md). Try **C** (ELK) as
a cheap spike since it may fix "jumpy layout" for parallel steps on its own.

## Open questions

1. What specifically feels better in litegraph? Pick from the table or add your own.
2. Do people *edit* flows in the UI, or only configure params and run?
3. Typical graph size at work (steps per flow, depth of sub-flows)?
4. Is manual node positioning a must-have, or a habit from litegraph?
