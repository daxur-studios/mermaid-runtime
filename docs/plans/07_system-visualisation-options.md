# System visualisations — options

Date: 2026-10-05. Status: Option paper; no option chosen. Visual options for Stage C of [activity and system views](02_activity-and-system-views.md).

Source: [Context](../runbook/01_context-and-use-cases.md), [baseline](../runbook/02_repository-baseline.md). Related: [Roadmap](00_index.md), [live observability options](06_live-run-observability-options.md).

## Problem

Beyond step graphs: visualise the system itself — information flow, health,
interconnectedness/dependencies. Work estate is ~500 repos, hundreds of APIs/DBs, legacy +
new, Kafka, cache tables bridging systems. Feature profiles (JSON: "this feature needs these
20 tables, 10 APIs, 2 UIs") already describe *slices* of it.

## Constraints / facts

- The library is flowchart-only today, but its model (nodes, transitions, groups, nested
  `subgraph`, status styles, badges) is generic enough for a system graph.
- Mermaid/dagre degrades past a few hundred nodes (layout time, readability). Whole-estate
  in one render is not viable → aggregation + drill-down is mandatory. Drill-down already exists.
- Mermaid has other diagram types worth using for specific views: `architecture-beta`
  (services/groups/icons), `C4Context`/`C4Container`, `sequenceDiagram` ([live observability options](06_live-run-observability-options.md)),
  `sankey-beta` (volumes of flow), `block-beta`.
- Status styling is already open (`StatusStyleMap`) → health colouring is mostly free.

## Options

### A — Feature-profile graph (start here)

Turn one feature profile into a graph: UIs → APIs → tables/topics, grouped by owning system
(`NodeGroup`). Overlay "is it running locally?" as status (`complete` = up, `failed` = down,
`skipped` = not required). Doubles as the pre-flight check for a local e2e run.

- **Cost:** low — data exists, model fits, no new diagram type.
- **Gives:** immediately useful; small graphs (tens of nodes).
- **Gives up:** edges between components must be declared in the profile (they may not be today).

### B — Static dependency graph harvested from repos

Scan repos for HTTP client base URLs, Kafka topic names, connection strings, project refs →
component graph. Render aggregated (system level) with drill-down to service → endpoints/topics/tables.

- **Cost:** high; extraction heuristics per tech (legacy ASP vs .NET vs Angular).
- **Gives:** the true interconnectedness map; reveals hidden coupling via cache tables.
- **Gives up:** staleness and false edges unless regenerated regularly.

### C — Runtime-observed graph

Accumulate `ActivityEvent`s ([live observability options](06_live-run-observability-options.md)) across e2e runs: every
observed `from → to` becomes an edge with counts/last-seen. The graph is what the system
*actually* does, at least for exercised paths.

- **Cost:** low once the event contract ([activity and system views](02_activity-and-system-views.md) Stage A) exists.
- **Gives:** zero-maintenance, trustworthy edges; feeds feature profiles back (auto-suggest required tables/APIs).
- **Gives up:** only covers what tests exercise.

### D — Multi-diagram-type seam in the library

Add a renderer seam so the canvas/camera/minimap/inspector chrome works with
`architecture-beta`, `sequenceDiagram`, `sankey-beta`, not just flowchart. Each view picks
the best Mermaid type for its question (flow volume → sankey; topology → architecture;
order → sequence).

- **Cost:** medium–high; decorations (rings, progress, badges) are flowchart-node-specific today.
- **Gives:** right diagram for each question, all in one interactive shell.

## Recommendation

**A first** (cheap, useful at work immediately, exercises groups + drill-down + status-as-health),
**then C** once [live observability options](06_live-run-observability-options.md) emits events, using C's data to enrich A's
profiles. **B** only if C's coverage gap hurts. **D** pulled in per view when a flowchart is the
wrong shape (sequence is the first candidate, via option C of the [live observability options](06_live-run-observability-options.md)).

## Open questions

- Do feature profiles declare edges (who calls/reads/writes whom), or only membership lists?
- What is "health" — up/down only, or latency/error-rate/lag (Kafka consumer lag, cache staleness)?
- Is there an existing service catalogue / API gateway config that lists APIs centrally?
