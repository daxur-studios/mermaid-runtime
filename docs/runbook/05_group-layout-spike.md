# Group layout spike

Date: 2026-10-05. Status: Findings recorded; plan 08 options A + B implemented the same day (see [Implementation](#implementation-same-day)).

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

## Implementation (same day)

User confirmed the model (steps flow in the chosen direction, groups line up across it) and asked for
"smart by default, customisable". Implemented options **A + B** of [plan 08](../plans/08_group-layout-options.md) as one policy:

- `groupArrangement` input on `GraphCanvasComponent` / `TaskGraphComponent`: `'auto'` (default) | `{ groupsPerLine }` | `'mermaid'` (legacy).
- Applies only to **independent** groups. Connected groups and host-set `direction` are untouched.
- `'auto'` picks groups-per-line maximising the fit scale `min(vw/W, vh/H)`, then balances lines (10 → 5 + 5, not 6 + 4).
  Group sizes start as estimates; real cluster sizes are measured after the first render. A group's box
  doesn't depend on the wrap, so this converges after one refinement. Re-evaluated only when the viewport aspect changes by more than 30%.
- Arranged groups are emitted in reverse source order, because Mermaid places sibling clusters reversed.
- Pure logic in [`group-arrangement.utils.ts`](../../projects/mermaid-runtime/src/lib/graph-canvas/group-arrangement.utils.ts) (unit-tested).

Two existing camera bugs surfaced and were fixed in the canvas:

1. **Superseded first render:** if a render replaced one that never reached the screen, it locked the host to an
   empty size and fit-all zoomed to the 4× maximum. Now treated as a first render. The viewport size is also seeded
   synchronously so the first render already knows it.
2. **Fit after direction change framed the old graph:** fit-all ran while the swap size lock still held the previous
   graph's size (and CSS-scaled the new SVG into it). The lock is now released before fitting, in the same task. This also
   affected direction switches before this change.

### Results (Large-flow lab, 1440 × 900, compact subflows)

| Case | Before | After |
| --- | --- | --- |
| 5 trips, LR | 317 × 4086 strip | 1728 × 836: 5 rows, Trip 1 on top |
| 5 trips, TD | 8777 × 140 strip | 1721 × 790: 5 columns |
| 10 trips, TD | 17589 × 140 strip | 1721 × 1614: 2 × 5 grid |
| 10 trips, LR | 317 × 8206 strip | 1728 × 1706: 10 rows (1 column fits better than 2 at this viewport) |
| Grouped steps (phases connected) | unchanged | unchanged (needs option C) |

Validation: library + demo production builds, 10/10 unit tests, 12/12 Playwright tests (new
[`group-arrangement.spec.ts`](../../e2e/group-arrangement.spec.ts) fails on the legacy layout at a 12.9 : 1 aspect and passes with `auto`).

## Connected chains: measured (2026-10-06)

**User-reported:** after installing the latest build at work, a long step process split into groups still renders as one tall column; the earlier fix only covers groups with no arrows between them.

**Code-verified:** `findIndependentGroupIds` skips any group with a node edge crossing its boundary, so connected groups get no direction and no wrapping. This is [plan 08 option C](../plans/08_group-layout-options.md) and had not been built.

Spike: synthetic chains (each phase's last step links to the next phase's first step), rendered directly with Mermaid 11.16.0 (the version both this library and the daemon use), size read from the SVG `viewBox`. "Fit" is the zoom at which the whole graph fits a 1440 × 900 viewport (1.0 = 100%).

**Correction (same day, after the user questioned it):** the first version of this section said compact layout needs arrows drawn group to group, and that Mermaid ignores group direction when a step has an arrow to a step outside. That was wrong for 11.16.0. With the real **step-to-step arrows only**, an explicit `direction` on each group gives exactly the compact layout. The "current" rows below left the group direction unset, which is what the library emits for connected groups. The older line in the spike table above ("node edges kept … direction ignored", 2998 × 106) was not reproduced on 11.16.0.

| Chain | Group direction | TD size | Fit | LR size | Fit |
| --- | --- | --- | --- | --- | --- |
| 6 phases × 4 steps | unset (today) | 205 × 2762 | 0.33 | 4326 × 140 | 0.33 |
| | set across the flow | 793 × 1010 | 0.89 | 1401 × 532 | 1.00 |
| 10 phases × 6 steps | unset (today) | 214 × 6706 | 0.13 | 10666 × 140 | 0.13 |
| | set across the flow | 1231 × 1706 | 0.53 | 2366 × 790 | 0.61 |
| 20 phases × 6 steps | unset (today) | 214 × 13446 | 0.07 | 21819 × 140 | 0.07 |
| | set across the flow | 1231 × 3446 | 0.26 | 4841 × 790 | 0.30 |

"Across the flow" means `LR` inside groups when the graph runs top to bottom, and `TB` when it runs left to right. Alternating it per group (`LR`, `RL`, `LR` …, a serpentine) gives the same size and puts each group's last step directly above or beside the next group's first step.

Findings:

- **Setting the group direction is the whole fix for layout** (3–4× larger on screen at 6–10 phases). No group-to-group arrows are needed.
- **What Mermaid draws for those arrows:** the arrow between phases runs from group box to group box (centre of one box edge to centre of the next), not from the exact last step to the first step. Keeping the exact endpoints needs us to draw those few arrows ourselves from the measured step positions.
- **Wrapping a chain into lines is a separate question.** A chain that is still too tall as one stack (20 phases: fit 0.26) could be split into columns or rows, but any arrow joining two lines would stack them again, so it would have to be drawn by us too.
- **ELK is not a way out.** With the ELK layout engine (via CDN, not installed) and step-to-step arrows, the chain is still one strip (6 × 4 TD: 159 × 2433; 10 × 6 LR: 9451 × 121) and group direction is ignored. Mermaid does not expose ELK's own wrapping options.
- A group with many steps is itself one long row in compact mode (30 steps ≈ 7000 px wide). Wrapping inside a group is not covered here.

### Implementation: option 1, direction for connected groups (2026-10-06)

Status: Done, not committed. Under `groupArrangement` `'auto'` (default) or `{ groupsPerLine }`, a group wired into others and without its own `direction` now gets the across-the-flow direction (`LR` in TD, `TB` in LR). `'mermaid'` keeps the legacy placement.

| Change | Where |
| --- | --- |
| Pure `connectedGroupDirection(flow)` (+ spec); used for groups that are not independent and have no host `direction` | `group-arrangement.utils.ts`, `graph-canvas.component.ts` (`readConnectedGroupDirection`) |
| New e2e: in the Large-flow "Grouped steps" view most phase boxes are long across the flow, in both directions | `e2e/group-arrangement.spec.ts` |
| README, `NodeGroup.direction` / `GroupArrangement` docs, and the consumer agent guide (synced to `.codex`) now describe chained groups and the arrow limitation; the old "omit `direction` for connected groups" advice is removed | `README.md`, `task-graph-model.ts`, `.claude/agents/use-mermaid-runtime.md` |

Validation: build OK; unit 32/32; e2e 14/14. Large-flow lab, "Grouped steps" (5 trips × 6 phases): top to bottom, the trips sit side by side and each trip's phases stack as short rows; left to right, the trips stack and each trip's phases run as columns.

Remaining problem (code-verified in the lab): Mermaid draws the arrow between two phases from group border to group border, not from the last step to the next first step, and one arrow (into "Parallel synchronization") loops out and back at the border. This is the known limitation the old caveat described. Fixed the same day, see the next section.

### Implementation: exact arrows between phases and `groupFlow` (2026-10-06)

Status: Done, not committed. **User-reported:** the mock-ups of both looks were good; fan-out and fan-in had to work; "do both, default to alternating".

| Change | Where |
| --- | --- |
| New input `groupFlow` (`'alternate'` default, `'same'`) on `mr-graph-canvas` and `mr-task-graph`; type `MermaidRuntime.GroupFlow`. Alternate reverses every second group along its chain (`LR`/`RL` in TD, `TB`/`BT` in LR), numbered by chain position (`computeGroupChainLevels`, cycle-safe) so parallel groups run the same way | `task-graph-model.ts`, `group-arrangement.utils.ts`, both components |
| Pure router `routeGroupCrossing`: elbow route from the step an arrow leaves to the step it enters; steps on one side use a lane in that side's margin, arrows between the same two groups share it (fan-out and fan-in read as one branching line), middle steps use their flow-facing side, left-to-right is the top-to-bottom route transposed; returns null for groups side by side. Plus `buildRoundedRoutePath`, `pickRouteLabelPoint` | `group-route-geometry.utils.ts` (+ 13 specs) |
| `routeGroupCrossings` rewrites the `d` of Mermaid's own edge path in the hidden render sandbox (so ids, classes, markers, status colours and pulses are kept), moves the label (Mermaid positions it on the outer `g.edgeLabel`), and sets `data-mr-routed="true"`. Runs before `raiseGroupLabels`; off with `groupArrangement: 'mermaid'` | `group-edge-routing.utils.ts` (+ 5 specs), `graph-canvas.component.ts` (`buildGroupCrossingPlan`) |
| Lab: "Group flow" selector | `work-e2e.page.html/.ts` |
| e2e: every arrow between phases is redrawn and starts and ends within 3 px of its steps, in TD and LR, alternate and same | `e2e/group-arrangement.spec.ts` |
| README, model docs and the consumer agent guide (synced to `.codex`) describe `groupFlow` and the redrawn arrows | `README.md`, `task-graph-model.ts`, `.claude/agents/use-mermaid-runtime.md` |

Validation: build OK; unit 53/53; e2e 15/15. Large-flow lab, "Grouped steps", 1 trip (6 phases): 6 redrawn arrows in all four combinations, no page errors; the two entry steps of "Parallel synchronization" are fed by one lane. A labelled cross-group arrow was checked against real Mermaid output (label sits on the outer `g.edgeLabel`); the lab has no labelled cross-group arrows, so label movement is covered by a unit test only.

Not covered (also in the README): an arrow that skips a phase runs down its source's lane and may cross groups in between; groups placed side by side keep Mermaid's arrow; arrows inside a group stay Mermaid's curves while redrawn ones are elbows (switching everything to elbows is an open question); wrapping a very long chain into several columns ([plan 08](../plans/08_group-layout-options.md#connected-chains-options-2026-10-06) option 3).

## Next

- User looks at the Large-flow lab and gives feedback on both group flows.
- Decide on elbow arrows everywhere, skip-phase arrows, and wrapping very long chains (plan 08 option 3).

## Fix: shared lane through a step when groups differ in width (2026-10-06)

- **User-reported (work project):** a hand-off between two groups of different widths ended with its arrowhead pointing the wrong way, and the line ran through the target step.
- **Cause (code-verified):** `readSharedLaneX` picked the middle of "the outermost step edge" and "the nearest border". When the wider group's steps reach past the narrower group's border, that interval is inverted, so the lane landed inside the wide group's step and the last run entered the step from inside.
- **Fix:** a shared lane is used only when it is past the steps of both groups and inside both borders. Otherwise each end uses its own margin lane and the arrow runs along the gap, so it enters the step from outside. Unit spec added for narrow-above-wide in both flow directions; unit 54/54, e2e 15/15.
- **Gap in tests:** the lab's phases are all the same width, so e2e could not hit this. The unit spec covers it.
