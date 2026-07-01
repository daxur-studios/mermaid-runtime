import { ChangeDetectionStrategy, Component, input, output, viewChild } from '@angular/core';

import { MermaidRuntime } from './task-graph-model';
import {
  GraphCanvasComponent,
  type NodeContextMenuEvent,
  type SubgraphNavEvent,
} from './graph-canvas/graph-canvas.component';
import { GraphInspectorComponent } from './graph-inspector/graph-inspector.component';

/**
 * Per-node visual override supplied by the host.
 *
 * Value: Re-exported from the viewer's self-owned model so existing consumers
 * keep importing `TaskGraphNodeDecoration` from this component while the canonical
 * definition lives in `MermaidRuntime` (the extractable library surface).
 */
export type TaskGraphNodeDecoration = MermaidRuntime.NodeDecoration;

/**
 * Re-export of the canvas's subgraph navigation payload.
 *
 * Value: Keeps `SubgraphNavEvent` importable from this entry point for hosts that
 * wired to it before the composition split.
 */
export type { SubgraphNavEvent };

/**
 * Re-export of the canvas's node context-menu payload.
 *
 * Value: Keeps `NodeContextMenuEvent` importable from this entry point so hosts
 * using `<mr-task-graph>` don't need to reach into the canvas sub-path.
 */
export type { NodeContextMenuEvent };

/**
 * Default composition of the graph canvas + projected inspector.
 *
 * PURPOSE: Preserve the original `<app-task-graph>` API — one component a host
 * drops in with `[nodes]`, `[showInspector]`, etc. — by wiring the new
 * {@link GraphCanvasComponent} (rendering/interaction) to the optional
 * {@link GraphInspectorComponent} projected into its `[detail]` slot.
 *
 * VALUE: Existing consumers (task-live page, the workflows demo) keep working
 * unchanged, while projects that want a custom layout can compose the canvas and
 * their own chrome directly. The inspector binds to the canvas's exposed
 * `selectedNode` via a template ref, so selection state lives in one place.
 */
@Component({
  selector: 'mr-task-graph',
  templateUrl: './task-graph.component.html',
  styleUrl: './task-graph.component.scss',
  host: { class: 'mr-task-graph' },
  imports: [GraphCanvasComponent, GraphInspectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskGraphComponent {
  /**
   * The inner canvas instance — exposed so a host can reach its
   * public API via `<mr-task-graph #tg>` and `tg.canvas()`.
   *
   * Deliberately optional (not `viewChild.required`): a host's `[overlay]`
   * content is projected into this component's view, so its bindings can be
   * evaluated before this component's own `ngAfterViewInit` resolves the
   * query — a `.required()` read there throws NG0951. Callers must guard
   * with `?.`.
   */
  readonly canvas = viewChild(GraphCanvasComponent);

  /** Execution nodes to render. The host owns their lifecycle and status. */
  readonly nodes = input.required<MermaidRuntime.Node[]>();

  /**
   * Runtime/story edges. When omitted, edges fall back to per-node
   * `transitions`, then to `dependencies` so a dependency-only graph still draws.
   */
  readonly transitions = input<MermaidRuntime.Transition[] | null>(null);

  /** Optional node groups for the root graph (see {@link MermaidRuntime.NodeGroup}). */
  readonly groups = input<MermaidRuntime.NodeGroup[] | null>(null);

  /** Currently selected node id (highlight only; host owns the value). */
  readonly selectedNodeId = input<string | null>(null);

  /** Durable run id used for loading ref previews from the local daemon. */
  readonly runId = input<string | null>(null);

  /** Whether to render the selected-node detail inspector beside the graph. */
  readonly showInspector = input(false);

  /** The node to mark as the live "current" focus, if any. */
  readonly currentNodeId = input<string | null>(null);

  /** Per-node display overrides, keyed by real node id. */
  readonly decorations = input<Record<string, TaskGraphNodeDecoration>>({});

  /**
   * Status → visual-treatment overrides, merged over the canvas defaults.
   *
   * VALUE: A host defines its own status vocabulary/colours (and can add states
   * beyond the built-in five) without forking the component.
   */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Breadcrumb label for the root (top-level) graph. */
  readonly rootLabel = input<string>('Main');

  /** Whether to render the breadcrumb overlay while inside a subgraph. */
  readonly showBreadcrumb = input<boolean>(true);

  /**
   * Whether drillable nodes show a small, static thumbnail of their child graph.
   *
   * VALUE: Decorative only; set false to drop the inline subgraph previews.
   */
  readonly showSubgraphPreview = input<boolean>(true);

  /** Whether to render the corner minimap overlay. */
  readonly showMinimap = input<boolean>(true);

  /**
   * Resolves a node's child graph. When omitted, the node's inline
   * `subgraph` is used.
   */
  readonly subgraphResolver = input<
    ((node: MermaidRuntime.Node) => MermaidRuntime.Graph | null) | null
  >(null);

  /**
   * Externally-controlled subgraph path (root node ids drilled into) — the
   * history seam a host drives from its router for browser back/forward.
   */
  readonly path = input<readonly string[]>([]);

  /**
   * When true, the camera keeps the running ("green") nodes framed as the run
   * progresses.
   */
  readonly followExecution = input<boolean>(false);

  /** Emits the real node id when a node is clicked. */
  readonly nodeSelected = output<string>();

  /** Emits the target node id and viewport-relative position on a node right-click. */
  readonly nodeContextMenu = output<NodeContextMenuEvent>();

  /** Emits when the user drills into a node's subgraph. */
  readonly subgraphEntered = output<SubgraphNavEvent>();

  /** Emits when the user leaves a subgraph (one or more levels up). */
  readonly subgraphLeft = output<SubgraphNavEvent>();

  /** Emits the new root→current node-id path whenever the user navigates subgraphs. */
  readonly graphPathChange = output<string[]>();
}
