# Rich node content — options

Date: 2026-10-05. Status: Option paper; no option chosen. Feeds Stage A of the [interactive E2E slice](01_interactive-e2e-slice.md).

Source: [Context](../runbook/01_context-and-use-cases.md), [baseline](../runbook/02_repository-baseline.md), [direction](../runbook/03_direction-and-open-questions.md). Related: [Roadmap](00_index.md), [LiteGraph feel gap](05_litegraph-feel-gap.md), [live observability options](06_live-run-observability-options.md).

## Problem

Nodes are Mermaid SVG + text. The work runner wants *live, interactive* things in or on
a node: an Angular Material checkbox (headed/headless Playwright), parameter fields for a
configurable step, captured-context values (trip number, GUID), and a semi-live Playwright
preview. Are we limited to Mermaid's SVG shapes?

**Short answer: no.** Mermaid only owns *layout and the base shape*. Anything we add after
render is ours. The question is *where* our DOM lives and how it survives re-renders.

## Constraints / facts

- Labels are already HTML (`htmlLabels: true` → `<foreignObject>`), so real HTML elements
  can exist inside a node today.
- The camera is a single CSS transform on the content, so anything inside the camera's
  content box pans/zooms with the graph for free.
- Mermaid sizes a node from its label **at render time**. Content added later doesn't
  grow the node — space must be reserved up front. `buildReservedContentHtml()` already does
  this (fixed `width/height` placeholder, filled post-render — used for subgraph previews).
- A **structural** change (node/edge added, title changed) replaces the whole SVG via
  `innerHTML`. Anything mounted inside is destroyed and must be re-attached. Status-only
  changes don't re-render.
- Angular components can be mounted into any DOM element with `createComponent(Type, { environmentInjector, hostElement })` + `appRef.attachView()`.
- Material overlays (`mat-select` panel, `mat-menu`, tooltips) render to the CDK overlay
  container on `<body>`, positioned via `getBoundingClientRect()` — works under CSS
  transforms, but the panel won't scale with zoom (usually what you want).
- `foreignObject` inside a scaled SVG is where Chromium/Safari bugs live: blurry text
  during transform, occasional hit-testing offsets, `position: fixed` children broken.

## Options

### A — Stay SVG-only, extend decorations

Keep everything as post-render SVG (like badges/progress). Add small primitives: icon
toggles, key/value chips, a thumbnail `<image>` for Playwright frames.

- **Cost:** low; matches existing code style.
- **Gives up:** no real form controls, no Material, everything hand-drawn. Clicks need custom hit-testing. A checkbox becomes a drawn icon toggled via an output event.

### B — Mount Angular components into reserved label slots (foreignObject)

Generalise the reserve-then-fill seam: host declares per-node *slots*
(`{ nodeId, component, inputs, size }`), canvas reserves the size in the label, then
after each render mounts the component into the placeholder `<div>`. Keep a `ComponentRef`
pool keyed by `nodeId+slot`; on structural re-render, **move** the existing host element
into the new placeholder instead of recreating (preserves state, e.g. a half-typed field).

- **Cost:** medium. Lifecycle/pool management, pointer-event isolation (don't pan or select when clicking a checkbox), keyboard focus.
- **Gives:** real Material controls *inside* the node, correct layout size, scales with zoom.
- **Gives up:** inherits foreignObject quirks; content size must be known up front (dynamic growth → re-layout).

### C — HTML overlay layer synced to node boxes

Leave Mermaid nodes alone. After render, read each node's box (in scene coordinates) and
render an Angular `@for` of absolutely-positioned cards in a sibling `<div>` inside the
camera content. Same transform → stays glued to the node. Nodes get reserved space (B's
trick) so the card doesn't overlap neighbours, or the card sits beside/below the node.

- **Cost:** medium. Needs a "node boxes" signal recomputed after each render.
- **Gives:** plain Angular templates (no imperative mounting), zero foreignObject quirks, normal change detection, easy `@if (zoom > x)` level-of-detail.
- **Gives up:** two DOM trees to keep aligned; overlay must be excluded from Mermaid's layout so it can't influence node size unless reserved.

### D — Level-of-detail: compact node, rich panel on demand

Nodes stay compact (title, status, a few badges). Rich content lives in (1) the **inspector**
(already exists — add a "parameters" form section driven by a JSON schema on the node), and
(2) an **expanded card** that opens over the selected node (option C, but only one at a time).

- **Cost:** lowest for real forms — inspector is plain Angular, no positioning problems.
- **Gives:** scales to large graphs; forms where there's room for them.
- **Gives up:** the "everything visible at a glance in the node" litegraph feel.

## Recommendation

**D now, C next, B only if C proves insufficient.**

1. D: add a schema-driven `params` section to the inspector — fastest way to make configurable Playwright steps usable (headed toggle, trip params) without touching render.
2. C: build the overlay layer as a generic `nodeTemplate` slot (`<ng-template mrNodeContent let-node>`) — hosts project any Angular content per node; library reserves space and positions it. Playwright preview frames, captured context chips, and the headed checkbox all become host templates.
3. Keep A for tiny always-on cues (already the pattern).

This keeps the library domain-free: it provides *slots and positions*, the work runner and
daemon provide the content.

## Open questions

- Should in-node controls be editable **during** a run, or only before start (config mode vs run mode)?
- Do parameter edits write back to the e2e JSON file, or only to a per-run override?
- What size budget per node is acceptable? (Dictates whether a Playwright thumbnail fits in-node or only in the expanded card.)
