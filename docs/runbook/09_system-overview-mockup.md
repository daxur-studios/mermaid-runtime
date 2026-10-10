# System overview mockup

Date: 2026-10-08. Status: mockup built in the demo; no library change. Source: user asked whether the current renderer can draw a microservice-style system overview (web apps, APIs, databases, Kafka, consumers, producers, queues) with health and descriptions, "a bit like a CMDB". Plan: [07 System visualisations](../plans/07_system-visualisation-options.md) (option A, with the shapes from [plan 12](../plans/12_node-kind-registry-options.md)).

## What was built (code-verified)

Demo page `/system-overview` ([page](../../projects/demo/src/app/pages/system-overview.page.ts), [synthetic data](../../projects/demo/src/app/system-overview-data.ts)): 22 items, 25 links, no library edits.

| Idea | Mapped onto |
| --- | --- |
| Item (service, topic, DB) | `Node`; description in `detail`, version/owner in `subtitle` |
| Kind of item | `Node.type` + `nodeKinds` (shape, icon, chip, tone), per-node chip via `decorations` |
| Health | `Node.status` (`healthy`, `degraded`, `down`, `maintenance`) via `statusStyles`; `degraded` needs one host CSS rule in [styles.scss](../../projects/demo/src/styles.scss) |
| Call / event | `Transition`, label = protocol (`REST`, `gRPC`, `produce`) |
| Layer or domain | `NodeGroup`; three views regroup the same inventory (by layer, by domain, async-only) |
| Consumer lag | `progressPercent` + `progressLabel` on a degraded consumer |
| Blast radius | Demo-side `simulateHealth`: a failed item degrades its sync callers and the consumers of a failed topic; async edges stop the spread toward producers |

## Findings

- **Current renderer is enough for a mockup** (user question answered: no new Mermaid diagram type needed to start). Status colours, kind shapes, health roll-up counts and the failure cascade all work.
- **By domain reads well** (checked in headless Playwright, 1600×1000): groups hold a mix of web, API, topic and DB, so Mermaid places them as a 2-D cluster map.
- **By layer reads badly**: one tall column of tiny boxes; group `direction: 'LR'` is ignored because nearly every node links outside its group (the limit in [runbook 05](05_group-layout-spike.md)). The group packing in `'auto'` is built for process steps, not architecture lanes. **Open:** a real swimlane arrangement (fixed rows or columns per group) would be a library feature.
- **Event flow view is only half useful**: dropping sync edges leaves the APIs group with two nodes. It needs "show neighbours of async edges" or edge styling rather than a node filter.
- **Zoom**: opens far out, so only chips show (far-zoom text). Items need their titles at that zoom for a map this size; `farLabel` can supply them (not tried).

## Gaps for a CMDB-style view (proposed)

| Gap | Why it matters | Cheapest next step |
| --- | --- | --- |
| Edge styling (dashed for async, colour by health) | Sync vs async is the main thing to read | Edge classes from a `Transition` field |
| Layer swimlanes | The classic architecture picture | Group arrangement `'lanes'` |
| Inspector fields (owner, version, SLO, links) | CMDB records are key/value, not one description | Host-supplied key/value rows |
| Group-level health roll-up | Collapse a domain to one box coloured by its worst child | Existing `subgraph` drill-down plus a roll-up helper (see [plan 11](../plans/11_node-progress-and-overlay-fixes.md)) |
| Legend | Kinds and health colours are unexplained | Generate from `nodeKinds` and `statusStyles` |
| Scale (hundreds of nodes) | Dagre degrades, per plan 07 | Aggregate by domain, drill into services |

## Validation

`npm run build` OK, `npm run demo:build` OK. Unit and e2e tests not run: no library code changed. Visual check by headless Playwright screenshots; no e2e spec added. Not committed.
