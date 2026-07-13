# @daxur-studios/mermaid-runtime

An Angular library providing an interactive, pan/zoom task-graph viewer built on Mermaid. Ships a status-coloured flowchart with follow-execution camera, subgraph drill-down, an optional inspector sidebar, and a pluggable ref-loader seam.

## Packages

| Package | Description |
|---|---|
| `@daxur-studios/mermaid-runtime` | The Angular library |

## Installation

```bash
npm install @daxur-studios/mermaid-runtime
```

Peer dependencies you need in your project:

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

`ngx-markdown` is optional — only required if you use `GraphCanvasComponent` directly (it renders the Mermaid block via `MarkdownModule`).

## Theming

The canvas paints status colours, outlines, and progress traces through CSS custom properties — it defines no colours of its own. Your host app must set:

| Variable (+ `-bg` variant) | Used for | Fallback if unset |
|---|---|---|
| `--app-color-pass` | complete/success outline, progress trace, minimap dot | **none on some rules** — the progress trace and minimap render invisible without it |
| `--app-color-fail` | failed outline, progress trace on error | **none on some rules** — same as above |
| `--app-color-warn` | warn/skipped outline | node fill/background rules fall back to a built-in colour; a few stroke rules don't |
| `--app-color-active` | running/current-node outline | yes, built-in default |

Also relies on Angular Material's M3 design tokens (`--mat-sys-primary`, `--mat-sys-surface`, `--mat-sys-outline`, `--mat-sys-outline-variant`, `--mat-sys-on-surface`, `--mat-sys-on-surface-variant`, `--mat-sys-surface-container(-high)`) for outlines, badges, and chrome. If your project already applies Angular Material's theme (`@include mat.theme(...)`), these exist already — nothing extra to do.

Optional decorative variables (grid/background effect colours, sizes, hover overlay) all ship with sane defaults — see `graph-canvas.component.scss` if you want to override them.

## Core components

### `TaskGraphComponent` — drop-in viewer

The all-in-one component: canvas + optional inspector sidebar. Use this for the common case.

```typescript
import { TaskGraphComponent, MermaidRuntime } from '@daxur-studios/mermaid-runtime';

@Component({
  imports: [TaskGraphComponent],
  template: `
    <mr-task-graph
      [nodes]="nodes()"
      [transitions]="transitions()"
      [showInspector]="true"
      [followExecution]="true"
      (nodeSelected)="onNodeSelected($event)"
      (graphPathChange)="onGraphPathChange($event)"
    />
  `,
})
export class MyPage {
  readonly nodes = signal<MermaidRuntime.Node[]>([
    { id: 'a', title: 'Fetch data',  status: 'complete' },
    { id: 'b', title: 'Process',     status: 'running'  },
    { id: 'c', title: 'Save result', status: 'undone'   },
  ]);
  readonly transitions = signal<MermaidRuntime.Transition[]>([
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ]);
}
```

### `GraphCanvasComponent` — canvas only

Use when you want to compose your own inspector, toolbar, or context menu around
the canvas. Chrome is projected via two attribute-selector slots — `[overlay]`
for viewport-anchored controls, `[detail]` for a side panel — bound to the
canvas's exposed signals through a template ref (`#canvas`):

```html
<mr-graph-canvas #canvas [nodes]="nodes()" [followExecution]="true">
  <div overlay>
    <!-- breadcrumb / toolbar chrome here -->
  </div>
  <my-custom-inspector detail [node]="canvas.selectedNode()" />
</mr-graph-canvas>
```

### Custom context menu

A right-click on a node emits `(nodeContextMenu)` — `{ nodeId, x, y }`, with `x`/`y`
already relative to the canvas viewport — and the canvas exposes the resolved
node as `contextMenuTarget()`. The library ships no menu UI; project your own
standalone component into `[overlay]`, positioned with the emitted coordinates:

```html
<mr-graph-canvas #canvas [nodes]="nodes()" (nodeContextMenu)="onCtx($event)">
  @if (canvas.contextMenuTarget(); as node) {
    <my-context-menu
      overlay
      [node]="node"
      [style.left.px]="ctxPos().x"
      [style.top.px]="ctxPos().y"
      (closed)="canvas.closeContextMenu()"
    />
  }
</mr-graph-canvas>
```

```typescript
protected readonly ctxPos = signal({ x: 0, y: 0 });

protected onCtx(event: NodeContextMenuEvent): void {
  this.ctxPos.set({ x: event.x, y: event.y });
}
```

`<mr-task-graph>` re-emits the same `(nodeContextMenu)` event for convenience,
but only `<mr-graph-canvas>` exposes `contextMenuTarget()`/`closeContextMenu()`
and the `[overlay]` slot — use the canvas directly for a custom menu.

### Node groups

