---
name: mermaid-runtime
description: Add, theme, and debug the interactive Mermaid task-graph viewer from @daxur-studios/mermaid-runtime in an Angular app. Use when rendering a task, run, or workflow graph, wiring TaskGraphComponent or GraphCanvasComponent, colouring node statuses and progress, grouping nodes, drilling into subgraphs, replaying a recorded run, showing run cards, or providing the inspector ref loader.
---

# @daxur-studios/mermaid-runtime

An Angular 20 library that renders a live, pan/zoomable **task graph** (a Mermaid flowchart)
with status colours, progress traces, node grouping, subgraph drill-down, timeline replay,
run cards and a pluggable ref-loader seam. It depends on nothing daemon-specific — the host
adapts its own data to the `MermaidRuntime.*` model.

## 1. When to apply

- Rendering a task / run / workflow graph in an Angular app.
- Wiring `TaskGraphComponent` (drop-in) or `GraphCanvasComponent` (canvas-only, custom chrome).
- Colouring node statuses, drawing progress, or decorating/grouping nodes.
- Drilling into a node's subgraph, or replaying a recorded execution history.
- Showing a list/grid of runs (`GraphCardComponent`), or wiring the inspector ref loader.

## 2. Install and peers

```bash
npm install @daxur-studios/mermaid-runtime
```

Peer dependencies (all but `ngx-markdown` are required):

```json
{
  "@angular/common": "^20.3.0",
  "@angular/core": "^20.3.0",
  "@angular/cdk": "^20.0.0",
  "@angular/material": "^20.0.0",
  "mermaid": "^11.16.0",
  "rxjs": "~7.8.0"
}
```

`ngx-markdown` (`^20.1.0`) is **optional** and only needed if you use `GraphCanvasComponent`
directly (it renders the Mermaid block via `MarkdownModule`). The host app must apply Angular
Material's theme (`@include mat.theme(...)`) so the M3 design tokens the chrome uses exist.

## 3. Public entry points

Everything is re-exported from the **package root**:

```ts
import {
  TaskGraphComponent,           // <mr-task-graph>       — drop-in viewer (canvas + inspector)
  GraphCanvasComponent,         // <mr-graph-canvas>     — canvas only; compose your own chrome
  GraphInspectorComponent,      // <mr-graph-inspector>  — sidebar; project into canvas [detail]
  GraphCameraComponent,         // <mr-graph-camera>     — generic pan/zoom wrapper (any content)
  MinimapComponent,             // <mr-minimap>          — relocatable corner minimap
  GraphCameraControlsComponent, // <mr-graph-camera-controls> — zoom/pan/direction buttons
  GraphBreadcrumbComponent,     // <mr-graph-breadcrumb> — subgraph-depth trail
  TaskGraphReplayComponent,     // <mr-task-graph-replay> — timeline playback
  GraphCardComponent,           // <mr-graph-card>       — run card with mini preview
  GraphCardListComponent,       // <mr-graph-card-list>  — responsive grid/list container
  computeGraphProgress,         // helper → { total, done, running, failed, percent }
  resetGraphStatuses,           // helper → clone a graph with node statuses reset
  MermaidRuntime,               // the data-model namespace
  TaskGraphRefLoader,           // interface for the ref-loader seam
  TaskGraphRefRequest,          // request shape passed to loadRef()
  TASK_GRAPH_REF_LOADER,        // DI token
} from '@daxur-studios/mermaid-runtime';
```

**Do not import from sub-paths** (e.g. `.../graph-canvas`). All selectors use the `mr-`
prefix, not `app-`.

## 4. API reference

### 4.1 Data model — the `MermaidRuntime` namespace

