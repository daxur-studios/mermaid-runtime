# Group layout spike

Date: 2026-10-05. Status: Findings recorded; no library change made yet.

Source: User feedback after trying the [Large-flow lab](04_work-style-demos.md). Related: [Group layout options](../plans/08_group-layout-options.md), [LiteGraph feel gap](../plans/05_litegraph-feel-gap.md).

## User feedback

The #1 issue: groups render **one after another in a single line**, so a large flow never fits
the screen. Groups should sit next to each other (wrap) to use the space. Seen on Large-flow lab,
120 steps · 5 trips, compact subflows, left to right: a 317 × 4086 px strip (one column of 5 trip groups).

## Cause (code-verified + browser experiment)

`buildNodeDefinitionBlocks()` emits `subgraph … end` per group and only writes `direction` when the
host sets `NodeGroup.direction`. Mermaid 11.16 (installed) then applies two rules:

1. A cluster with **no edges to outside nodes** is laid out as its own graph, and without an explicit
   `direction` Mermaid **flips** it to the perpendicular direction (LR outer → TB inside).
2. Unconnected clusters all land on the same rank, so they line up **across** the flow (LR → stacked
   vertically; TD → side by side horizontally).

Combined: each trip is internally perpendicular, and the trips line up perpendicular too, giving one long
strip in either direction. With 6 connected phase groups (grouped view), cross-group node edges make
Mermaid ignore any group `direction` (documented Mermaid behaviour), so the chain is also one strip.

## Experiment

Rendered candidate sources with Mermaid 11 in the demo page (6-node trips; 4-step phases), measured the SVG viewBox,
and visually checked the three promising ones. Smaller w/h spread = fits a screen better.

| Variant | Source change | Size (px) | Result |
| --- | --- | --- | --- |
| Subflows, 5 trips, LR (current) | none | 283 × 2930 | one column of groups |
| Subflows, 5 trips, TD (current) | none | 7621 × 106 | one row of groups |
| Subflows, 5 trips, TD | groups `direction TB` | 1415 × 586 | ✅ 5 columns side by side |
| Subflows, 5 trips, LR | groups `direction LR` | 1524 × 530 | ✅ 5 rows stacked |
| Subflows, 10 trips, TD | groups `direction TB` | 2830 × 586 | ✅ but wide |
| Subflows, 10 trips, TD | + invisible `tripN ~~~ tripN+5` | 1415 × 1172 | ✅ 2 × 5 grid |
| Grouped, 1 trip, TD (current) | node-to-node edges across groups | 195 × 1776 | one tall column |
| Grouped, 1 trip, LR | groups `direction TB`, node edges kept | 2998 × 106 | ❌ direction ignored |
| Grouped, 1 trip, LR | groups `direction TB`, **group-to-group edges** | 1058 × 396 | ✅ phases side by side |
| Grouped, 1 trip, TD | groups `direction LR`, group-to-group edges | 600 × 636 | ✅ stack of short rows |

Key findings:

- **Explicit group direction = outer direction** fixes independent groups (subflows/trips) with no other change.
- **Invisible links between groups** (`~~~`) wrap independent groups into a grid of chosen width.
- **Connected chains** only compact if cross-group edges are drawn **group → group** instead of node → node; then
  per-group direction is honoured. This loses which exact node an inter-group edge leaves/enters.

The experiment used a CDN copy of Mermaid 11 in the browser, injected into the demo page and removed afterwards. No repo files changed.

## Next

Choose an option in [group layout options](../plans/08_group-layout-options.md).
