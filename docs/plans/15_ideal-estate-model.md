# Ideal estate model — a target to match

Date: 2026-10-08. Status: **Proposed**; a target to compare real data against, not an accepted decision or supported API. Source: follow-up to [plan 14](14_estate-map-options.md) ("define the ideal approach, I'll see if I can match it at work"). Related: [runbook 09](../runbook/09_system-overview-mockup.md), [plan 07](07_system-visualisation-options.md).

## Principles

| # | Rule | Why |
| --- | --- | --- |
| 1 | **Topology is static, health is volatile.** Two files (or one file and one endpoint), never mixed | The map changes weekly, health changes by the minute; mixing them makes both hard to cache and diff |
| 2 | **One owner per fact, derive the rest.** Edges come from where they are really configured (console runner config, API client config), not typed twice | Hand-copied edges rot |
| 3 | **Feature files select; they do not describe.** A feature lists roots (and optional pins); the registry supplies the connections | Today's feature files stay small and stop going stale when a link changes |
| 4 | **Stable ids = repo name** (or `repo/part` when a repo holds several) | Every join (health, links, summaries, wikis) hangs off the id |
| 5 | **Every edge carries provenance**: `declared`, `harvested` or `observed`, plus `verifiedAt` | Lets you trust, filter and age edges; an agent can tell a guess from a fact |
| 6 | **Everything but `id` and `kind` is optional.** The viewer shows what exists | Adoption can be gradual (ladder below) |

## Files

| File | Holds | Changes |
| --- | --- | --- |
| `components.json` | The ~500 repos as components: kind, domain, tags, summaries, custodians, links | When a repo changes |
| `links.json` | Calls and sync links between components | When wiring changes |
| `features/*.json` | One selection per feature | Per feature |
| `health.json` (or endpoint) | Latest check result per component and environment | Continuously |
| `environments.json` | Environment names and URL / link templates | Rarely |

## Shapes (synthetic example)

```jsonc
// components.json
{
  "id": "orders-api",            // = repo name
  "kind": "api",                 // api | db | web | console | topic | queue | cache | job
  "domain": "checkout",
  "tags": ["orders", "dotnet"],
  "summary": { "business": "…", "technical": "…" },
  "custodians": ["team-shop"],
  "pair": { "db": "orders-db", "web": "orders-web" },   // the API/DB/Web triple
  "tables": ["orders", "order_outbox"],                 // for db components
  "links": { "repo": "…", "wiki": "…" },                // fixed links; build/release come from templates
  "health": { "path": "/health" }                       // how to check it, per kind
}
```

```jsonc
// links.json: a plain call
{ "id": "web-to-api", "type": "call", "from": "orders-web", "to": "orders-api", "protocol": "REST", "provenance": "harvested" }

// links.json: a sync link (the important one)
{
  "id": "orders-to-inventory",
  "type": "sync",
  "from": "orders-api",
  "to": "inventory-api",
  "topic": "orders.created",
  "messageType": "OrderPlaced",
  "producer": { "console": "orders-relay", "outbox": { "db": "orders-db", "table": "order_outbox" } },  // outbox optional
  "consumer": { "console": "inventory-ingest" },
  "provenance": "declared", "verifiedAt": "2026-10-01"
}
```

```jsonc
// features/checkout.json
{ "id": "checkout", "name": "Checkout", "roots": ["orders-web"], "include": ["payments-api"], "exclude": [], "depth": 3 }
```

```jsonc
// health.json
{ "component": "orders-api", "env": "qa", "status": "healthy", "at": "2026-10-08T09:00:00Z", "detail": "p95 120ms" }
```

## How it maps onto the library (proposed)

| Model | Library |
| --- | --- |
| Component | `Node`: `type` = kind (→ `nodeKinds`), `subtitle` = custodians/version, `detail` = summary, `status` = health for the chosen env |
| `call` link | `Transition` labelled with the protocol |
| `sync` link | One `Transition` labelled `topic / messageType`; its hops (outbox table, producer console, topic, consumer console) form the edge's drill-down |
| Domain | `NodeGroup` |
| Feature | Selection: roots + closure over links to `depth`, minus excludes |
| Environment | Switch changes link templates and which `health` rows apply; the graph stays the same |

Gaps in the library for this (from [runbook 09](../runbook/09_system-overview-mockup.md)): drill-down on an **edge** (today only nodes drill), dashed async edges, key/value and link rows in the inspector, copy-link actions, a legend, domain swimlanes.

## Health: reuse the runner

A health run is a graph whose nodes are checks (`GET /health` on a component in an env). The run's node status becomes the system map's node status. This uses what already exists and keeps the e2e runner as the one place that executes things. The first check set: `reachable`, then per kind: API `/health`, DB `select 1`, console `last heartbeat < N min`, topic `consumer lag < N`, outbox `oldest unsent row < N min`.

## Adoption ladder

Each step leaves something useful; stop wherever the value runs out.

| Step | You need | You get |
| --- | --- | --- |
| 0 | `components.json` with id, kind, domain, tags | Grouped overview and search; summaries in the inspector |
| 1 | Feature files as roots + includes | Feature slice with no edges |
| 2 | `links.json` with `call` links | Real slice with arrows and blast radius |
| 3 | `sync` links from console configs | The hidden async paths, with outbox hops |
| 4 | `environments.json` templates | Copy build, release and repo links per env |
| 5 | Health checks via the runner | Live status per env |
| 6 | `observed` links from runtime events ([plan 06](06_live-run-observability-options.md)) | Drift detection: declared vs seen |

## Checklist to compare with real data

- Is there a stable id per repo already, and do feature files use it?
- Does each console runner's config name its topic and message type (so `sync` links can be harvested)?
- Does the outbox table have a known name per DB (convention or config)?
- Are build and release URLs derivable from the repo name, or irregular?
- Can every kind answer a health question (`/health`, `select 1`, heartbeat, lag)?
- Who owns each file, and how does a change to wiring reach `links.json`?

## Open

- Whether `sync` links should be generated by a harvester (scan configs) or kept by hand with a checker.
- How to model one console serving several topics: one link per message type (proposed) or one link with a list.
- Whether the registry lives in this repo's tooling, the work repo, or a service. The library stays host-agnostic either way: a host adapter maps this model to `MermaidRuntime.*`.