```ts
MermaidRuntime.Node       // { id, title, status, subtitle?, detail?, error?, type?, timing?,
                          //   dependencies?, transitions?, progressPercent?, progressLabel?,
                          //   activeChildNodeProgresses?, inputRefs?, outputRefs?, contextRefs?,
                          //   logRefs?, artifactRefs?, subgraphId?, subgraphLabel?, subgraph? }
MermaidRuntime.Transition // { from, to, label?, condition? }
MermaidRuntime.Graph      // { nodes, transitions?, groups? } — the recursive graph/subgraph type
MermaidRuntime.NodeGroup  // { id, label, nodeIds, direction? } — a visual cluster
MermaidRuntime.ExecutionEvent // { seq, at, kind: 'node-started'|'node-ended'|'edge-traversed', nodeId?, … }
MermaidRuntime.NodeStatus = 'undone' | 'running' | 'complete' | 'failed' | 'skipped' | (string & {})
MermaidRuntime.StatusStyleMap // Partial<Record<NodeStatus, { className, label? }>>
MermaidRuntime.NodeDecoration // { displayTitle?, shape?, icon?, chip?, tone?, badge? }
MermaidRuntime.NodeKindStyle  // { shape?, icon?, chip?, tone? } — style a whole kind by node.type
```

An inline `subgraph` carries its own `nodes`/`transitions` for arbitrary nesting; a
`subgraphId` is resolved lazily by the host via `[subgraphResolver]`. This is unrelated to
`NodeGroup` (see Troubleshooting).

### 4.2 `TaskGraphComponent` (`<mr-task-graph>`) — drop-in viewer

The all-in-one: canvas + optional inspector. Key inputs (all optional except `nodes`):

- `[nodes]` (required), `[transitions]`, `[groups]`, `[groupArrangement]` (`'auto'` default),
  `[groupFlow]` (`'alternate'` default).
- `[selectedNodeId]`, `[currentNodeId]`, `[runId]`, `[showInspector]`.
- `[decorations]`, `[nodeKinds]`, `[statusStyles]`, `[mermaidTheme]` (`'dark'` default).
- `[direction]` (two-way `model<'TD' | 'LR'>`), `[backgroundEffect]` (`'dots'` default).
- `[progressRings]` (`'active'` default), `[childProgressRings]`, `[showTimes]`.
- `[rootLabel]`, `[showBreadcrumb]`, `[showSubgraphPreview]`, `[showMinimap]`.
- `[subgraphResolver]`, `[path]`, `[followExecution]`, `[banner]`, `[mermaidConfig]`.
- `[replayActive]`, `[replayEvent]`, `[farZoomScale]`, `[farLabel]`.

Outputs: `(nodeSelected)`, `(selectionCleared)`, `(nodeContextMenu)`, `(subgraphEntered)`,
`(subgraphLeft)`, `(graphPathChange)`, `(runSettled)`.

### 4.3 `GraphCanvasComponent` (`<mr-graph-canvas>`) — canvas only

Same core graph inputs as above, minus the inspector slot. Two **attribute-selector** content
slots (plain projection selectors, not directives) bound through a template ref `#canvas`:

- `[overlay]` — viewport-anchored chrome (toolbars, minimaps, context menus).
- `[detail]` — a side panel (e.g. your own `<mr-graph-inspector>`).

Exposes signals for host chrome: `selectedNode()`, `contextMenuTarget()`,
`minimapContentRect()` / `minimapViewportRect()` / `minimapNodes()`, `breadcrumb()`, and
methods `zoomIn()` / `zoomOut()` / `fitAll()` / `resetCamera()` / `centerOnPoint()` /
`goToDepth()` / `enterSelectedSubgraph()` / `closeContextMenu()`.

### 4.4 Relocatable built-in chrome

Three pieces render built-in by default; set the matching `*Placement` input to `'host'` and
render the standalone component where your layout needs it (or turn it off with
`showMinimap`/`showBreadcrumb`):

| Chrome          | Placement input           | Standalone component                     | Bind to                                                        |
| --------------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| Minimap         | `minimapPlacement`        | `<mr-minimap>`                           | `canvas.minimapContentRect()` / `minimapViewportRect()` / `minimapNodes()` |
| Camera controls | `cameraControlsPlacement` | `<mr-graph-camera-controls [canvas]="…">`| pass the `#canvas` template ref                               |
| Breadcrumb      | `breadcrumbPlacement`     | `<mr-graph-breadcrumb [breadcrumbs]="…">`| `canvas.breadcrumb()`                                         |
| Inspector       | `inspectorPlacement`      | `<mr-graph-inspector>`                   | project into `[detail]` yourself                              |

