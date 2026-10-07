import { ChangeDetectionStrategy, Component, input, model, output, viewChild } from '@angular/core';

import { MermaidRuntime } from './task-graph-model';
import {
  GraphCanvasComponent,
  type NodeContextMenuEvent,
  type SubgraphNavEvent,
} from './graph-canvas/graph-canvas.component';
import { GraphInspectorComponent } from './graph-inspector/graph-inspector.component';
import type { HostBannerMessage } from './graph-banner/banner-message.utils';
import type { RunSettledEvent } from './graph-canvas/run-summary.utils';
import { DEFAULT_FAR_ZOOM_SCALE } from './graph-canvas/far-zoom.utils';
import type { MermaidRuntimeConfig } from './mermaid-theme';

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

  /** How independent groups are packed (see {@link MermaidRuntime.GroupArrangement}). */
  readonly groupArrangement = input<MermaidRuntime.GroupArrangement>('auto');

  /** Which way the steps in each group of a chain run (see {@link MermaidRuntime.GroupFlow}). */
  readonly groupFlow = input<MermaidRuntime.GroupFlow>('alternate');

  /** Currently selected node id (highlight only; host owns the value). */
  readonly selectedNodeId = input<string | null>(null);

  /** Durable run id used for loading ref previews from the local daemon. */
  readonly runId = input<string | null>(null);

  /** Whether to render the selected-node detail inspector beside the graph. */
  readonly showInspector = input(false);

  /** The node to mark as the live "current" focus, if any. */
  readonly currentNodeId = input<string | null>(null);

  /**
   * Whether the graph is currently showing a timeline replay.
   *
   * VALUE: Lets the inner canvas keep replay animation separate from live
   * execution status pulses.
   */
  readonly replayActive = input<boolean>(false);

  /**
   * Current timeline event to animate during replay.
   *
   * VALUE: The canvas can paint the exact recorded node or edge step while this
   * wrapper preserves the existing one-component graph API.
   */
  readonly replayEvent = input<MermaidRuntime.ExecutionEvent | null>(null);

  /** Per-node display overrides, keyed by real node id. */
  readonly decorations = input<Record<string, TaskGraphNodeDecoration>>({});

  /** How each kind of step (by node `type`) looks: shape, icon, chip and tone. */
  readonly nodeKinds = input<Record<string, MermaidRuntime.NodeKindStyle>>({});

  /**
   * Status → visual-treatment overrides, merged over the canvas defaults.
   *
   * VALUE: A host defines its own status vocabulary/colours (and can add states
   * beyond the built-in five) without forking the component.
   */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Contrast family used when the runtime builds its default Mermaid config. */
  readonly mermaidTheme = input<MermaidRuntime.MermaidThemeId>('dark');

  /** Layout direction of the graph flow ('TD' or 'LR'). */
  readonly direction = model<'TD' | 'LR'>('TD');

  /**
   * Full Mermaid render config override for hosts that need custom theme variables.
   *
   * VALUE: Lets advanced hosts provide `theme: 'base'` and `themeVariables` while
   * simple hosts use `mermaidTheme` only.
   */
  readonly mermaidConfig = input<MermaidRuntimeConfig | null>(null);

  /**
   * Viewport background treatment behind the rendered graph.
   *
   * VALUE: Dots by default; hosts can pick grid lines, both, none, or supply
   * their own CSS-variable background.
   */
  readonly backgroundEffect = input<MermaidRuntime.GraphBackgroundEffect>('dots');

  /**
   * Which nodes draw their progress ring.
   *
   * VALUE: By default finished and 0% nodes draw none, so rings mark only
   * work in progress; `always` restores the older draw-everything behaviour.
   */
  readonly progressRings = input<MermaidRuntime.ProgressRingVisibility>('active');

  /**
   * Whether a node also draws one fainter ring per running child node
   * (`activeChildNodeProgresses`), outside its overall ring.
   *
   * VALUE: Hosts that find stacked rings busy can keep just the overall ring.
   */
  readonly childProgressRings = input<boolean>(true);

  /** Breadcrumb label for the root (top-level) graph. */
  readonly rootLabel = input<string>('Main');

  /** Whether to render the breadcrumb overlay while inside a subgraph. */
  readonly showBreadcrumb = input<boolean>(true);

  /** Whether the breadcrumb renders built-in, or is suppressed for host-rendered chrome. */
  readonly breadcrumbPlacement = input<'built-in' | 'host'>('built-in');

  /**
   * Whether drillable nodes show a small, static thumbnail of their child graph.
   *
   * VALUE: Decorative only; set false to drop the inline subgraph previews.
   */
  readonly showSubgraphPreview = input<boolean>(true);

  /** Whether to render the corner minimap overlay. */
  readonly showMinimap = input<boolean>(true);

  /** Whether the minimap renders built-in, or is suppressed for a host-rendered `<mr-minimap>`. */
  readonly minimapPlacement = input<'built-in' | 'host'>('built-in');

  /**
   * Whether the camera's zoom/pan controls render built-in, or are suppressed for a host
   * rendering its own controls via `canvas().zoomIn()`/`zoomOut()`/`fitAll()`/`resetCamera()`.
   */
  readonly cameraControlsPlacement = input<'built-in' | 'host'>('built-in');

  /**
   * Whether the selected-node inspector renders built-in (projected into the canvas's
   * `[detail]` side column), or is suppressed so a host can render its own `<mr-graph-inspector>`
   * wherever fits its layout (e.g. a persistent sidebar area rather than a canvas-reserved column).
   *
   * VALUE: Same seam as `minimapPlacement`/`cameraControlsPlacement`, but for chrome that reserves
   * layout space beside the graph instead of floating over it.
   */
  readonly inspectorPlacement = input<'built-in' | 'host'>('built-in');

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

  /** A message of the host's own for the top-centre banner (see `GraphCanvasComponent.banner`). */
  readonly banner = input<HostBannerMessage | null>(null);

  /** Zoom below which nodes show one large line instead of their text (see `GraphCanvasComponent.farZoomScale`). */
  readonly farZoomScale = input<number | null>(DEFAULT_FAR_ZOOM_SCALE);

  /** Text for a node when zoomed far out (see `GraphCanvasComponent.farLabel`). */
  readonly farLabel = input<((node: MermaidRuntime.Node) => string | null | undefined) | null>(null);

  /** Shows step and group times (see `GraphCanvasComponent.showTimes`). */
  readonly showTimes = input<boolean>(false);

  /** Emits once when the run finishes (see `GraphCanvasComponent.runSettled`). */
  readonly runSettled = output<RunSettledEvent>();

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