Cluster related nodes into a bordered, labelled box using Mermaid's native
layout clustering — useful when a long chain doesn't fit the viewport. This is
unrelated to the `subgraph`/`subgraphId` drill-down above: a group stays
visible in the same view (it never replaces it), while drill-down swaps in a
separate child graph.

```typescript
const groups: MermaidRuntime.NodeGroup[] = [
  { id: 'batch-1', label: 'Batch 1', nodeIds: ['a', 'b', 'c', 'd', 'e'], direction: 'LR' },
  { id: 'batch-2', label: 'Batch 2', nodeIds: ['f', 'g', 'h', 'i', 'j'], direction: 'LR' },
];
```

```html
<mr-task-graph [nodes]="nodes()" [transitions]="transitions()" [groups]="groups" />
```

A node belongs to at most one group. `direction` sets the group's *internal*
layout direction independently of the outer flowchart direction — e.g. an
overall `TD` flow where each group flows `LR` internally turns one long column
into a compact stack of short rows. Omit `direction` to inherit the outer flow.
`groups` works on `<mr-graph-canvas>` too, and on any nested `subgraph`'s own
`Graph.groups` for drill-down levels.

> **Caveat:** only set `direction` on a group whose members have no edges
> to/from nodes outside the group. Mermaid/dagre's routing for edges crossing
> a cluster boundary is unreliable once that cluster's direction differs from
> its parent's — the edge can visually clip to the cluster's border instead of
> the actual node. If a group's chain connects to the rest of the graph
> (the common case), omit `direction`; the group still renders as a labelled
> box, just without the extra layout compaction.

### `GraphCameraComponent` — generic pan/zoom wrapper

Content-agnostic pan/zoom camera. Not Mermaid-specific — use it to wrap any SVG or DOM content.

### Built-in chrome & relocating it

`<mr-graph-canvas>`/`<mr-task-graph>` render three pieces of chrome automatically: a corner **minimap**, floating **camera controls** (zoom/pan/direction toggle), and a **breadcrumb** trail while inside a subgraph. Turn any off (`showMinimap`, `showBreadcrumb`), or set its placement input to `'host'` and render the standalone component yourself, wherever your layout needs it:

| Chrome | Placement input | Standalone component | Bind to |
|---|---|---|---|
| Minimap | `minimapPlacement` | `<mr-minimap>` | `canvas.minimapContentRect()` / `minimapViewportRect()` / `minimapNodes()`, `(jump)="canvas.centerOnPoint($event)"` |
| Camera controls | `cameraControlsPlacement` | `<mr-graph-camera-controls [canvas]="canvas">` | pass the `#canvas` template ref directly |
| Breadcrumb | `breadcrumbPlacement` | `<mr-graph-breadcrumb [breadcrumbs]="canvas.breadcrumb()" (depthSelected)="...">` | canvas's `breadcrumb()` signal |
| Inspector | `inspectorPlacement` | `<mr-graph-inspector>` | project into `[detail]` yourself instead of relying on `<mr-task-graph>`'s slot |

`[direction]` (`'TD' | 'LR'`, two-way via `model()`) sets flow direction; `[backgroundEffect]` (`'grid-dots' | 'grid' | 'dots' | 'none' | 'custom'`) controls the viewport background; `[mermaidConfig]` lets advanced hosts override the whole Mermaid render config instead of just `[mermaidTheme]`.

### `TaskGraphReplayComponent` — execution timeline playback

Scrubs/plays through a recorded `MermaidRuntime.ExecutionEvent[]` history and reconstructs node status/progress at each point in time, so a finished run can be replayed without re-executing it:

```html
<mr-task-graph-replay
  [events]="executionEvents()"
  [baseNodes]="nodes()"
  [transitions]="transitions()"
  (stateChange)="onReplayState($event)"
/>
```

`(stateChange)` emits `{ nodes, currentNodeId, currentEvent, isReplaying }` — feed `nodes`/`currentNodeId` straight into `<mr-task-graph>`'s `[nodes]`/`[currentNodeId]` to drive the same visuals a live run would.

## Data model

Everything lives in the `MermaidRuntime` namespace:

```typescript
import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';

// A renderable node
const node: MermaidRuntime.Node = {
  id: 'step-1',
  title: 'Process files',
  status: 'running',         // 'undone' | 'running' | 'complete' | 'failed' | 'skipped' | string
  progressPercent: 42,
  progressLabel: 'Scanning…',
  detail: 'Optional subtitle',
  error: null,
  subgraph: { nodes: [...], transitions: [...] },  // optional inline child graph
};

// A directed edge
const edge: MermaidRuntime.Transition = { from: 'step-1', to: 'step-2', label: 'on success' };

// A self-contained graph (also used for subgraphs)
const graph: MermaidRuntime.Graph = { nodes: [...], transitions: [...] };
```

### Status values

The five built-in statuses (`undone`, `running`, `complete`, `failed`, `skipped`) have default colour classes. Pass `[statusStyles]` to override or extend them:

