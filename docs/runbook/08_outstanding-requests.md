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

**User-reported (2026-10-06):** the user shared a reference system diagram with database cylinders, hexagon topics, double-bar process boxes, circles, per-kind colours and domain boxes. Mermaid flowcharts support these natively (custom shapes, CSS classes, click events, markdown labels), and it also has other diagram types such as `stateDiagram-v2`. The library only builds `flowchart` sources today (code-verified: `flowchart TD`/`LR` in `buildGraph`), so other diagram types would belong to [plan 07](../plans/07_system-visualisation-options.md)'s multi-diagram seam.

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

## Long step names (2026-10-06)

**User-reported:** at work most step labels are too long for their nodes and overflow. The demo only had short names. The user chose option A (wrap to a max width) with a smaller line height. Design review (Opus 5.5) also proposed line clamping, a title + subtitle line, shapes, a kind registry and group tones; those are not built.

**Cause (code-verified):** Mermaid measures a label before the canvas stylesheet applied its padding, so the text wrapped onto more lines than the box was sized for and spilled out.

**Change:**
- `NODE_LABEL_CSS` in `mermaid-theme.ts` is passed to Mermaid as `themeCSS`, so padding, line height and word breaking apply while Mermaid measures. The old rule in `graph-canvas.component.scss` is removed.
- `flowchart.wrappingWidth` is set to 200px (Mermaid's default, now named) and `overflow-wrap:anywhere` breaks a single long identifier at that width.
- Line height is 1.2 (Mermaid's inline default is 1.5).
- `withNodeLabelLayout` adds both to a host's own `mermaidConfig`. The host's `themeCSS` follows ours, and its `wrappingWidth` is kept.
- The Large-flow lab has a **Long step names** checkbox.

**Validation:** unit 58/58 (3 new), e2e 16/16 (1 new, `e2e/node-labels.spec.ts`). The new e2e fails on the old code (about 3px spill) and passes now, in TD and LR. Library build OK. Not committed.

**Not done:** a step title containing a double quote still breaks the whole graph, because `escapeMermaidString` writes `\"` and Mermaid expects `#quot;`. Sideways overflow at work may come from the host's own CSS or fonts, which the lab cannot show.

### Subtitle (command line) under the title (2026-10-06)

**User-reported:** steps are CLI calls, so each wants a readable title plus a line like `somecli somecommand {{someParam}}`. The user liked the subtitle option from the design review.

**Change:** `Node.subtitle` is drawn under the title in a smaller monospace face (`.mr-node-subtitle` in `NODE_LABEL_CSS`, so it is measured with the box). It is escaped as text and wraps like the title. The inspector shows it in full under **Command**. The Large-flow lab has a **Command lines** checkbox.

**Also fixed:** `escapeMermaidString` now writes `#quot;`, so a title, group or edge label with a double quote no longer stops the graph rendering.

**Validation:** unit 58/58, e2e 17/17 (1 new: command text with quotes, `<public_guid>` and `{{depotId}}` shows as typed). Library build OK. Not committed.

**Not done:** highlighting `{{param}}` placeholders, a separate CLI-name prefix or chip (part of the kind-registry slice), shapes, line clamping.

### `{{placeholder}}` highlight (2026-10-06)

`{{name}}` inside a subtitle is wrapped in `.mr-node-param` and drawn bold amber (`--mr-node-param-color` overrides it). The subtitle is dimmed with `color-mix` rather than opacity so the placeholder stays vivid. The status rules that force label text to the surface colour (`.node.done span` and the like, plus hover) now skip `.mr-node-subtitle` and `.mr-node-param`. e2e covers one highlighted placeholder per node. Not committed.

### Node shapes: what exists today (2026-10-06, code-verified)

- Exposed: `NodeDecoration.shape` is `'diamond'` or `'subroutine'`; everything else is a rectangle.
- Mermaid 11.16 draws many more through `@{ shape: … }` (rounded, stadium, hex, cyl, lean-r, …). Raw Mermaid output with the library's label CSS was measured: footprints for a long title plus command are rect 260×95, rounded 230×95, stadium 235×80, hexagon 255×80, diamond 295×295, cylinder 215×127, parallelogram 295×80, subroutine 231×80.
- The selected/current ring, outline and progress trace read the shape back from the SVG (`shape-offset.utils.ts`): exact for rect, rounded rect and diamond; other polygons (hexagon, parallelogram, subroutine) get a bounding-box ring; path-drawn shapes (stadium, cylinder) get none. Elbow arrows use each step's bounding box, so a slanted side leaves a visible gap.

### Rounded, hexagon and parallelogram shapes (2026-10-06)

**Change:** `NodeDecoration.shape` also accepts `'rounded'`, `'hexagon'` and `'parallelogram'` (written with Mermaid's classic `( )`, `{{ }}` and `[/ /]` syntax, so label escaping is unchanged). The Large-flow lab has a **Shapes by step type** checkbox (assert → hexagon, SQL → rounded, Kafka → parallelogram).

**Fixed for them:**
- The selected/current ring and progress trace now offset any convex polygon exactly (`tryOffsetConvexPolygon`), so a hexagon or parallelogram gets a ring that follows its outline instead of a box around it. Non-convex shapes (subroutine) still use the box.
- Elbow arrows drawn between phases used to end on the step's bounding box, leaving a gap at a parallelogram's slanted side. Step boxes now carry `inset` (how far the outline sits inside the box at the middle of each side, `readPolygonCentreInsets`), and the router ends arrows on the real edge. It is 0 for rect, diamond and hexagon, so nothing else moved.

**Validation:** unit 68/68 (10 new), e2e 18/18 (1 new, `e2e/node-shapes.spec.ts`), library build OK, checked in the lab. Not committed.

**Not done:** stadium and cylinder (path-drawn: need ring, status colour and progress support), the kind registry (shape = intent, chip = tool), group tones. Arrows Mermaid routes itself inside a group already meet the slanted edge.

### Kind registry, icon, chip and tone (2026-10-06)

**Plan:** [12 Node kinds](../plans/12_node-kind-registry-options.md). **User-reported:** a database step that polls and one that calls once should both be "database", with a second cue to tell them apart. The stacked-outline idea was rejected.

**Change:**
- `GraphCanvasComponent.nodeKinds` (and `TaskGraphComponent.nodeKinds`) maps a node's `type` to `{ shape, icon, chip, tone }`. A `decorations` entry still wins field by field; an empty string clears a kind's value (`resolveNodeStyle`, `node-kind.utils.ts`).
- **Icon:** a Material icon name (needs the host's Material Icons font) or a full `<svg>` string. The label only reserves an empty slot; the icon is drawn into it after the render, so a host SVG never passes through the Mermaid source. The SVG is parsed and stripped of scripts, handlers, external references and fixed sizes first.
- **Chip:** a pill on the command-line row (`poll 5s`, `psql`), plain text, escaped like the command line.
- **Tone:** colours the chip and icon only, never the node fill, so status colours keep their meaning. Built-in names: `accent`, `violet`, `teal`, `green`, `amber`, `rose`, `slate` (`NODE_TONE_COLOURS`, re-colourable with `--mr-tone-<name>-colour`); a host adds its own with `.mr-tone-<name> { --mr-tone: ... }`.
- **Demo:** the Large-flow lab checkbox is now **Kinds by step type**: assert is a teal hexagon with a tick, SQL a rounded node with a database icon and a `psql` chip, Kafka a violet parallelogram with a send icon and a `kafka` chip. "Poll SQL cache" overrides its kind with a refresh icon and an amber `poll 5s` chip.

**Two bugs found and fixed on the way:**
- Status styling (hover, running, done, failed) forced label text to the surface colour, which would have erased the chip and icon colours. The selectors now skip `.mr-node-chip` and `.mr-node-icon`.
- Mermaid's own `.node path` rule recoloured the strokes inside the icon SVG to grey, whatever the tone. The icon's shapes now inherit from the icon (`themeCSS`), and an e2e check guards it.

**Validation:** unit 78/78 (10 new), e2e 19/19 (1 new), library build OK, checked in the lab on zoomed node crops. Not committed.

**Not done:** the cylinder (path-drawn: ring, status colour, progress), pre-made kinds with variants (database: query, poll, write) and a legend, group tones. A Material icon name was not run against a real Material font (the demo uses SVG icons). Not checked in the work app, which has its own CSS and fonts.

### Status-aware icon and chip (2026-10-06, same day)

- **User-reported:** green check icons on steps that had not started made the flow look already done.
- **Change:** a step that has not started shows its icon and chip as grey at 50% opacity. Running and done keep the kind's tone. Failed turns the icon and chip red (`--app-color-fail`). Colour and opacity only, so the measured layout does not move. `!important` is needed because Mermaid's theme rules are scoped under the diagram id. Added the built-in `green` tone; the demo's assert kind now uses it.
- **Not done:** swapping the glyph itself (check → ✕ on failure). It is possible, but the icon is drawn after render and a swap would need a second icon per kind; colour alone already separates the three states.
- **Validation:** unit 78/78, e2e 20/20 (new: pending cues are dim, started cues are not), build OK, lab crops checked for pending, running and a forced failed class. The demo's SQL-timeout scenario did not reach a failed step in the probe, so the red look is checked with a forced class, not a real failure. Not committed.

### Run banner, step times and far-zoom text (2026-10-07)

Source: user request after the kinds work was committed; options and picks in [plan 13](../plans/13_run-banner-timing-and-far-zoom-options.md). Covers backlog items 1, 2, 3 and 6.

- **Reset centres the graph** (item 2): `GraphCameraComponent.reset()` frames the content at 100% zoom, or at the fitted zoom when 100% does not fit. It falls back to the identity transform when nothing is measured.
- **One banner at the top centre** (items 3 and 6): new `mr-graph-banner`, one message at a time, slides down and fades. It replaces the old follow-only re-center chip. Priority: run failed, run complete, host message (`banner` input), "Back to graph", "Re-center on running". Chosen by the pure `pickBannerMessage`.
- **"Back to graph"**: shows after the graph has been out of view for 500 ms. Out of view means less than 10% overlap, measured against the smaller of the graph and the viewport, so a big graph filling the screen or a graph zoomed far out is never flagged. Computed from the camera and the cached content rectangle, with no DOM measuring while panning.
- **Run result**: `summariseRun` reads the root graph's steps. Complete = nothing running or waiting and nothing failed (skipped counts as done). Failed = something failed and nothing is running. An unknown status counts as waiting. The banner stays 6 s, then a small pill (`Complete · 12/12 · 48 s`) stays in the top-right corner until the next run starts. `runSettled` is emitted once on the change, not for a run that is already finished when the graph first appears.
- **Step and group times** (`showTimes`, off by default): a right-aligned time in the label, written after render into a slot the label reserves (so a tick never re-renders; checked by the generation counter). Group time is a pill beside the group title: the span from the first start to the last end, counting up while a member runs. A running step with `startedAt` and no duration counts up once a second, only while one exists. Steps that have not started show nothing.
- **Far-zoom text** (`farZoomScale`, default 0.6, `null` turns it off; `farLabel` override): below the scale each node hides its label and shows one large line, `NN%` while running, its time when done, nothing before it starts. A `farLabel` string wins, an empty string shows nothing, null falls back. The size is set in CSS from the zoom and capped by the node's own size. It returns above 1.2 times the threshold, so it does not flicker at the edge. Group titles (with their time pill) also grow in that band to stay about 16 px tall on screen, but never wider than their group (`--mr-group-far-px`, `--mr-group-far-max-scale` override).
- **Demo**: the work page has a "Step times" checkbox and synthetic timings (the failing SQL wait took 30 s).
- **Validation:** unit 115/115 (37 new), e2e 26/26 (6 new: banner and pill, failed run, panning away and Reset, times, times off, far zoom), build OK. Checked in the browser: "Back to graph" banner, complete banner and pill, step and group times, far-zoom times on the 240-step flow.
- **Limits:**
  - The run summary counts the root graph's own nodes, so in the compact-subflows view "6 of 6" counts phases, not the 24 steps inside them.
  - Far text is capped by node size, so on a 240-step flow fitted to the screen it is small (nodes are only about 5 px tall there); it helps most in the middle zooms.
  - The demo's SQL-timeout run shows the failed banner in e2e, but I have not looked at it in the browser.
  - Not checked in the work app. The work app must send `startedAt`/`endedAt` or `durationMs`, and `showTimes` must be turned on.
  - Not done: group tones, long-title clamping, a legend, a stadium shape.
- Not committed.