### 4.5 Replay and run cards

- `<mr-task-graph-replay [events] [baseNodes] [transitions] (stateChange)>` scrubs/plays a
  recorded `MermaidRuntime.ExecutionEvent[]`; `(stateChange)` emits
  `{ nodes, currentNodeId, currentEvent, isReplaying }` to feed a live viewer.
- `<mr-graph-card [graph] [title] [subtitle] [previewMode] (cardClick)>` renders one run with
  a mini preview header; project slots `[header-actions]`, `[badge]`, `[meta]`, `[actions]`.
  `<mr-graph-card-list [layout] [columns]>` lays cards out in a grid or list with an `[empty]` slot.

### 4.6 Ref loader (inspector previews)

```ts
@Injectable({ providedIn: 'root' })
export class MyRefLoader implements TaskGraphRefLoader {
  loadRef(req: TaskGraphRefRequest): Observable<MermaidRuntime.RefContent> {
    return this.http.get<MermaidRuntime.RefContent>(`/api/runs/${req.runId}/nodes/${req.nodeId}/refs/${req.refId}`);
  }
}
// providers: { provide: TASK_GRAPH_REF_LOADER, useExisting: MyRefLoader }
```

Without a loader the inspector hides the preview section gracefully. Pass `[runId]` so the
loader can build its route.

## 5. Examples

Adapting your own model (the common integration): map a **structural subset** of your data
onto `MermaidRuntime.Node`/`Transition`. There is no runtime requirement — the mapping is the
contract, so a daemon-style `TaskRunNode[]` fits with no adapter at all:

```ts
// You own your model; map it onto the runtime's shapes.
export function toGraphNodes(runs: MyRunNode[]): MermaidRuntime.Node[] {
  return runs.map((n) => ({
    id: n.key,
    title: n.label,
    status: n.state,            // a built-in status, or your own [statusStyles] key
    type: n.kind,               // drives [nodeKinds] styling
    progressPercent: n.percent,
    activeChildNodeProgresses: n.childPercents,
    subgraphId: n.childTaskId,  // resolved lazily via [subgraphResolver]
  }));
}
```

`subgraphResolver` must answer **synchronously**, so prefetch the resolved child graphs into a
map up front and read from it in the resolver, rather than fetching per click.

Minimal drop-in:

```ts
import { TaskGraphComponent, MermaidRuntime } from '@daxur-studios/mermaid-runtime';

@Component({
  imports: [TaskGraphComponent],
  template: `
    <mr-task-graph [nodes]="nodes()" [transitions]="transitions()" [showInspector]="true" />
  `,
})
export class MyPage {
  readonly nodes = signal<MermaidRuntime.Node[]>([
    { id: 'a', title: 'Fetch data',  status: 'complete' },
    { id: 'b', title: 'Process',     status: 'running', progressPercent: 42 },
    { id: 'c', title: 'Save result', status: 'undone' },
  ]);
  readonly transitions = signal<MermaidRuntime.Transition[]>([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
}
```

Canvas-only with your own inspector:

```html
<mr-graph-canvas #canvas [nodes]="nodes()" [followExecution]="true">
  <mr-graph-inspector detail [node]="canvas.selectedNode()" [runId]="runId()" />
</mr-graph-canvas>
```

Grouping a long chain, then mirroring subgraph depth into history:

```html
<mr-task-graph [nodes]="nodes()" [groups]="groups()" groupArrangement="auto" groupFlow="alternate" />
```

```ts
onGraphPathChange(path: string[]): void {
  this.graphPath.set(path);
  window.history.pushState({ graphPath: path }, '');
}
```

## 6. Troubleshooting

- **Progress trace, minimap dots, or the inspector running row are invisible.** Cause: the
  required CSS variables are unset — those rules have **no fallback**. Fix: define
  `--app-color-pass`/`-fail`/`-warn` (+ `-bg`) and `--app-color-running-bg` globally. See Theming below.
