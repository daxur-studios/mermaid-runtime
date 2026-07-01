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

## Core components

### `TaskGraphComponent` — drop-in viewer

The all-in-one component: canvas + optional inspector sidebar. Use this for the common case.

```typescript
import { TaskGraphComponent, MermaidRuntime } from '@daxur-studios/mermaid-runtime';

@Component({
  imports: [TaskGraphComponent],
  template: `
    <app-task-graph
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

Use when you want to compose your own inspector or toolbar around the canvas.

```typescript
import { GraphCanvasComponent } from '@daxur-studios/mermaid-runtime';

// template:
// <app-graph-canvas #canvas [nodes]="nodes()" [followExecution]="true">
//   <ng-template appGraphOverlay>
//     <!-- breadcrumb / toolbar chrome here -->
//   </ng-template>
//   <ng-template appGraphDetail>
//     <my-custom-inspector [node]="canvas.selectedNode()" />
//   </ng-template>
// </app-graph-canvas>
```

### `GraphCameraComponent` — generic pan/zoom wrapper

Content-agnostic pan/zoom camera. Not Mermaid-specific — use it to wrap any SVG or DOM content.

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

Then bind `[path]="graphPath()"` on `<app-task-graph>` so the viewer reconciles to the restored depth.

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

## Local development (file: link)

From a consuming project:

```bash
# in mermaid-runtime:
npm run build

# in the consuming project:
npm install ../../path/to/mermaid-runtime/dist/mermaid-runtime
# or pin in package.json:
# "@daxur-studios/mermaid-runtime": "file:../../mermaid-runtime/dist/mermaid-runtime"
```

## Repository

[github.com/daxur-studios/mermaid-runtime](https://github.com/daxur-studios/mermaid-runtime)
