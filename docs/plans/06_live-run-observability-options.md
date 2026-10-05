# Live run observability — options

Date: 2026-10-05. Status: Option paper; no option chosen. Visual options for Stages A–B of [activity and system views](02_activity-and-system-views.md), which owns the identity/event-contract requirements.

Source: [Context](../runbook/01_context-and-use-cases.md), [baseline gaps](../runbook/02_repository-baseline.md). Related: [Roadmap](00_index.md), [rich node content options](04_rich-node-content-options.md), [system visualisation options](07_system-visualisation-options.md).

## Problem

During an e2e run, see what the *system* does, not just which step is active: Kafka
messages flying, DB queries, API calls and which endpoints, plus a semi-live view of the
Playwright browser (e.g. the create-trip flow) — ideally inside or beside its step.

Two halves: **getting the events** (runner/CLI side, out of this library) and **showing
them** (this library).

## Constraints / facts

- Library replay knows only `node-started | node-ended | edge-traversed` (closed union).
- Edges are Mermaid SVG `<path>`s — `getTotalLength()` / `getPointAtLength()` make
  "particle travels along edge" animation cheap.
- The step graph (runner steps) and the system graph (services, topics, tables) are
  **different graphs**. Kafka/DB/API traffic happens *between system components*, not
  between steps.
- Event sources at work, roughly from easiest to hardest: runner/CLI step logs (already
  have), Kafka pre-subscriptions (already have), SQL polling results (already have),
  OpenTelemetry traces from .NET services (if instrumented), DB-side query capture.
- Playwright: Chromium CDP `Page.startScreencast` streams JPEG frames; or periodic
  `page.screenshot()`; or post-run trace (`trace.zip`) for replay.

## Event contract (needed by every option)

Illustrative sketch only — the semantic requirements (scope, relation identity, correlation, ordering, availability) live in [activity and system views](02_activity-and-system-views.md) Stage A. The library never knows what "Kafka" is:

```ts
interface ActivityEvent {
  seq: number; at: string;
  stepId?: string;          // which runner step caused it (if known)
  from?: string; to?: string; // system component ids (service, topic, table, ui)
  kind: string;             // open: 'kafka.publish', 'sql.query', 'http.request', 'pw.frame', …
  label?: string;           // short, e.g. 'POST /trips' or topic name
  status?: string;          // ok / error / timeout
  refId?: string;           // payload lives elsewhere, loaded via ref loader
}
```

Payloads (message bodies, SQL text, screenshots) stay out of the event and load on demand
through the existing ref-loader seam.

## Options

### A — Activity on the step graph

Per-step activity badges/counters (`3 kafka · 2 sql · 5 http`), a live activity feed in the
inspector for the selected step, Playwright frame in the step's rich content slot ([rich node content options](04_rich-node-content-options.md)).

- **Cost:** low. Reuses badges + inspector.
- **Gives up:** you see *how much*, not *where it flows*.

### B — Live system map with edge traffic

A second canvas: system graph (from feature profile, [system visualisation options](07_system-visualisation-options.md)) where
each `ActivityEvent` with `from/to` animates a dot along that edge, colour by kind, red on
error. Selected step in the step graph filters the system map's traffic.

- **Cost:** medium. Needs `animateEdge(from, to, style)` primitive in the canvas + a system graph.
- **Gives:** the "messages flying around" view.
- **Gives up:** needs `from/to` attribution — easy for HTTP/Kafka you call, hard for internal service-to-service calls without tracing.

### C — Live sequence diagram

Generate a Mermaid `sequenceDiagram` from the event stream (participants = components,
arrows = events). Mermaid's native fit for "who called whom in what order". Re-render
batched (e.g. every N events / 500 ms), window to last N events.

- **Cost:** low–medium; new viewer component, no layout fights.
- **Gives:** exact ordering, readable for a single flow, great for replay/export.
- **Gives up:** not spatial; long runs need windowing/collapsing.

### D — Trace-first: ingest OpenTelemetry

If services emit OTel, the runner collects spans per run (trace id propagated from runner
calls); convert spans → `ActivityEvent`s. Feeds A/B/C with *internal* calls too.

- **Cost:** depends on instrumentation coverage across legacy systems — likely partial.
- **Gives:** real interconnectedness data, also feeds [system visualisation options](07_system-visualisation-options.md) option C.

## Playwright preview (cross-cutting)

| Mode | How | Fits |
|---|---|---|
| Live-ish | CDP screencast → runner → SSE/WebSocket → `<img>` in node slot/inspector | headed-not-needed runs |
| Snapshot | screenshot on each Playwright action | cheap, good enough |
| Replay | keep `trace.zip`, link "open in trace viewer" from inspector | post-mortem |

The library just needs an image/stream-capable rich content slot ([rich node content options](04_rich-node-content-options.md));
capture is runner-side.

## Recommendation

**Contract first, then A → C → B; D opportunistically.** A is nearly free and proves the
event pipe. C gives the highest insight per effort for "how does info flow". B is the most
impressive and depends on [system visualisation options](07_system-visualisation-options.md)'s system graph, so it comes last.

## Open questions

- Are the .NET services OTel-instrumented (any trace propagation through Kafka)?
- Can the runner see traffic it didn't initiate (e.g. a service consuming a topic), or only what it calls/subscribes to?
- Event volume per run (dozens? thousands?) — decides batching/windowing.
