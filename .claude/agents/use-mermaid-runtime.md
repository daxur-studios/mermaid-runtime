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
  NodeContextMenuEvent,       // payload emitted on a node right-click
} from '@daxur-studios/mermaid-runtime';

// MermaidRuntime.NodeGroup — node-cluster shape — lives on the MermaidRuntime
// namespace, not a top-level export (see "Node groups" below).
```

## Drop-in viewer

```typescript
// In your component:
imports: [TaskGraphComponent]

// Template:
<mr-task-graph
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
  [groups]="groups()"
  (nodeSelected)="onNodeSelected($event)"
  (subgraphEntered)="onSubgraphEntered($event)"
  (subgraphLeft)="onSubgraphLeft($event)"
  (graphPathChange)="onGraphPathChange($event)"
  (nodeContextMenu)="onNodeContextMenu($event)"
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

Chrome is projected via two attribute-selector slots on `mr-graph-canvas` —
`[overlay]` (viewport-anchored: toolbars, minimaps, a context menu) and
`[detail]` (side panel) — bound to the canvas's exposed signals through a
template ref (`#canvas`). There is no `ng-template appGraphOverlay`/`appGraphDetail`
directive; the slots are plain content-projection selectors.

```typescript
imports: [GraphCanvasComponent, GraphInspectorComponent]
```

```html
<mr-graph-canvas #canvas [nodes]="nodes()" [followExecution]="true">
  <mr-graph-inspector
    detail
    [node]="canvas.selectedNode()"
    [runId]="runId()"
    [hasSubgraph]="canvas.selectedNodeHasSubgraph()"
    (enterSubgraph)="canvas.enterSelectedSubgraph()"
  />
</mr-graph-canvas>
```

## Node context menu

A right-click on a node is intercepted (browser default suppressed) and emits
`(nodeContextMenu): NodeContextMenuEvent` — `{ nodeId, x, y }`, `x`/`y` already
relative to the canvas viewport. The canvas also exposes the resolved node as
`contextMenuTarget()`, the same idiom as `selectedNode`. The library ships **no**
menu component — project your own into `[overlay]`:

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

`contextMenuTarget()` auto-clears on a left-click elsewhere, a pan/zoom, or
subgraph navigation — your menu component should still handle its own
outside-click/Escape dismissal (call `canvas.closeContextMenu()`, or just stop
rendering it) since the canvas only tracks *what* was right-clicked, not
whether your menu is currently open.
`<mr-task-graph>` re-emits `(nodeContextMenu)` too, but only the canvas exposes
`contextMenuTarget()`/`closeContextMenu()` and the `[overlay]` slot needed to
place a menu — use `<mr-graph-canvas>` directly for this.

## Node groups

Cluster related nodes into a bordered, labelled box via Mermaid's native
`subgraph` layout clustering — not to be confused with `Node.subgraph`/
`subgraphId` drill-down above. A group stays visible in the same view (nodes
never leave it); drill-down swaps in a separate child graph entirely.

```typescript
protected readonly groups = signal<MermaidRuntime.NodeGroup[]>([
  { id: 'batch-1', label: 'Batch 1', nodeIds: ['a', 'b', 'c', 'd', 'e'], direction: 'LR' },
  { id: 'batch-2', label: 'Batch 2', nodeIds: ['f', 'g', 'h', 'i', 'j'], direction: 'LR' },
]);
```

Bind `[groups]="groups()"` on `<mr-task-graph>` or `<mr-graph-canvas>`. A node
belongs to at most one group (first group listed wins if `nodeIds` overlap).
`direction` sets the group's *internal* layout direction independent of the
outer flowchart direction — this is what actually compacts a long chain (e.g.
an overall `TD` flow with each group flowing `LR` internally turns one long
column into a stack of short rows), not just a colour/border overlay. Omit
`direction` to inherit the outer flow. For a nested subgraph level, set
`groups` directly on that level's `MermaidRuntime.Graph` object instead of the
component input.

**Caveat — only set `direction` on a self-contained group** (no edges to/from
nodes outside it). Mermaid/dagre's edge routing across a cluster boundary is
unreliable once that cluster's direction differs from its parent's: the edge
can visually clip to the cluster border instead of reaching the actual node.
If the group's nodes connect to the rest of the graph (the common case, e.g. a
chain split into groups), omit `direction` — the group still renders as a
labelled box, just without the extra compaction.

## Common mistakes

- **Selectors are `mr-*`**, not `app-*` (e.g. `mr-task-graph`, `mr-graph-canvas`, `mr-graph-inspector`).
- **Slots are attribute selectors, not directives** — project with `<div overlay>`/`<div detail>` (or an attribute on your own component), not `<ng-template appGraphOverlay>`.
- **Do not import from sub-paths** like `@daxur-studios/mermaid-runtime/graph-canvas` — everything is at the package root.
- **`transitions` vs `dependencies`**: prefer `transitions` (explicit directed edges). `dependencies` is a fallback (reversed direction: `dependencies: ['a', 'b']` on node C draws A→C and B→C).
- **`subgraph` vs `subgraphResolver`**: use inline `subgraph` for self-contained nested data; use `subgraphResolver` when the host resolves graphs lazily (e.g. by `subgraphId`).
- **`groups` vs `Node.subgraph`**: a group (`NodeGroup`) is a visual cluster that stays in the same view; `Node.subgraph`/`subgraphId` is drill-down that swaps in a different view. They're unrelated despite Mermaid using the keyword `subgraph` for clustering under the hood.
- **`runId`**: pass it to `<mr-task-graph>` (or the inspector) so the ref loader can build its HTTP route. Without it, ref previews fail with "No task run id".
- **Status updates do not re-render Mermaid** — the canvas applies status colours as DOM classes on the existing SVG. Only structural changes (new nodes, new edges) trigger a Mermaid re-render.