- **Nothing renders / it looks unstyled.** Cause: Angular Material's M3 tokens
  (`--mat-sys-*`) are missing. Fix: apply Material's theme in the host (`@include mat.theme(...)`).
- **Selectors/imports not found.** Fix: selectors are `mr-*`; import everything from the
  package root, never a sub-path.
- **`<ng-template appGraphOverlay>` does nothing.** Cause: slots are attribute selectors, not
  directives. Fix: project a real element with the `overlay` / `detail` attribute.
- **Edges point the wrong way.** Cause: `dependencies: ['a','b']` on node C is a fallback that
  draws A→C and B→C. Fix: prefer explicit `[transitions]`.
- **Subgraph drill-down not working.** Fix: give the node an inline `subgraph`, or a
  `subgraphId` plus a `[subgraphResolver]`.
- **Ref previews say "No task run id".** Fix: pass `[runId]` to `<mr-task-graph>` / the inspector.
- **Status change did not repaint the graph.** This is by design: status updates toggle classes
  on the existing SVG; only structural changes (nodes, edges, groups, direction, arrangement)
  re-render Mermaid. New nodes/edges must arrive as new arrays.

### Theming (required, not optional)

The canvas paints every status colour through CSS custom properties and defines none of its
own. Set these in the host, globally (example values):

```scss
--app-color-pass: #4caf50;    --app-color-pass-bg: rgba(76, 175, 80, 0.15);
--app-color-fail: #f44336;    --app-color-fail-bg: rgba(244, 67, 54, 0.15);
--app-color-warn: #ffc107;    --app-color-warn-bg: rgba(255, 193, 7, 0.15);
--app-color-active: #2196f3;  --app-color-active-bg: rgba(33, 150, 243, 0.15);
--app-color-idle: #94a3b8;    --app-color-idle-bg: rgba(148, 163, 184, 0.12);
--app-color-idle-text: rgba(255, 255, 255, 0.7);
--app-color-running-bg: rgba(33, 150, 243, 0.08);  // inspector running row (no fallback)
```

| Variable (`-bg`/`-text` variants where shown) | Painted on | Fallback if unset |
| --------------------------------------------- | ---------- | ----------------- |
| `--app-color-pass` / `-bg`                    | complete node fill + outline, progress trace, minimap dots | built-in on node rules; **none** on the progress trace / minimap |
| `--app-color-fail` / `-bg`                    | failed node, error progress trace, minimap dots | built-in on node rules; **none** on the progress trace / minimap |
| `--app-color-warn` / `-bg`                    | skipped/warn node outline, minimap dots | built-in on node rules; **none** on the minimap |
| `--app-color-active` / `-bg`                  | running / current-node outline, cards | built-in `#2196f3` |
| `--app-color-idle` / `-bg` / `-text`          | undone node fill + outline, idle cards | falls back to Material M3 tokens (`--mat-sys-*`) |
| `--app-color-running-bg`                      | inspector running-row background | **none** |

So: `pass`, `fail`, `warn`, `active` (+ their `-bg`) and `running-bg` have **no fallback on
the progress trace, minimap dots, or inspector rows** — omit them and those render invisible.
The chrome also relies on Angular Material's M3 tokens. Optional decorative variables
(background pattern `--mr-pattern-ink` / `-opacity` / `-size` / `-dot-radius` / `-line-width`,
group labels `--mr-group-label-*`, cards `--mr-card-*`) all ship with defaults.

## 7. Version notes

- Current: `0.1.0`. Peers `@angular/{common,core} ^20.3.0`, `@angular/{cdk,material} ^20.0.0`,
  `mermaid ^11.16.0`, `rxjs ~7.8.0`; `ngx-markdown ^20.1.0` optional.
- Single entry point: everything is at the package root (`selectors mr-*`).
- Status values are an open union — extend the five built-ins with `[statusStyles]` and
  `[nodeKinds]` rather than forking the component.
