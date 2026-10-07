# Run banner, step timing and far-zoom detail — options

Date: 2026-10-07. Status: Built, not committed (2026-10-07). All five steps are done; see [the implementation record](../runbook/08_outstanding-requests.md#run-banner-step-times-and-far-zoom-text-2026-10-07).

Source: user request after the kinds work was committed ("re-center if we pan away far", "a completed state when all nodes complete", "time it took for groups and steps", "zoom out far to show just the times"). Backlog items [1, 3 and 6](../runbook/08_outstanding-requests.md) in the runbook are the same asks, now with the user's priorities. Parked by the user on 2026-10-07: Material icon verification, the database (cylinder) shape.

## Decision (user, 2026-10-07)

All three recommendations were accepted:

- **Completed state: C.** The banner fades after a few seconds and a small "done" pill with the totals stays in a corner. `runSettled` is emitted either way.
- **Time on the graph: B.** A right-aligned time in the node label and after the group name, drawn after render.
- **Far zoom: C.** A built-in default (time when done, `NN%` while running, blank when pending) plus a `farLabel` resolver input.
- Priority when messages overlap, and the "done" rule (complete or skipped = complete, any failed = failed), stand as proposed. The open questions at the end are still open and are answered with sensible defaults in the build.

## What the user asked for

1. A **re-center prompt** that shows when the graph has been panned or zoomed away, including when nothing is on screen.
2. In the same popup area, a **completed state** when every step has finished, with some clear UI for "fully done".
3. **Time taken**, for each step and for each group.
4. When **zoomed far out**, show different text per step, for example only the time. Customisable, and it must work in the work app.

The user was unsure whether 2 and 4 belong to the library. They do: the library already holds every node's status, so it can tell when a run is done, and it owns the zoom.

## What exists today (code-verified)

- A re-center chip exists (`.graph-canvas__recenter`, top centre) but it shows only while following a running node and following is paused ([`showRecenterChip`](../../projects/mermaid-runtime/src/lib/graph-canvas/graph-canvas.component.ts)). It says nothing about the graph being off screen.
- The camera knows the transform and the content rectangle (`contentRect()`), so "how much of the graph is in view" can be computed without new Mermaid work.
- `Node` already carries `startedAt`, `endedAt` and `durationMs`, and the inspector shows them. Nothing draws them on the graph, and the demo gives no node any timing.
- Groups have no timing of their own; it has to be derived from their steps.
- Nodes look the same at every zoom. Only the background pattern changes with zoom.
- `mr-task-graph` emits no run-level event. Nothing fires when all steps finish.

## Shared piece: one banner at the top centre

Items 1 and 2 share one slot. One banner component slides down and fades in, one message at a time: **back to graph**, **run complete**, **run failed**, or a host message. This replaces the current re-center chip, which keeps its follow-running message. Priority when several apply: failed, then complete, then back to graph.

## Decision 1 — what the completed state does

| Option | How | Gives up |
| --- | --- | --- |
| **A. Stays until dismissed or the run restarts** | Banner "Run complete · 12 of 12 steps · 48 s" with a close button | A permanent strip of chrome until you dismiss it |
| **B. Fades after a few seconds** | Slides in, stays about 6 s, slides out | Easy to miss if you looked away; no lasting "this run is done" |
| **C. Banner plus a lasting marker** | Banner fades; a small "done" pill stays in a canvas corner with the totals | One more element on the canvas |
| **D. Event only** | Library emits `runSettled`; host draws its own UI | Every host builds the same thing |

Recommendation: **C**. The banner is the celebration, the pill is the answer to "is it finished?" an hour later. Every option also emits `runSettled` so hosts can react.

What counts as done (proposed, open): all steps `complete` or `skipped` is **complete**; any `failed` is **failed**; anything still running or not started is **running**. A run with skipped steps says "10 of 12 steps · 2 skipped".

## Decision 2 — where times show on the graph

| Option | How | Gives up |
| --- | --- | --- |
| **A. In the chip row** | Time appears as a small chip (`2.3 s`) next to the existing chip, and in the group title | Competes with the kind chip for space on narrow nodes |
| **B. Right edge of the node** | A fixed right-aligned time in the label, group title gets it after the name | Needs a reserved slot, so every node is slightly wider |
| **C. Border badge** | Reuse the `NN%` border badge for the time once a step is finished | Not readable when many nodes are tight; shares a spot with progress |

Recommendation: **B**, drawn after render like the icon (no Mermaid re-render, so a running step's live timer ticks without moving the layout). Group time is the wall clock from the first step start to the last step end, with the sum of step times in the inspector. Steps without timing show nothing.

## Decision 3 — what far zoom shows

| Option | How | Gives up |
| --- | --- | --- |
| **A. CSS bands, built-in far text** | The canvas sets `data-zoom="far"` below a node on-screen size; CSS hides the title and subtitle and shows a large time (or `NN%` while running) | The far text is fixed unless the host overrides |
| **B. Host resolver** | A `farLabel` input, `(node) => string \| null`, with the time as default | The host writes code for anything custom |
| **C. A and B together** | A built-in default (time when done, `NN%` while running, blank when pending) plus the resolver to override | Slightly more API |
| **D. Re-render at far zoom** | A second Mermaid render with simplified labels | Layout jumps, slow on 240-step flows; ruled out |

Recommendation: **C**. The band comes from the on-screen node height, with a gap (hysteresis) so it does not flicker at the edge. The far text is drawn as an overlay scaled so it stays readable at any zoom, and the node keeps its shape, ring and status colour, so the flow still reads as a map.

## Recommended order

1. **Reset centres the graph** (backlog item 2, small, same camera code).
2. **Banner with "back to graph"** when little of the graph is in view, replacing the follow-only chip.
3. **Run summary function, `runSettled` event, completed state** (Decision 1).
4. **Step and group timing** (Decision 2). Gives the demo synthetic timings first, because the lab has none.
5. **Far zoom** (Decision 3). Last, because it reuses the timing from step 4.

Each step is built, validated (unit, e2e, build, lab check) and left uncommitted for the user.

## Open questions

- Does the work app send `startedAt`/`endedAt` per step, and per group, or only `durationMs`?
- Should a step that is running show a live elapsed time that ticks each second?
- Is there a stable "run started" time on the whole run, so the total time is the real run time and not just the sum of steps?
- At far zoom, should pending steps show nothing, or a dash?
