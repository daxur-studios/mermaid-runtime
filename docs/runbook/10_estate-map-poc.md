# Estate map proof of concept

Date: 2026-10-08. Status: built in the demo (`/estate`); no library change. Source: user asked for a PoC of [plan 15](../plans/15_ideal-estate-model.md). Plan: [15](../plans/15_ideal-estate-model.md), options in [14](../plans/14_estate-map-options.md). Earlier mockup: [runbook 09](09_system-overview-mockup.md).

## What was built (code-verified)

| Piece | File |
| --- | --- |
| Contract types (components, call and sync links, features, environments, health rows) | [estate-model.ts](../../projects/demo/src/app/estate/estate-model.ts) |
| Synthetic registry: 27 components, 15 links (5 sync, 3 with shared relays), 3 features, 4 environments, health rows with a few incidents | [estate-data.ts](../../projects/demo/src/app/estate/estate-data.ts) |
| Host adapter (pure functions): `resolveFeature`, `buildEstateGraph`, `linksFor`, `syncSummaries` | [estate-adapter.ts](../../projects/demo/src/app/estate/estate-adapter.ts) |
| Adapter tests (13) | [estate-adapter.spec.ts](../../projects/demo/src/app/estate/estate-adapter.spec.ts) |
| Page: feature picker, environment tabs, sync-hop toggle, simulated health run, side panel with copy buttons | [estate.page.ts](../../projects/demo/src/app/pages/estate.page.ts) |

What it shows, using only existing library inputs (`nodes`, `transitions`, `groups`, `decorations`, `nodeKinds`, `statusStyles`, `farLabel`, `nodeSelected`):

- **Feature = selection.** Roots plus everything reachable along outgoing links within `depth` (a sync link is one hop), minus excludes. Checkout selects 10 components from 27.
- **Sync link = one edge** labelled `topic / messageType`. The **Show sync hops** toggle swaps it for the real path: API → outbox table → producer console → topic → consumer console → API. Without an outbox the first hop is `read` straight from the API (the legacy case). Shared relays and topics appear once.
- **Environment switch** changes the status overlay and the link templates; the graph stays the same. Components with no health row show `unknown` (the local emulator runs only part of the estate).
- **Health run** simulates the runner: every node goes `running`, then settles one by one. Node count stayed constant during the run, so no Mermaid re-render (checked in Playwright).
- **Links to copy:** the side panel lists repo, app, build and release URLs per environment (`null` template = absent, as for build and release on local). Clipboard output checked: `https://ci.example.test/qa/orders-api/latest`.

## Findings

- **Bug found by a test:** an outbox table took no status from its database when a status override was set. Fixed in the adapter (`statusOf`).
- **Zoomed-out nodes show the kind chip, not the name.** For an estate map the name matters more, so the page passes `farLabel` returning the repo name. A host that wants this should do the same; a default that prefers the title when a kind has a chip may be worth considering (open).
- **The adapter is the only place that knows the contract.** Swapping the synthetic registry for real files means writing a loader to the types in `estate-model.ts`; no library change needed.
- **Edge drill-down is faked** by the hop toggle (whole-graph switch). A per-edge expand would need library support (plan 15 gap list).
- **Layout:** `groupArrangement="mermaid"` with domain groups reads acceptably for 10-20 nodes; the expanded view for Checkout (22 nodes) opens larger than the viewport and needs Fit. Not measured beyond screenshots.

## Validation

- `npx ng test demo`: 13/13. `npm run demo:build`: OK. Library unit and e2e tests not run (library untouched).
- Headless Playwright on 1600×1000: page renders, env switch, sync toggle, health run, selection, copy. No e2e spec added.
- Not committed.

## Next (proposed)

1. Replace the synthetic registry with a loader for the real feature, component and link files; run it on one real feature.
2. Replace the simulated health run with a real runner graph (one check node per component).
3. Library: per-edge drill-down, dashed async edges, inspector link rows (see [plan 15](../plans/15_ideal-estate-model.md#how-it-maps-onto-the-library-proposed)).
