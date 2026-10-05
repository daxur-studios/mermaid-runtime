# Outstanding requests

Date: 2026-10-05. Status: Open. Nothing here is scheduled yet.

Source: user review in the Large-flow lab after [group titles above arrows](07_progress-and-background-fixes.md#group-titles-above-arrows-same-day). Related plans: [04 Rich node content](../plans/04_rich-node-content-options.md), [05 LiteGraph feel gap](../plans/05_litegraph-feel-gap.md), [10 Canvas theme](../plans/10_canvas-theme-and-background-options.md), [11 Node progress](../plans/11_node-progress-and-overlay-fixes.md).

Each item records what the user asked for (**user-reported**) and what the code does today (**code-verified**). Ideas for how to do it are **proposed** only; option papers come before any of the bigger items.

## New requests

### 1. Zoomed-out node detail (level of detail)

**User-reported:** when zoomed far out, a node should switch to a simpler version that is still readable and looks good. For example, show only the run time, or only the `%` while it runs, instead of the node's text. It should be configurable. Custom HTML nodes could supply both a close-up and a zoomed-out version.

**Code-verified:** nodes look the same at every zoom; text just gets smaller. Only the background pattern changes with zoom.

**Proposed:** zoom bands (for example far, mid and near) chosen from the on-screen node size, a host setting for what each band shows, and a hook so custom nodes can provide their own far version. Needs an option paper; it overlaps with plan 04.

### 2. Reset should centre the graph

**User-reported:** the Reset button in the camera controls puts the graph at the top-left corner instead of centring it.

**Code-verified:** `GraphCameraComponent.reset()` sets the identity transform (no pan, 100% zoom), which is the top-left corner by design. `fitAll()` already fits and centres.

**Proposed:** Reset centres the graph at 100% zoom, or at the fitted zoom if 100% does not fit. Small change.

### 3. "Back to graph" prompt when you get lost

**User-reported:** after zooming far out or panning away from the graph, a subtle prompt should appear at the top centre and slide down while fading in, like Chrome's "press F11 to exit full screen" hint. Clicking it brings the graph back.

**Code-verified:** a recentre chip exists (`.graph-canvas__recenter`), but it only shows while *following a running node* and the user has paused following. It does not appear just because the graph is off-screen.

**Proposed:** show it when little or none of the graph is in view, or when the graph is too small on screen to read; hide it again once the graph is back. Build it as one message of the shared top banner in item 6, reusing the chip's style.

### 4. More node shapes, with progress around them

**User-reported:** every node is a rectangle. Shapes such as square, database (cylinder) and rhombus would help, as long as progress rings follow the shape. The demo pages show no examples of other shapes.

**Code-verified:** `decoration.shape` accepts `'rect' | 'diamond' | 'subroutine'`. Rings and outlines follow rectangles and polygons (`<rect>`, `<polygon>`), so diamonds already work. Mermaid shapes drawn as paths, such as the database cylinder, have no ring support yet. No demo page shows a diamond or subroutine node.

**Proposed:** add a shapes demo first (rect, diamond, subroutine, each running), then add more shapes and ring support for path-drawn shapes.

### 5. Custom HTML node example

**User-reported:** a demo of nodes with custom HTML content.

**Code-verified:** plan 04 compares ways to do it; none is built yet.

**Proposed:** pick an option in plan 04, then add a demo page. Ties in with item 1 (custom far version).

### 6. Clear "all steps complete" signal, via a shared top banner

**User-reported:** today you have to check that every step is green to know a run has finished. There should be a clear indication instead. The user suggested one top banner that slides in and out and can show several kinds of message: the "back to graph" prompt from item 3, "Run complete · 12 of 12 steps · 48 s", or a custom message from the host.

**Code-verified:** the library has no run-level summary. `mr-task-graph` emits only node and navigation events (`nodeSelected`, `nodeContextMenu`, `subgraphEntered`, `subgraphLeft`, `graphPathChange`); nothing fires when all steps finish, and no total time is shown.

**Proposed:**
- One banner component at the top centre of the canvas, shared by items 3 and 6, that slides down and fades in, then out.
- A pure function that turns node statuses into a run summary (running, complete, failed, counts, total time when nodes have timing), plus a `runSettled` event so hosts can react too.
- Built-in messages for "run complete", "run failed" and "back to graph"; an input for host messages.
- Open questions: does "complete" stay visible or fade after a few seconds; what counts as done when some steps are skipped; does a failure outrank the "back to graph" prompt when both apply.

## Found in the same review

### 7. Group titles sit a little left of centre

**User-reported:** the group titles may not be centred.

**Code-verified (measured in the lab, "Grouped steps"):** every title is 20–25 graph units left of its group's centre. For example, "Trip 5 / Parallel synchronization": group centre 383, title centre 358.

**Cause:** the library shrinks group titles to `0.78rem` in CSS after Mermaid has measured them at its own size. Mermaid centres a box sized for the larger text, and the smaller text sits at the left of that box. This was already the case before the titles were raised; the pill makes it visible.

**Proposed fix:** when raising titles, centre the measured text (and its pill) on the box Mermaid centred. Small change, unit-testable.

## Carried over

These were already listed elsewhere; collected here so the backlog is in one place.

- Commit the work in runbook entries 05–07 (nothing is committed yet).
- Confirm the default preset: midnight for the library, material for the daemon ([plan 10](../plans/10_canvas-theme-and-background-options.md)).
- Theme presets `blueprint`, `paper`, `material`, the `cross` pattern and whole-look variables (plan 10 B + D).
- Plan 11 leftovers: combined child progress helper and demo child rings (item 5), progress on subflow preview thumbnails (item 6), README subflow example (item 8).
- Compact layout for groups connected in a chain ([plan 08](../plans/08_group-layout-options.md) C).
- Pick a daemon extraction option ([plan 09](../plans/09_daemon-extraction-candidates.md)).
- Subflow preview thumbnails still draw group titles under the arrows; the title pill padding is fixed in code; the consumer agent guide does not mention the title variables yet.
- The daemon overrides the dot colour (opacity 0.1), so it shows dimmer dots until it drops that override or uses `material`.
