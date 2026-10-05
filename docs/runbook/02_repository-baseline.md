# Repository baseline

Date: 2026-10-05. Status: Code-verified inspection at `41f7844`; no application or work-system validation performed in this documentation session.

This is the initial snapshot. Later demo implementation and browser validation in the same session are recorded in [04 Work-style demos](04_work-style-demos.md), including the live-subgraph update fix.

Related: [Context](01_context-and-use-cases.md), [direction](03_direction-and-open-questions.md), [interactive-node plan](../plans/01_interactive-e2e-slice.md), [activity plan](../plans/02_activity-and-system-views.md).

## Existing foundation

| Capability | Evidence | Implication |
| --- | --- | --- |
| Angular viewer, host-owned data | [Public model](../../projects/mermaid-runtime/src/lib/task-graph-model.ts), [exports](../../projects/mermaid-runtime/src/public-api.ts) | Keep reusable UI separate from runner/daemon implementations |
| Status/progress independent of layout | [Canvas](../../projects/mermaid-runtime/src/lib/graph-canvas/graph-canvas.component.ts): `buildGraph`, `statusKey`, `progressKey`, `applyStatusClasses` | Preserve the cheap live-update path |
| Pan/zoom, follow, minimap, selection | [Canvas](../../projects/mermaid-runtime/src/lib/graph-canvas/graph-canvas.component.ts), [camera](../../projects/mermaid-runtime/src/lib/graph-camera/graph-camera.component.ts) | Extend existing navigation before replacing it |
| Inline/resolved subgraphs, breadcrumbs, previews, groups | [Model](../../projects/mermaid-runtime/src/lib/task-graph-model.ts), [canvas](../../projects/mermaid-runtime/src/lib/graph-canvas/graph-canvas.component.ts) | Drill-down and same-view clustering already exist; neither executes a subflow |
| Inspector refs for inputs, outputs, context, logs, artifacts | [Loader seam](../../projects/mermaid-runtime/src/lib/task-graph-ref-loader.ts), [inspector](../../projects/mermaid-runtime/src/lib/graph-inspector/graph-inspector.component.ts) | Reuse host-loaded evidence rather than embedding large payloads in nodes |
| Shapes, title overrides, small live badge | [Model](../../projects/mermaid-runtime/src/lib/task-graph-model.ts): `NodeDecoration` | Some per-node customization exists; no arbitrary Angular node-content contract |
| Viewport overlays and detail projection | [Canvas template](../../projects/mermaid-runtime/src/lib/graph-canvas/graph-canvas.component.html) | Good for chrome/inspectors; no public node-anchored template slot |
| Recorded execution replay and edge traces | [Replay](../../projects/mermaid-runtime/src/lib/task-graph-replay/task-graph-replay.component.ts), canvas `playReplayEventAnimation` | Useful baseline, not a general telemetry/replay model |
| Layout regression coverage | [Browser tests](../../e2e/layout/rendering.spec.ts), [probe](../../e2e/fixtures/layout-probe.ts), [stability tests](../../projects/mermaid-runtime/src/lib/graph-canvas/layout-stability.spec.ts) | New content must preserve camera and layout stability |

The package declares Angular/Material/CDK 20.x and Mermaid `^11.16.0`; `ngx-markdown` is an optional peer. These are declared ranges, not a claim about all consumer installations. See [package metadata](../../projects/mermaid-runtime/package.json).

## Runner needs at a glance

Quick map from the [user-reported runner concepts](01_context-and-use-cases.md) to library support at `41f7844`. ✅ supported, ⚠ possible via generic fields/host workarounds, ❌ not supported.

| Runner concept | Library today | Where it's explored |
| --- | --- | --- |
| Step graph, sequential + parallel | ✅ nodes/transitions | — |
| Sub-flows / reusable prerequisites | ✅ `subgraph` / `subgraphId` drill-down | [Interactive E2E slice](../plans/01_interactive-e2e-slice.md) (instance identity) |
| Env targeting, local-only steps skipped | ✅ `skipped` status; ⚠ skip reason only via `detail` | [Interactive E2E slice](../plans/01_interactive-e2e-slice.md) |
| Run context (trip number → GUID) | ⚠ inspector refs / `detail` | [Interactive E2E slice](../plans/01_interactive-e2e-slice.md) |
| Assert steps | ⚠ shape decoration + refs | [Interactive E2E slice](../plans/01_interactive-e2e-slice.md) |
| Async waits (Kafka, SQL polling) | ⚠ status + progress bar | [Activity and system views](../plans/02_activity-and-system-views.md) |
| Configurable nodes (params, headed toggle) | ❌ no in-node controls | [Rich node content options](../plans/04_rich-node-content-options.md) |
| Live Kafka/DB/API activity | ❌ | [Live observability options](../plans/06_live-run-observability-options.md) |
| Playwright preview | ❌ | [Rich node content](../plans/04_rich-node-content-options.md), [live observability](../plans/06_live-run-observability-options.md) |
| Feature profiles, system/health views | ❌ | [System visualisation options](../plans/07_system-visualisation-options.md) |

## Gaps relevant to this discussion

- `Node` requires `status`; it is oriented toward execution. It has no parameter editor, skip-reason field, readiness contract, or explicit run/attempt identity. Hosts can use existing `detail`, custom statuses, and refs for basic display today.
- `Transition` carries `from`, `to`, `label`, and `condition`; it has no explicit stable edge ID or relationship kind. The renderer currently carries endpoints and label into its internal edges. It does not evaluate conditions.
- `ExecutionEvent` supports only `node-started`, `node-ended`, and `edge-traversed`. It lacks telemetry identity, source, correlation, attempt, payload refs, and freshness.
- Replay edge lookup parses a daemon-shaped `kind:from:to[:label]` string. This is a portability gap despite the broadly host-independent public model; endpoint pairs also cannot identify multiple distinct relations between the same nodes reliably.
- Live incoming-edge pulses are driven by node-status changes. They indicate execution feedback, not proof of a Kafka message or HTTP request.
- Multiple nodes can have `running` status, but `currentNodeId` is singular and automatic focus falls back to the first running node at the active level. Parallel-work follow policy needs a deliberate design.
- Replay advances through sequence positions, assumes the supplied sequence convention, and resets reachable downstream state on node start. Optional progress fills are timer-driven. Do not treat it as exact reconstruction of arbitrary concurrent, retried, nested, or distributed activity without further work.

## Node rendering boundary

The canvas builds Mermaid text, renders SVG, and copies the rendered DOM into the graph host. Its default enables `htmlLabels` and `securityLevel: "loose"`. It already reserves fixed-size HTML label space for subgraph previews and fills that content after rendering (`buildReservedContentHtml`, `applySubgraphPreviews`).

This proves there is an existing size-reservation technique to investigate. It does not prove that arbitrary Angular components can be safely inserted without lifecycle, sizing, focus, or performance work. The camera transforms its projected scene, while the public `[overlay]` slot sits outside that scene and is viewport-anchored.

The [task wrapper template](../../projects/mermaid-runtime/src/lib/task-graph.component.html) currently forwards `[overlay]` content. The README's context-menu text says that slot is only exposed by the canvas. Resolve that documentation discrepancy when working on the extension contract; direct canvas access is still needed for its context-menu state/methods.

## Evidence limits

No LiteGraph implementation, work runner schema, feature profile, telemetry contract, or AI host code was supplied or inspected. Current UX, consumer compatibility, and production-scale performance remain unverified. The historical extraction/conformance references in model comments were not found in the current file inventory and are not used as evidence here.
