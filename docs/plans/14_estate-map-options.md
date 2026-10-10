# Estate map — what is worth visualising

Date: 2026-10-08. Status: Option paper; no option chosen. Source: [runbook 09](../runbook/09_system-overview-mockup.md) and the follow-up discussion (user-reported, below). Extends [plan 07](07_system-visualisation-options.md) option A.

## Context (user-reported, anonymised)

- ~500 repos, many API + DB + web triples. Kafka with many topics.
- **Sync links** go API A → (console runner) → topic + message type → (console runner) → API B. Newer services use an **outbox**: the API writes the message to its own SQL table, a console runner publishes it.
- **Feature files** (JSON) list the APIs, databases, tables and SPAs a feature needs. Today they drive a local emulator that starts only those parts.
- A **repo inventory** (JSON) is being filled in: business and technical summary and tags per repo. Wikis and custodian lists exist too.
- Environments: local emulator, dev, qa, uat. Wanted per node: build and release links to copy, health checks.
- Most work is now done by AI agents. Open question: what is still worth a human seeing?

## What a human still needs (proposed)

| Need | Why a picture beats text/search |
| --- | --- |
| "What is in this feature, and is it up?" | A slice of 10-40 parts with health fits one screen |
| "Who talks to whom, through which topic and message?" | Hidden coupling: the sync path is spread over two consoles, a topic and maybe an outbox table. Nobody can grep it |
| "What breaks if X is down?" | Blast radius (demoed in [runbook 09](../runbook/09_system-overview-mockup.md)) |
| Links to copy | A node is a good anchor for build, release, wiki and repo links |

Not worth a picture: browsing all 500 repos (search + tags + a table is faster), and reading summaries (inspector text).

## Key modelling idea (proposed)

Make the **sync link** the first-class edge: `API A ⇒ API B` labelled `topic / message type`. Its hops (outbox table, relay console, topic, consumer console) are the **drill-down** of that edge, not five nodes on the main view. Collapsed, a feature stays readable; expanded, you see exactly where a message can stall. This reuses `subgraph` drill-down and needs no new diagram type.

## Options

### A — Feature launchpad

How: load a feature file, resolve its parts against the repo inventory, draw the slice (groups by domain, kinds by shape). Env switcher (local, dev, qa, uat) swaps link templates and the status overlay. Node actions: copy build, release, repo and wiki links.
Cost: low. Data exists; library work is small (action buttons, key/value inspector rows, edge styling).
Gives up: edges between parts must come from somewhere; a feature file may list membership only.

### B — Sync-link map

How: model each console runner as a link, `producer ⇒ topic/message ⇒ consumer`, with outbox as an optional first hop. Source: runner configs, or a hand-kept link file checked against Kafka reality later.
Cost: medium; the extraction or authoring of links is the work, rendering is easy.
Gives: the one thing nobody can see today. Makes A's edges real and answers blast radius for async paths.
Gives up: stale if hand-kept; only as good as the links file.

### C — Estate explorer

How: all 500 repos clustered by tag or domain at a glance, click to drill into a feature slice, search and filter on top.
Cost: medium; mostly data and aggregation work. Dagre degrades past a few hundred nodes, so it must aggregate.
Gives up: the least decision value per effort; a searchable table covers most of it.

### D — Agent-first graph, thin UI

How: one graph JSON (parts, sync links, features) plus a small query CLI: `impact <part>`, `slice <feature>`, `path <a> <b>`. The UI is just the same data in the viewer when a human wants to check.
Cost: low; the model is needed by A and B anyway.
Gives: agents get the map as context, humans verify it visually. Likely the best use of the data now that agents do most edits.
Gives up: no polished UI on its own.

## Recommendation (proposed)

**A, built on D's graph JSON, with B's sync link as the edge model.** Start with one real feature file: the picture it produces (slice + sync links + links to copy) is the proof. Add health by reusing the e2e runner: a health run is a graph whose nodes are checks, status comes from the run, and it maps onto the system graph's node status. C only if search proves not enough.

## Open questions

- Do feature files list edges or only membership? If only membership, where do the sync links live (runner configs, a links file)?
- Do console runners declare topic and message type in config, so links can be read, not typed?
- Health: up/down, or also lag and outbox backlog? Per env, per part?
- Where do build and release URLs come from: a template per repo, or stored per repo in the inventory?
- Who keeps the inventory current once the 500 summaries are done?