```typescript
const myStyles: MermaidRuntime.StatusStyleMap = {
  running:  { className: 'running', label: 'Running' },
  complete: { className: 'done',    label: 'Done'    },
  queued:   { className: 'queued',  label: 'Queued'  },  // custom extension
};
```

### Per-node decorations

Override display title or shape without touching the node data:

```typescript
const decorations: Record<string, MermaidRuntime.NodeDecoration> = {
  'decision-node': { shape: 'diamond' },
  'step-1':        { displayTitle: 'Custom label' },
};
```

### Built-in node overlays

These paint automatically from data you already pass — no extra inputs — but need the [Theming](#theming) CSS variables to show up in the right colour:

- **Selected ring** — around whichever node `[selectedNodeId]` (or a user click) points to.
- **Current ring** — a separate ring around `[currentNodeId]`, the live execution focus. Both rings use the same offset today, so a node that's simultaneously selected *and* current shows overlapping rather than nested rings.
- **Progress trace** — draws along the node's border as `progressPercent` rises. Coloured `--app-color-pass` (green) by default, `--app-color-fail` (red) once the node's `status` is `'failed'`.
- **Subgraph corner badge** — a drillable node (resolved subgraph) gets a solid accent border plus a small "+" badge in its top-right corner, instead of a dashed outline.

## Subgraph drill-down

Nodes with an `subgraph` field (or resolved via `[subgraphResolver]`) are double-clickable to drill in. The viewer maintains a breadcrumb trail and emits `(graphPathChange)` so the host can mirror depth into browser history:

```typescript
onGraphPathChange(path: string[]): void {
  this.graphPath.set(path);
  window.history.pushState({ graphPath: path }, '');
}

// Restore on back/forward:
window.addEventListener('popstate', (event) => {
  const path = event.state?.graphPath ?? [];
  this.graphPath.set(path);
});
```

Then bind `[path]="graphPath()"` on `<mr-task-graph>` so the viewer reconciles to the restored depth.

## Inspector ref loader

To enable ref previews (inputs/outputs/logs/artifacts) in the inspector, provide `TASK_GRAPH_REF_LOADER`:

```typescript
import { TASK_GRAPH_REF_LOADER, TaskGraphRefLoader, TaskGraphRefRequest, MermaidRuntime } from '@daxur-studios/mermaid-runtime';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class MyRefLoader implements TaskGraphRefLoader {
  loadRef(request: TaskGraphRefRequest): Observable<MermaidRuntime.RefContent> {
    // fetch from your API
    return this.http.get<MermaidRuntime.RefContent>(`/api/refs/${request.runId}/${request.nodeId}/${request.refId}`);
  }
}

// In app.config.ts providers:
{ provide: TASK_GRAPH_REF_LOADER, useExisting: MyRefLoader }
```

When no loader is provided, the inspector hides the ref preview section gracefully.

## Building the library

```bash
cd /path/to/mermaid-runtime
npm install
npm run build  # runs: ng build mermaid-runtime
```

Output lands in `dist/mermaid-runtime/`.

## Testing rendering and layout

The workspace uses two complementary suites:

- `npm run test:unit` runs the Angular/Karma component and render-stability tests.
- `npm run test:e2e` starts the demo app and runs Playwright against the deterministic
  `/testing/layout-regression` route.
- `npm run test:regression` runs both suites.

Install Playwright's Chromium build once after `npm install`:

```bash
npx playwright install chromium
```

The browser suite samples every animation frame during direction changes and
subgraph navigation. It fails on transient document/host scroll changes, host or
viewport movement, missing/duplicate visible SVGs, stale rapid renders, and a
render generation that never reaches `stable`. Failed CI runs retain the
Playwright report, screenshots, video, trace, and sampled DOM diagnostics.

For interactive debugging:

```bash
npm run test:e2e:ui
npm run test:e2e:debug
```

## Local development (build → pack → deploy)

Consumers install this library from a packed tgz (`file:./daxur-studios-mermaid-runtime-<version>.tgz`
in their `package.json`), not a `file:` link to `dist/`, so a version-less tarball
change still needs its package-lock integrity hash updated.

`scripts/deploy.ps1` does the whole cycle — build, pack, copy the tgz into the
consumer, patch its lockfile integrity, reinstall, and verify the built package
contains the expected `mr-*` selectors:

```bash
npm run deploy                       # uses scripts/deploy.local.json if present
npm run deploy -- -ConsumerDir <path>  # or pass it explicitly
```

Create `scripts/deploy.local.json` (gitignored) for local convenience:

```json
{ "consumerDir": "D:\\path\\to\\your\\consumer-app" }
```

See `scripts/deploy.local.json.example` for the template.

## Repository

[github.com/daxur-studios/mermaid-runtime](https://github.com/daxur-studios/mermaid-runtime)
