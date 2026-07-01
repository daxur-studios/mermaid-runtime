---
name: use-mermaid-runtime
description: Guide for adding or updating @daxur-studios/mermaid-runtime usage in an Angular project. Use when wiring TaskGraphComponent, GraphCanvasComponent, or the ref-loader seam, or when debugging the interactive graph viewer.
metadata:
  type: reference
---

# Using @daxur-studios/mermaid-runtime

## Import surface

Everything is re-exported from the package root:

```typescript
import {
  TaskGraphComponent,         // drop-in viewer (canvas + inspector)
  GraphCanvasComponent,       // canvas only — compose your own chrome
  GraphInspectorComponent,    // inspector sidebar — project into canvas [detail] slot
  GraphCameraComponent,       // generic pan/zoom wrapper
  MermaidRuntime,             // data model namespace
  TaskGraphRefLoader,         // interface for the ref-loader seam
  TaskGraphRefRequest,        // request shape passed to loadRef()
  TASK_GRAPH_REF_LOADER,      // DI token
  TaskGraphNodeDecoration,    // type alias for MermaidRuntime.NodeDecoration
  SubgraphNavEvent,           // payload emitted on subgraph enter/leave
} from '@daxur-studios/mermaid-runtime';
```

## Drop-in viewer

```typescript
// In your component:
imports: [TaskGraphComponent]

// Template:
<app-task-graph
  [nodes]="nodes()"
  [transitions]="transitions()"
  [selectedNodeId]="selectedNodeId()"
  [currentNodeId]="currentNodeId()"
  [runId]="runId()"
  [showInspector]="true"
  [decorations]="decorations()"
  [statusStyles]="statusStyles()"
  [rootLabel]="'My Graph'"
  [showBreadcrumb]="true"
  [showSubgraphPreview]="true"
  [subgraphResolver]="subgraphResolver()"
  [path]="graphPath()"
  [followExecution]="true"
  (nodeSelected)="onNodeSelected($event)"
  (subgraphEntered)="onSubgraphEntered($event)"
  (subgraphLeft)="onSubgraphLeft($event)"
  (graphPathChange)="onGraphPathChange($event)"
/>
```

## Node shape

```typescript
const node: MermaidRuntime.Node = {
  id: 'unique-id',
  title: 'Human label',
  status: 'undone',           // 'undone' | 'running' | 'complete' | 'failed' | 'skipped' | string
  detail: 'Optional subtitle',
  error: 'Error message if failed',
  type: 'supervisor',
  startedAt: '2025-01-01T00:00:00.000Z',
  endedAt: null,
  durationMs: null,
  progressPercent: 42,
  progressLabel: 'Processing…',
  dependencies: ['other-id'],           // OR use transitions
  transitions: [{ from: 'id', to: 'other-id', label: 'on success' }],
  inputRefs: [],
  outputRefs: [],
  contextRefs: [],
  logRefs: [],
  artifactRefs: [],
  subgraphId: null,                     // daemon-style: host resolves via subgraphResolver
  subgraphLabel: 'Child graph label',
  subgraph: { nodes: [...], transitions: [...] },  // inline child graph
};
```

## Status styles

```typescript
const statusStyles: MermaidRuntime.StatusStyleMap = {
  running:  { className: 'running', label: 'Running'  },
  complete: { className: 'done',    label: 'Complete' },
  failed:   { className: 'failed',  label: 'Failed'   },
  skipped:  { className: 'skipped', label: 'Skipped'  },
  // Add custom states:
  queued:   { className: 'queued',  label: 'Queued'   },
};
```

## Node decorations

```typescript
const decorations: Record<string, MermaidRuntime.NodeDecoration> = {
  'decision-id': { shape: 'diamond' },
  'step-id':     { displayTitle: 'Override label' },
};
```

## Subgraph history wiring

```typescript
protected readonly graphPath = signal<string[]>([]);

onGraphPathChange(path: string[]): void {
  this.graphPath.set(path);
  window.history.pushState({ graphPath: path }, '');
}

// Restore on popstate:
const onPop = (e: PopStateEvent) => {
  this.graphPath.set(e.state?.graphPath ?? []);
};
window.addEventListener('popstate', onPop);
this.destroyRef.onDestroy(() => window.removeEventListener('popstate', onPop));
```

## Ref loader

```typescript
// 1. Implement the interface:
@Injectable({ providedIn: 'root' })
export class MyRefLoader implements TaskGraphRefLoader {
  loadRef(req: TaskGraphRefRequest): Observable<MermaidRuntime.RefContent> {
    return this.http.get<MermaidRuntime.RefContent>(
      `/api/runs/${req.runId}/nodes/${req.nodeId}/refs/${req.refId}`
    );
  }
}

// 2. Register in providers (app.config.ts or route providers):
{ provide: TASK_GRAPH_REF_LOADER, useExisting: MyRefLoader }
```

The inspector omits the preview section gracefully when no loader is provided.

## Canvas-only (custom chrome)

```typescript
imports: [GraphCanvasComponent, GraphInspectorComponent]
```

```html
<app-graph-canvas #canvas [nodes]="nodes()" [followExecution]="true">
  <ng-template appGraphDetail>
    <app-graph-inspector
      [node]="canvas.selectedNode()"
      [runId]="runId()"
      [hasSubgraph]="canvas.selectedNodeHasSubgraph()"
      (enterSubgraph)="canvas.enterSelectedSubgraph()"
    />
  </ng-template>
</app-graph-canvas>
```

## Common mistakes

- **Do not import from sub-paths** like `@daxur-studios/mermaid-runtime/graph-canvas` — everything is at the package root.
- **`transitions` vs `dependencies`**: prefer `transitions` (explicit directed edges). `dependencies` is a fallback (reversed direction: `dependencies: ['a', 'b']` on node C draws A→C and B→C).
- **`subgraph` vs `subgraphResolver`**: use inline `subgraph` for self-contained nested data; use `subgraphResolver` when the host resolves graphs lazily (e.g. by `subgraphId`).
- **`runId`**: pass it to `<app-task-graph>` (or the inspector) so the ref loader can build its HTTP route. Without it, ref previews fail with "No task run id".
- **Status updates do not re-render Mermaid** — the canvas applies status colours as DOM classes on the existing SVG. Only structural changes (new nodes, new edges) trigger a Mermaid re-render.
