import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, model, output, signal, untracked, viewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MarkdownModule } from "ngx-markdown";
import { Subscription } from "rxjs";
import mermaid from "mermaid";

import { MermaidRuntime } from "../task-graph-model";
import { GraphCameraComponent, type GraphCameraState, type GraphRect } from "../graph-camera/graph-camera.component";
import { MinimapComponent } from "../minimap/minimap.component";
import { GraphBreadcrumbComponent, type GraphBreadcrumbEntry } from "../graph-breadcrumb/graph-breadcrumb.component";
import { buildMermaidRuntimeConfig, type MermaidRuntimeConfig } from "../mermaid-theme";
import { hashPreviewStructure, hashPreviewStatuses, resolvePreviewEdges, resolvePreviewStatusClass } from "../graph-preview/graph-preview.utils";
import { buildTopStartOutlinePath, computeOutlinePerimeterLength, offsetPolygonGeometry, offsetRectGeometry, type OffsetShapeGeometry, type ShapePoint } from "./shape-offset.utils";

/** A directed graph edge, from one node id to another, with an optional label. */
interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

/** Maps real node ids to Mermaid-safe aliases and back. */
interface GraphAliasMap {
  toAlias: Map<string, string>;
  toReal: Map<string, string>;
}

/**
 * One node's scene-space rect + resolved status class, for a projected minimap.
 *
 * Value: `className` reuses the same status→class resolution as the real graph
 * (`effectiveStatusStyles`), so a host's custom `statusStyles` are respected
 * without the minimap needing its own copy of that map.
 */
export interface MinimapNodeRect {
  id: string;
  rect: GraphRect;
  className: string;
}

/**
 * One drilled-into level on the subgraph navigation stack.
 *
 * Value: Captures the parent node we entered, its breadcrumb label, and the
 * child graph rendered at this level, so the viewer can render and leave any
 * depth without re-resolving the chain.
 */
interface GraphFrame {
  /** Real id (in its parent graph) of the node that was entered. */
  nodeId: string;
  /** Label shown for this level in the breadcrumb. */
  label: string;
  /** The child graph rendered at this level. */
  graph: MermaidRuntime.Graph;
}

/**
 * Camera snapshot captured before a structural Mermaid re-render.
 *
 * VALUE: Lets the canvas temporarily render Mermaid at identity scale so
 * `htmlLabels` measure in unzoomed space, then either restore the old camera or
 * replace it with a newly-fitted one after layout settles.
 */
interface PendingStructuralRerender {
  token: number;
  previousCameraState: GraphCameraState;
}


/**
 * Payload emitted when the user enters or leaves a subgraph.
 *
 * Value: Carries the full root→current node-id path so a host can mirror depth
 * into its router/history for browser back/forward.
 */
export interface SubgraphNavEvent {
  /** Node-id path from root to the current level (empty at root). */
  path: string[];
  /** The node drilled into for the current level, or null at root. */
  nodeId: string | null;
  /** The current level's breadcrumb label, or null at root. */
  label: string | null;
}

/**
 * Payload emitted when the user right-clicks a node.
 *
 * Value: Carries the node id plus a position already relative to the canvas
 * viewport, so a host can position its own projected context-menu component
 * with a plain `[style.left.px]`/`[style.top.px]` binding — no coordinate math.
 */
export interface NodeContextMenuEvent {
  /** Real id of the right-clicked node. */
  nodeId: string;
  /** Horizontal offset (px) from the viewport's left edge. */
  x: number;
  /** Vertical offset (px) from the viewport's top edge. */
  y: number;
}

/** Query parameter used to encode the real node id in Mermaid click hrefs. */
const NODE_HREF_PARAM = "node";

/**
 * Built-in status → visual-treatment map, merged under any host `statusStyles`.
 *
 * PURPOSE: Give the five daemon-default states their colours while keeping status
 * styling out of the Mermaid source (applied as DOM classes after render).
 *
 * VALUE: Status changes update the rendered DOM in place — Mermaid never tears
 * down and rebuilds the SVG for a running/done/failed transition — and a host can
 * override or extend this map without forking the component.
 */
const DEFAULT_STATUS_STYLES: MermaidRuntime.StatusStyleMap = {
  running: { className: "running", label: "Running" },
  complete: { className: "done", label: "Complete" },
  failed: { className: "failed", label: "Failed" },
  skipped: { className: "skipped", label: "Skipped" },
};

/**
 * CSS class marking the live "current" focus node.
 *
 * VALUE: Kept separate from status classes so the focus highlight and the
 * execution colour are applied and stripped independently.
 */
const CURRENT_NODE_CLASS = "current";

/**
 * CSS class marking a node the user can drill into (it resolves to a subgraph).
 *
 * VALUE: Lets the stylesheet flag drillable nodes (badge/affordance) without the
 * host having to decorate them.
 */
const HAS_SUBGRAPH_CLASS = "has-subgraph";

/** CSS class for the drillable-node corner badge group (see graph-canvas.component.scss). */
const SUBGRAPH_BADGE_CLASS = "mr-node-subgraph-badge";

/** Radius (px) of the drillable-node corner badge circle, centred on the node shape's top-right corner. */
const SUBGRAPH_BADGE_RADIUS_PX = 7;

/**
 * Reserved pixel footprint for content injected into a node's label *after*
 * Mermaid's own render (see {@link GraphCanvasComponent.applySubgraphPreviews}).
 *
 * VALUE: A same-sized placeholder is baked into the Mermaid label text
 * *before* render (see {@link GraphCanvasComponent.buildReservedContentHtml}),
 * so Mermaid's `htmlLabels` measurement already accounts for this space — the
 * node box and its connected edges are sized/positioned around it from the
 * very first render. The post-render step then only ever fills an
 * already-reserved box; it never needs Mermaid to resize or reflow anything.
 */
const RESERVED_LABEL_CONTENT_SIZE = {
  "subgraph-preview": { width: 54, height: 54 },
} as const satisfies Record<string, { readonly width: number; readonly height: number }>;

type ReservedLabelContentKind = keyof typeof RESERVED_LABEL_CONTENT_SIZE;

/**
 * Outward offset (px) for the selected/current-node outline ring — the same
 * node shape, redrawn larger, so it reads as a ring around the node rather
 * than a border on it.
 *
 * VALUE: Kept larger than {@link NODE_PROGRESS_TRACE_OFFSET_PX} so the two
 * rings never overlap: shape → progress trace → this outline, outside-in.
 */
const NODE_OUTLINE_OFFSET_PX = 12;

/** CSS class for the selected-node outline ring (thin, white — see graph-canvas.component.scss). */
const SELECTED_OUTLINE_CLASS = "mr-node-outline-selected";

/** CSS class for the current/live-focus-node outline ring (thick, blue — see graph-canvas.component.scss). */
const CURRENT_OUTLINE_CLASS = "mr-node-outline-current";

/**
 * Outward offset (px) for the progress trace — smaller than
 * {@link NODE_OUTLINE_OFFSET_PX} so it sits in the gap between the node's own
 * border and the selected/current outline ring, never touching either.
 */
const NODE_PROGRESS_TRACE_OFFSET_PX = 5;

/** CSS class for the shape-tracing progress ring (see graph-canvas.component.scss). */
const PROGRESS_TRACE_CLASS = "mr-node-progress-trace";

/** CSS class for the small progress-percent text shown above a node's progress trace. */
const PROGRESS_TEXT_CLASS = "mr-node-progress-text";

/** Vertical gap (px) between the progress trace's topmost point and its percentage text. */
const PROGRESS_TEXT_GAP_PX = 6;

/**
 * Marker class applied to every shape-offset overlay element (selected/current
 * outline rings, the progress trace path and its text), in addition to that
 * element's own specific class.
 *
 * PURPOSE: The pre-existing node status/hover/pulse/replay-flash styling
 * (see graph-canvas.component.scss) targets *every* `rect`/`polygon` inside
 * `.node`, because until this overlay mechanism existed there was ever only
 * one such element per node — the node's own shape. These overlays are
 * additional `rect`/`polygon`/`path` siblings, so without an explicit
 * exclusion those `!important` fill/stroke rules also repaint the overlay
 * (e.g. a `.done` node's translucent fill "!important"-overrides the
 * outline's `fill: none`), which — since the overlay is drawn on top and
 * larger than the node — visually reads as the node growing and swallowing
 * its own label text.
 *
 * VALUE: One class, excluded once per generic selector via `:not()`, keeps
 * every current and future overlay immune to node-status styling without
 * hand-listing each overlay class in every status/hover/pulse rule.
 */
const NODE_DECORATION_CLASS = "mr-node-decoration";

/**
 * Zoom cap when follow-execution frames the running nodes.
 *
 * Value: Keeps the camera from snapping uncomfortably close to one or two
 * nodes — "not too far, not too close" — while `frameRect` padding handles the
 * lower bound for larger running sets.
 */
const FOLLOW_MAX_ZOOM = 1.4;

/**
 * Camera state used while Mermaid performs a structural re-render.
 *
 * VALUE: Rendering the SVG at identity scale avoids zoom-dependent
 * `foreignObject`/`htmlLabels` measurement drift during direction switches and
 * subgraph navigation.
 */
const IDENTITY_CAMERA_STATE: GraphCameraState = { x: 0, y: 0, scale: 1 };

/**
 * Number of consecutive animation frames whose SVG bounds must match before the
 * layout is considered settled.
 *
 * VALUE: One frame is too eager for Chromium's `foreignObject` label layout;
 * requiring two equal samples avoids fitting/restoring against a transient box.
 */
const STRUCTURAL_LAYOUT_STABLE_FRAME_COUNT = 2;

/**
 * Maximum number of animation frames spent waiting for a structural Mermaid
 * render to settle.
 *
 * VALUE: Prevents a broken SVG/layout edge case from leaving the camera pinned
 * at identity forever.
 */
const STRUCTURAL_LAYOUT_MAX_WAIT_FRAMES = 24;

/**
 * Tolerance (px) for considering two successive SVG bounds equal.
 *
 * VALUE: Ignores sub-pixel jitter between animation frames while still catching
 * real label-size changes.
 */
const STRUCTURAL_LAYOUT_BOUNDS_EPSILON_PX = 0.5;

/**
 * Lowest valid percentage shown in a task graph node progress bar.
 *
 * PURPOSE: Clamp malformed task-run node progress before it reaches Mermaid.
 *
 * VALUE: Progress bars never render negative values.
 */
const TASK_GRAPH_PROGRESS_MIN_PERCENT = 0;

/**
 * Highest valid percentage shown in a task graph node progress bar.
 *
 * PURPOSE: Keep task-run node progress inside the browser progress element's
 * expected range.
 *
 * VALUE: Node labels and inspector bars share the same 0-100 scale.
 */
const TASK_GRAPH_PROGRESS_MAX_PERCENT = 100;

// Subgraph preview constants removed in favor of GraphPreviewSimpleComponent

/**
 * Default Mermaid render configuration for the task graph.
 *
 * Value: Dark remains the default for backwards compatibility; hosts can pass
 * `mermaidTheme` or `mermaidConfig` to align Mermaid output with their app theme.
 */
const DEFAULT_MERMAID_OPTIONS: MermaidRuntimeConfig = {
  ...buildMermaidRuntimeConfig("dark", true),
  securityLevel: "loose",
  flowchart: {
    // The camera owns sizing/zoom. `useMaxWidth: false` gives the SVG a fixed
    // intrinsic size so a re-render (status change) never re-fits it to the
    // container and fights the current zoom — text stays the right size.
    useMaxWidth: false,
    htmlLabels: true,
    curve: "basis",
  },
};

/**
 * Interactive Mermaid graph canvas — the rendering + interaction core.
 *
 * PURPOSE: Render any `MermaidRuntime.Node[]` (+ transitions) as a status-coloured,
 * clickable flowchart inside a pan/zoom camera, with progress bars, follow,
 * nested-subgraph navigation, and optional node groups (clusters, not to be
 * confused with subgraph drill-down — see {@link MermaidRuntime.NodeGroup}). It
 * owns selection/navigation state and exposes it, but renders no inspector or
 * toolbar chrome itself.
 *
 * VALUE: The reusable product surface. A host projects its own chrome through the
 * `[overlay]` and `[detail]` slots and binds it to the canvas's exposed signals
 * (e.g. `selectedNode`, `selectedNodeHasSubgraph`, `contextMenuTarget`) via a
 * template ref — so every project arranges its own layout while the interaction
 * behaviour is shared. A right-click on a node follows the same pattern: the
 * canvas resolves and exposes the target, the host supplies and positions its own
 * standalone context-menu component into `[overlay]`.
 */
/**
 * Maximum time difference (ms) allowed between parallel execution parent node completions.
 *
 * VALUE: Ensures concurrent parent nodes in a parallel AND-join are both treated as triggering
 * the child node, while stale parents from older loop iterations are correctly filtered out.
 */
const PARALLEL_JOIN_THRESHOLD_MS = 3000;

/**
 * Duration (ms) that the node border pulse class remains active.
 *
 * VALUE: Matches the CSS transition duration so the class is removed exactly as the
 * visual animation completes.
 */
const NODE_PULSE_DURATION_MS = 500;

/**
 * Duration (ms) that the connection edge marching-ants pulse class remains active.
 *
 * VALUE: Matches the transition and animation timings so the edge settles into its
 * solid color state exactly as the pulse completes.
 */
const EDGE_PULSE_DURATION_MS = 1000;

/**
 * Duration (ms) that a replay node flash remains active.
 *
 * VALUE: Matches the one-shot replay flash CSS so stale replay classes are removed
 * promptly before the next event paints.
 */
const REPLAY_NODE_FLASH_DURATION_MS = 560;

/**
 * Duration (ms) that a replay edge trace remains active.
 *
 * VALUE: Keeps the transient SVG overlay visible only for the active replay event.
 */
const REPLAY_EDGE_TRACE_DURATION_MS = 720;

/**
 * Delay (ms) before clearing replay event visuals.
 *
 * VALUE: Uses the longer replay animation duration so node and edge effects can
 * share one cleanup timer.
 */
const REPLAY_EVENT_CLEAR_DELAY_MS = REPLAY_EDGE_TRACE_DURATION_MS;

/**
 * SVG namespace used for replay overlay paths.
 *
 * VALUE: Ensures injected replay traces are real SVG paths, not HTML elements.
 */
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * PathLength value assigned to replay traces.
 *
 * VALUE: Normalizes every cloned Mermaid edge to a 0-100 animation scale,
 * regardless of its physical SVG length.
 */
const REPLAY_EDGE_TRACE_PATH_LENGTH = "100";

/**
 * CSS class for the transient replay overlay group.
 *
 * VALUE: Keeps replay SVG nodes identifiable for cleanup and mutation filtering.
 */
const REPLAY_ANIMATION_OVERLAY_CLASS = "mr-replay-animation-overlay-group";

/**
 * CSS class for the transient edge path drawn during timeline replay.
 *
 * VALUE: Separates replay motion from Mermaid's real edge path so the base line
 * styling remains stable.
 */
const REPLAY_EDGE_TRACE_CLASS = "mr-replay-edge-trace";

/**
 * CSS class for the one-shot node flash drawn during timeline replay.
 *
 * VALUE: Highlights only the current replay event's node instead of animating the
 * whole completed graph.
 */
const REPLAY_NODE_FLASH_CLASS = "mr-replay-node-flash";

/**
 * Minimum segment count for graph-execution edge ids.
 *
 * VALUE: Documents the positional `kind:from:to[:label]` edge id format shared
 * with the daemon graph execution builder.
 */
const GRAPH_EDGE_ID_MIN_PARTS = 3;

/**
 * Index of the source node id inside `kind:from:to[:label]` edge ids.
 *
 * VALUE: Keeps replay edge parsing explicit and resilient to labels containing
 * extra `:` characters after the target id.
 */
const GRAPH_EDGE_ID_FROM_INDEX = 1;

/**
 * Index of the target node id inside `kind:from:to[:label]` edge ids.
 *
 * VALUE: Keeps replay edge parsing explicit and resilient to labels containing
 * extra `:` characters after the target id.
 */
const GRAPH_EDGE_ID_TO_INDEX = 2;

@Component({
  selector: "mr-graph-canvas",
  templateUrl: "./graph-canvas.component.html",
  styleUrl: "./graph-canvas.component.scss",
  host: { class: "mr-graph-canvas" },
  imports: [CommonModule, MarkdownModule, GraphCameraComponent, MinimapComponent, GraphBreadcrumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphCanvasComponent implements AfterViewInit {
  readonly minimapContentRect = signal<GraphRect | null>(null);
  readonly minimapNodes = signal<MinimapNodeRect[]>([]);
  private readonly viewportSize = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  readonly minimapViewportRect = computed<GraphRect | null>(() => {
    const cameraComp = this.cameraRef();
    if (!cameraComp) return null;
    const { x, y, scale } = cameraComp.cameraState();
    const size = this.viewportSize();
    if (scale === 0 || size.width === 0 || size.height === 0) return null;
    return {
      x: -x / scale,
      y: -y / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
  });

  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cameraRef = viewChild.required(GraphCameraComponent);
  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>("viewport");

  protected readonly cameraState = computed(() => {
    const cameraComp = this.cameraRef();
    return cameraComp ? cameraComp.cameraState() : { x: 0, y: 0, scale: 1.0 };
  });

  protected readonly smallDotOpacity = computed(() => {
    const scale = this.cameraState().scale;
    // Keep dots visible down to 0.22 zoom, and increase their max visibility
    return Math.max(0, Math.min(0.25, (scale - 0.22) * 0.45));
  });

  protected readonly largeGridOpacity = computed(() => {
    const scale = this.cameraState().scale;
    // Increase grid line opacity (up to 0.16) and fade out slower
    return Math.max(0.02, Math.min(0.16, 0.18 - (scale - 1.0) * 0.08));
  });

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

  /** The node to mark as the live "current" focus, if any. */
  readonly currentNodeId = input<string | null>(null);

  /**
   * Whether the graph is currently showing a timeline replay.
   *
   * VALUE: Lets the canvas suppress live execution pulses while the replay layer
   * owns one-shot node and edge motion.
   */
  readonly replayActive = input<boolean>(false);

  /**
   * Current timeline event to animate during replay.
   *
   * VALUE: Drives sequential replay visuals from the recorded execution events,
   * including loops and parallel branches, instead of guessing from final node
   * state.
   */
  readonly replayEvent = input<MermaidRuntime.ExecutionEvent | null>(null);

  /** Per-node display overrides, keyed by real node id. */
  readonly decorations = input<Record<string, MermaidRuntime.NodeDecoration>>({});

  /**
   * Status → visual-treatment overrides, merged over {@link DEFAULT_STATUS_STYLES}.
   *
   * VALUE: A host defines its own status vocabulary/colours (and can add states
   * beyond the built-in five) without forking the component.
   */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Contrast family used when the runtime builds its default Mermaid config. */
  readonly mermaidTheme = input<MermaidRuntime.MermaidThemeId>("dark");

  /** Layout direction of the graph flow ('TD' or 'LR'). */
  readonly direction = model<"TD" | "LR">("TD");

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
   * VALUE: Hosts can keep the existing zoom-aware grid/dot effect, switch to a
   * simpler preset, remove it entirely, or use CSS variables for a custom layered background.
   */
  readonly backgroundEffect = input<MermaidRuntime.GraphBackgroundEffect>("grid-dots");

  /** Breadcrumb label for the root (top-level) graph. */
  readonly rootLabel = input<string>("Main");

  /** Whether to render the breadcrumb overlay while inside a subgraph. */
  readonly showBreadcrumb = input<boolean>(true);

  /** Whether the breadcrumb renders in the canvas corner or is exposed for host chrome. */
  readonly breadcrumbPlacement = input<"built-in" | "host">("built-in");

  /**
   * Whether drillable nodes show a small, static thumbnail of their child graph.
   *
   * VALUE: A purely decorative hint that a node contains a subgraph (and its
   * rough shape); set false to drop it entirely with no other behaviour change.
   */
  readonly showSubgraphPreview = input<boolean>(true);

  /** Whether to render the corner minimap overlay. */
  readonly showMinimap = input<boolean>(true);

  /**
   * Whether the minimap renders in its own built-in corner, or is suppressed so a host can
   * render `<mr-minimap>` itself (bound to `minimapContentRect`/`minimapViewportRect`/
   * `minimapNodes`/`centerOnPoint`) inside its own shared overlay layer instead.
   *
   * VALUE: lets a host app relocate the minimap without the library needing to know anything
   * about where a host's layout system wants it placed.
   */
  readonly minimapPlacement = input<"built-in" | "host">("built-in");

  /**
   * Whether the camera's zoom/pan control cluster renders in its own built-in corner, or is
   * suppressed so a host can render its own controls (calling `zoomIn()`/`zoomOut()`/
   * `fitAll()`/`resetCamera()` on this component) inside its own shared overlay layer instead.
   *
   * VALUE: Same seam as `minimapPlacement`, applied to the other piece of built-in viewport
   * chrome that a host may need to relocate to avoid colliding with a relocated minimap.
   */
  readonly cameraControlsPlacement = input<"built-in" | "host">("built-in");

  /**
   * Whether a host has projected `[detail]` chrome — toggles the side column.
   *
   * VALUE: Lets the canvas reserve layout space for a projected inspector without
   * knowing what it is.
   */
  readonly showDetail = input<boolean>(false);

  /**
   * Resolves a node's child graph. When omitted, the node's inline
   * `subgraph` is used.
   *
   * VALUE: Lets daemon-style hosts turn a `subgraphId` into a `Graph` lazily,
   * while inline-graph hosts need supply nothing.
   */
  readonly subgraphResolver = input<((node: MermaidRuntime.Node) => MermaidRuntime.Graph | null) | null>(null);

  /**
   * Externally-controlled subgraph path (root node ids drilled into).
   *
   * VALUE: The history seam — a host drives this from its router so browser
   * back/forward can restore the viewer's depth; the viewer reconciles its stack
   * to match and emits {@link graphPathChange} when the user navigates.
   */
  readonly path = input<readonly string[]>([]);

  /**
   * When true, the camera keeps the running ("green") nodes framed as the run
   * progresses. A manual pan/zoom pauses it until the host re-enables follow or
   * the user clicks the re-center chip.
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

  /**
   * Emits the new root→current node-id path whenever the user enters or leaves a
   * subgraph.
   *
   * VALUE: The single output a host wires to its history (push on change, restore
   * via the {@link path} input on back/forward).
   */
  readonly graphPathChange = output<string[]>();

  protected readonly mermaidOptions = computed<MermaidRuntimeConfig>(() => this.mermaidConfig() ?? buildMermaidRuntimeConfig(this.mermaidTheme(), DEFAULT_MERMAID_OPTIONS.startOnLoad ?? true));

  private readonly internalSelectedNodeId = signal<string | null>(null);

  /**
   * Subgraph navigation stack. Empty = root graph; each frame is one level the
   * user has drilled into. The top frame decides what the viewer renders.
   */
  private readonly graphStack = signal<GraphFrame[]>([]);

  /** Nodes for the level currently shown — the root input, or the top frame. */
  private readonly activeNodes = computed<MermaidRuntime.Node[]>(() => {
    const stack = this.graphStack();
    const top = stack[stack.length - 1];
    return top ? top.graph.nodes : this.nodes();
  });

  /** Transitions for the level currently shown — the root input, or the top frame. */
  private readonly activeTransitions = computed<MermaidRuntime.Transition[] | null>(() => {
    const stack = this.graphStack();
    const top = stack[stack.length - 1];
    return top ? (top.graph.transitions ?? null) : this.transitions();
  });

  /** Node groups for the level currently shown — the root input, or the top frame. */
  private readonly activeGroups = computed<MermaidRuntime.NodeGroup[] | null>(() => {
    const stack = this.graphStack();
    const top = stack[stack.length - 1];
    return top ? (top.graph.groups ?? null) : this.groups();
  });

  /** True while inside a subgraph (the stack is non-empty). */
  protected readonly inSubgraph = computed(() => this.graphStack().length > 0);

  /** Current camera zoom scale. */
  protected readonly currentZoom = computed(() => {
    const cameraComp = this.cameraRef();
    return cameraComp ? cameraComp.cameraState().scale : 1.0;
  });

  /** Breadcrumb trail (root + each entered level); empty at the root graph. */
  readonly breadcrumb = computed<GraphBreadcrumbEntry[]>(() => {
    const stack = this.graphStack();
    if (stack.length === 0) return [];
    const crumbs: GraphBreadcrumbEntry[] = [{ label: this.rootLabel(), depth: 0 }];
    stack.forEach((frame, index) => crumbs.push({ label: frame.label, depth: index + 1 }));
    return crumbs;
  });

  /** Built-in status styles with any host `statusStyles` merged over them. */
  private readonly effectiveStatusStyles = computed<MermaidRuntime.StatusStyleMap>(() => ({
    ...DEFAULT_STATUS_STYLES,
    ...this.statusStyles(),
  }));

  /** Every CSS class the status map can apply — stripped before re-applying. */
  private readonly statusClassNames = computed<string[]>(() => {
    const names = new Set<string>();
    for (const style of Object.values(this.effectiveStatusStyles())) {
      if (style?.className) names.add(style.className);
    }
    return [...names];
  });

  private readonly aliasMap = computed<GraphAliasMap>(() => this.buildAliasMap(this.activeNodes()));

  /** Mermaid-safe aliases for the active groups, namespaced apart from node aliases. */
  private readonly groupAliasMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    (this.activeGroups() ?? []).forEach((group, index) => map.set(group.id, `tgGrp${index}`));
    return map;
  });

  protected readonly flowMarkdown = computed(() => `\`\`\`mermaid\n${this.buildGraph()}\n\`\`\``);

  protected readonly effectiveSelectedNodeId = computed(() => {
    const nodes = this.activeNodes();
    return this.selectedNodeId() ?? this.internalSelectedNodeId() ?? this.currentNodeId() ?? nodes.find((node) => node.status === "running")?.id ?? nodes[0]?.id ?? null;
  });

  /** The resolved selected node — exposed so projected chrome can render its detail. */
  readonly selectedNode = computed(() => {
    const selectedId = this.effectiveSelectedNodeId();
    if (!selectedId) return null;
    return this.activeNodes().find((node) => node.id === selectedId) ?? null;
  });

  /** Whether the selected node can be drilled into — exposed for the projected inspector. */
  readonly selectedNodeHasSubgraph = computed(() => {
    const node = this.selectedNode();
    return !!node && !!this.resolveSubgraph(node);
  });

  private readonly internalContextMenuTarget = signal<MermaidRuntime.Node | null>(null);

  /**
   * The node last right-clicked, or null once dismissed.
   *
   * VALUE: Lets a host bind its projected context-menu component straight to the
   * target node via the `#canvas` template ref (`canvas.contextMenuTarget()`),
   * the same idiom used for `selectedNode` — no separate lookup needed.
   */
  readonly contextMenuTarget = this.internalContextMenuTarget.asReadonly();

  /** Ids of the currently running nodes, joined — drives follow re-framing. */
  private readonly runningKey = computed(() =>
    this.activeNodes()
      .filter((node) => node.status === "running")
      .map((node) => node.id)
      .join(","),
  );

  /** Joined `id:status` pairs — drives live status-class application (no re-render). */
  private readonly statusKey = computed(() =>
    this.activeNodes()
      .map((node) => `${node.id}:${node.status}`)
      .join(","),
  );

  /** Joined node progress values — drives live progress-bar DOM updates. */
  private readonly progressKey = computed(() =>
    this.activeNodes()
      .map((node) => {
        const childProgressesStr = node.activeChildNodeProgresses ? node.activeChildNodeProgresses.join("|") : "";
        return `${node.id}:${node.progressPercent ?? ""}:${node.progressLabel ?? ""}:${childProgressesStr}`;
      })
      .join(","),
  );

  /** Follow temporarily suspended after a manual pan/zoom. */
  protected readonly followPaused = signal(false);

  /** Follow is on and not paused — the camera should track the running nodes. */
  protected readonly followActive = computed(() => this.followExecution() && !this.followPaused());

  /** Whether to offer the "re-center" chip (follow on, but paused by the user). */
  protected readonly showRecenterChip = computed(() => this.followExecution() && this.followPaused());

  /** True once the first Mermaid node has rendered, so we fit the view once. */
  private hasFitInitialView = false;

  private readonly subgraphStructureHashes = new Map<string, string>();

  private readonly canvasFocusSubscription = new Subscription();

  /** Last seen `followExecution` value, to detect off→on (which resumes follow). */
  private lastFollowOn = false;

  private followFramePending = false;

  /** Last structural Mermaid source rendered into the canvas. */
  private lastStructureRenderKey: string | null = null;

  /** Active structural re-render waiting for its post-render layout to settle. */
  private pendingStructuralRerender: PendingStructuralRerender | null = null;

  /** Pending animation frame for structural-layout settling. */
  private structuralLayoutSettleFrame: number | null = null;

  /** Monotonic token for invalidating stale structural-layout settle loops. */
  private structuralLayoutToken = 0;

  /**
   * Track previous status of each node.
   *
   * VALUE: Detects real-time state transitions so the component only pulses nodes
   * that changed state while the user is actively watching.
   */
  private readonly previousStatuses = new Map<string, string>();

  /** Last replay event key animated by the canvas. */
  private lastReplayEventKey: string | null = null;

  /** Pending animation frame used to wait for Mermaid DOM updates before replay paint. */
  private replayAnimationFrame: number | null = null;

  /** Cleanup timer for the current replay node/edge visual. */
  private replayAnimationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const host = this.hostElement.nativeElement;
    const clickListener = (event: MouseEvent) => this.handleChartClick(event);
    const dblClickListener = (event: MouseEvent) => this.handleChartDblClick(event);
    const contextMenuListener = (event: MouseEvent) => this.handleChartContextMenu(event);
    const chartObserver = new MutationObserver((mutations) => {
      const hasRealMutations = mutations.some((m) => {
        const element = m.target instanceof Element ? m.target : m.target.parentElement;
        if (element) {
          if (element.closest("mr-minimap, .mr-minimap")) {
            return false;
          }
          if (element.closest(`.${REPLAY_ANIMATION_OVERLAY_CLASS}, .${REPLAY_EDGE_TRACE_CLASS}`)) {
            return false;
          }
          if (element.closest(".task-graph-node-subgraph-preview")) {
            return false;
          }
          if (element.closest(`.${NODE_DECORATION_CLASS}`)) {
            return false;
          }
        }
        return true;
      });
      if (hasRealMutations) {
        this.onChartMutation();
      }
    });
    host.addEventListener("click", clickListener, true);
    host.addEventListener("dblclick", dblClickListener, true);
    host.addEventListener("contextmenu", contextMenuListener, true);
    chartObserver.observe(host, { childList: true, subtree: true });
    this.destroyRef.onDestroy(() => {
      host.removeEventListener("click", clickListener, true);
      host.removeEventListener("dblclick", dblClickListener, true);
      host.removeEventListener("contextmenu", contextMenuListener, true);
      chartObserver.disconnect();
      this.clearReplayAnimationFrame();
      this.clearReplayAnimationTimer();
      this.cancelStructuralLayoutSettle();
    });

    effect(() => this.scheduleSelectedNodeClass(this.effectiveSelectedNodeId()));

    effect(() => {
      const structureKey = this.flowMarkdown();
      untracked(() => this.prepareStructuralRerender(structureKey));
    });

    effect(() => {
      this.direction();
      untracked(() => {
        this.hasFitInitialView = false;
      });
    });

    // Keep the navigation stack in sync with the host-controlled `path` input so
    // browser back/forward can restore subgraph depth. Reads only `path` (and the
    // resolver) tracked; the graph inputs are read untracked so replay status
    // ticks never rebuild the stack.
    effect(() => this.reconcileStackToPath(this.path()));

    // Status colouring and the "current" highlight live as DOM classes on the
    // rendered nodes, applied whenever a status, the current focus, the style map,
    // or the active level changes. Because this never touches the Mermaid source,
    // the SVG is not re-rendered.
    effect(() => {
      this.statusKey();
      this.currentNodeId();
      this.replayActive();
      this.replayEvent();
      this.effectiveStatusStyles();
      this.graphStack();
      this.scheduleStatusClasses();
    });

    effect(() => {
      this.progressKey();
      this.scheduleNodeProgressBars();
    });

    // Re-apply the inline subgraph thumbnails when the toggle flips, the active
    // level changes, or resolved subgraphs load/update.
    effect(() => {
      this.showSubgraphPreview();
      this.graphStack();
      this.activeNodes();

      // Reactively track resolveSubgraph evaluations for each active node
      for (const node of this.activeNodes()) {
        this.resolveSubgraph(node);
      }

      this.scheduleSubgraphPreviews();
    });

    // Re-frame the camera whenever an execution event changes the active node or
    // follow is toggled. The graph layout never changes between status updates,
    // so we only need to re-measure when one of these actually fires.
    effect(() => {
      this.followExecution();
      this.followPaused();
      this.currentNodeId();
      this.runningKey();
      this.scheduleFollow();
    });

    effect(() => {
      const replayActive = this.replayActive();
      const replayEvent = this.replayEvent();
      this.graphStack();
      this.scheduleReplayEventAnimation(replayActive, replayEvent);
    });
  }

  ngAfterViewInit(): void {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.viewportSize.set({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(this.viewportRef().nativeElement);
    this.destroyRef.onDestroy(() => resizeObserver.disconnect());
  }

  private buildAliasMap(nodes: readonly MermaidRuntime.Node[]): GraphAliasMap {
    const toAlias = new Map<string, string>();
    const toReal = new Map<string, string>();
    nodes.forEach((node, index) => {
      const alias = `tg${index}`;
      toAlias.set(node.id, alias);
      toReal.set(alias, node.id);
    });
    return { toAlias, toReal };
  }

  /**
   * Build the Mermaid source for the graph **structure only** (nodes, edges,
   * shapes, click targets) — never status or current-focus.
   *
   * Status colouring and the live "current" highlight are applied as DOM classes
   * on the rendered `.node` elements (see `applyStatusClasses`). Keeping them out
   * of the source means `flowMarkdown` only changes when the structure changes,
   * so a run that merely advances statuses produces zero Mermaid re-renders.
   */
  private buildGraph(): string {
    const nodes = this.activeNodes();
    const { toAlias } = this.aliasMap();
    const decorations = this.decorations();
    const aliasFor = (id: string): string | undefined => toAlias.get(id);

    return [
      `flowchart ${this.direction()}`,
      ...this.buildNodeDefinitionBlocks(nodes, toAlias, decorations),
      "",
      ...this.buildEdgeLines(aliasFor),
      "",
      ...nodes.map((node) => this.buildNodeClickLine(node, toAlias.get(node.id) ?? node.id)),
      "",
      `  class ${nodes.map((node) => toAlias.get(node.id)).join(",")} clickable;`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Builds node definition lines, wrapping grouped nodes in Mermaid `subgraph`
   * clusters (namespaced via {@link groupAliasMap} so their ids never collide
   * with node aliases) so the layout engine treats each group as its own layout
   * unit — this is what actually compacts a long chain, not just colours it.
   *
   * VALUE: A node belongs to at most one group (first group in `groups` order
   * wins ties); ungrouped nodes render exactly as before. Edges, click lines, and
   * the clickable class line are untouched — Mermaid resolves those by node alias
   * regardless of which cluster (if any) contains it.
   */
  private buildNodeDefinitionBlocks(nodes: readonly MermaidRuntime.Node[], toAlias: Map<string, string>, decorations: Record<string, MermaidRuntime.NodeDecoration>): string[] {
    const groups = this.activeGroups() ?? [];
    if (groups.length === 0) {
      return nodes.map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id]));
    }

    const nodeGroupId = new Map<string, string>();
    for (const group of groups) {
      for (const nodeId of group.nodeIds) {
        if (!nodeGroupId.has(nodeId)) nodeGroupId.set(nodeId, group.id);
      }
    }

    const groupAliasFor = this.groupAliasMap();
    const groupBlocks: string[] = [];
    for (const group of groups) {
      const memberLines = nodes.filter((node) => nodeGroupId.get(node.id) === group.id).map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id]));
      if (memberLines.length === 0) continue;

      const groupAlias = groupAliasFor.get(group.id) ?? group.id;
      groupBlocks.push(`  subgraph ${groupAlias}["${this.escapeMermaidString(group.label)}"]`);
      if (group.direction) groupBlocks.push(`    direction ${group.direction}`);
      groupBlocks.push(...memberLines);
      groupBlocks.push("  end");
    }

    const ungroupedLines = nodes.filter((node) => !nodeGroupId.has(node.id)).map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id]));

    return [...groupBlocks, ...ungroupedLines];
  }

  private buildNodeDefinitionLine(node: MermaidRuntime.Node, alias: string, decoration: MermaidRuntime.NodeDecoration | undefined): string {
    const title = this.buildNodeLabel(decoration?.displayTitle ?? node.title);
    const reservedPreview = this.showSubgraphPreview() && this.resolveSubgraph(node) ? this.buildReservedContentHtml("subgraph-preview") : "";
    const label = `${title}${reservedPreview}`;
    switch (decoration?.shape) {
      case "diamond":
        return `  ${alias}{"${label}"}`;
      case "subroutine":
        return `  ${alias}[["${label}"]]`;
      default:
        return `  ${alias}["${label}"]`;
    }
  }

  /**
   * Builds the Mermaid node label.
   *
   * PURPOSE: Keep Mermaid source limited to plain node text.
   *
   * VALUE: Live progress markup is injected after render, so Mermaid cannot
   * parse-fail on HTML controls or changing percentage values.
   */
  private buildNodeLabel(title: string): string {
    return this.escapeMermaidString(title);
  }

  /**
   * Builds an empty, fixed-size placeholder `<div>` for content that is
   * filled in *after* Mermaid's own render (e.g. {@link applySubgraphPreviews}).
   *
   * VALUE: Reserves the content's known footprint (see
   * {@link RESERVED_LABEL_CONTENT_SIZE}) inside the Mermaid label text so
   * `htmlLabels` measurement includes it before the node/edges are sized —
   * see the note on {@link RESERVED_LABEL_CONTENT_SIZE} for why this matters.
   *
   * Attributes use single quotes: this HTML is embedded inside a
   * double-quote-delimited Mermaid label string, so double quotes here would
   * terminate that string early.
   */
  private buildReservedContentHtml(kind: ReservedLabelContentKind): string {
    const size = RESERVED_LABEL_CONTENT_SIZE[kind];
    return `<div class='task-graph-node-${kind}' style='width:${size.width}px;height:${size.height}px'></div>`;
  }

  /**
   * Reads a safe whole-number progress value from a task-run node.
   *
   * PURPOSE: Avoid pushing null, NaN, or out-of-range progress into Mermaid HTML
   * labels.
   *
   * VALUE: The generated `<progress>` element always receives valid numeric
   * attributes.
   */
  private readNodeProgressPercent(progressPercent: number | null | undefined): number | null {
    if (progressPercent === null || progressPercent === undefined || !Number.isFinite(progressPercent)) {
      return null;
    }
    return Math.max(TASK_GRAPH_PROGRESS_MIN_PERCENT, Math.min(TASK_GRAPH_PROGRESS_MAX_PERCENT, Math.round(progressPercent)));
  }

  private buildEdgeLines(aliasFor: (id: string) => string | undefined): string[] {
    return this.resolveEdges()
      .map((edge) => {
        const from = aliasFor(edge.from);
        const to = aliasFor(edge.to);
        if (!from || !to) return null;
        return edge.label ? `  ${from} -->|${this.escapeMermaidString(edge.label)}| ${to}` : `  ${from} --> ${to}`;
      })
      .filter((line): line is string => line !== null);
  }

  /** Prefer explicit transitions, then per-node transitions, then dependencies. */
  private resolveEdges(): GraphEdge[] {
    const nodes = this.activeNodes();
    const explicit = this.activeTransitions() ?? [];
    const perNode = nodes.flatMap((node) => node.transitions ?? []);
    const transitions = explicit.length > 0 ? explicit : perNode;
    if (transitions.length > 0) {
      return transitions.map((transition) => ({
        from: transition.from,
        to: transition.to,
        label: transition.label ?? undefined,
      }));
    }
    return nodes.flatMap((node) => (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })));
  }

  private buildNodeClickLine(node: MermaidRuntime.Node, alias: string): string {
    const tooltip = this.escapeMermaidString(`View ${node.title}`);
    return `  click ${alias} "?${NODE_HREF_PARAM}=${encodeURIComponent(node.id)}" "${tooltip}"`;
  }

  private escapeMermaidString(value: string): string {
    return value.replace(/"/g, '\\"');
  }

  private onChartMutation(): void {
    try {
      // Guard against early DOM mutations before Angular has populated required inputs
      this.nodes();
    } catch (err) {
      return;
    }

    this.applySelectedNodeClass(this.effectiveSelectedNodeId());
    if (!this.hostElement.nativeElement.querySelector(".mermaid .node")) return;

    // Clear hashes on structural parent re-render so all subgraph previews are redrawn
    this.subgraphStructureHashes.clear();

    // A structural re-render produces fresh, class-less nodes; re-apply status.
    this.applyStatusClasses();
    this.applySubgraphPreviews();
    this.applyNodeProgressBars();

    const pendingStructuralRerender = this.pendingStructuralRerender;
    if (pendingStructuralRerender) {
      this.waitForStableStructuralLayout(pendingStructuralRerender);
      return;
    }

    this.updateMinimap();

    if (this.followActive() && this.activeFocusId()) {
      // First render (or a re-render) with follow on and a focus node: frame it.
      this.requestFrameActiveNode();
    } else if (!this.hasFitInitialView) {
      // No focus to follow (idle, or a freshly-entered subgraph): fit the whole
      // level once so the new graph is visible.
      this.hasFitInitialView = true;
      requestAnimationFrame(() => this.cameraRef().fitAll());
    }
  }

  /**
   * Snapshot the current camera and neutralize the scene transform before a
   * structural Mermaid re-render lands.
   *
   * VALUE: `htmlLabels` now measure at scale 1 instead of whatever zoom the user
   * currently has applied, removing the node/text size drift that otherwise shows
   * up after direction switches and subgraph navigation.
   */
  private prepareStructuralRerender(structureKey: string): void {
    if (this.lastStructureRenderKey === null) {
      this.lastStructureRenderKey = structureKey;
      return;
    }
    if (this.lastStructureRenderKey === structureKey) {
      return;
    }

    this.lastStructureRenderKey = structureKey;
    const camera = this.readCameraComponent();
    if (!camera) {
      return;
    }

    this.cancelStructuralLayoutSettle();
    this.pendingStructuralRerender = {
      token: ++this.structuralLayoutToken,
      previousCameraState: camera.cameraState(),
    };
    camera.setCameraState(IDENTITY_CAMERA_STATE, { animate: false });
  }

  /**
   * Wait for Mermaid's post-render SVG bounds to stop changing before any fit or
   * camera restore runs.
   *
   * VALUE: Prevents the camera from measuring a transient layout while Chromium
   * is still settling `foreignObject` label sizes.
   */
  private waitForStableStructuralLayout(pending: PendingStructuralRerender): void {
    this.cancelStructuralLayoutSettle();

    let stableFrameCount = 0;
    let sampledFrameCount = 0;
    let previousBounds: DOMRect | null = null;

    const sampleLayout = (): void => {
      if (this.pendingStructuralRerender?.token !== pending.token) {
        this.structuralLayoutSettleFrame = null;
        return;
      }

      sampledFrameCount++;
      const bounds = this.measureRenderedSvgBounds();
      if (bounds && previousBounds && this.sameSvgBounds(bounds, previousBounds)) {
        stableFrameCount++;
      } else if (bounds) {
        stableFrameCount = 1;
      } else {
        stableFrameCount = 0;
      }
      previousBounds = bounds;

      if (stableFrameCount >= STRUCTURAL_LAYOUT_STABLE_FRAME_COUNT || sampledFrameCount >= STRUCTURAL_LAYOUT_MAX_WAIT_FRAMES) {
        this.structuralLayoutSettleFrame = null;
        if (this.pendingStructuralRerender?.token === pending.token) {
          this.pendingStructuralRerender = null;
          this.finalizeStructuralRerender(pending.previousCameraState);
        }
        return;
      }

      this.structuralLayoutSettleFrame = requestAnimationFrame(sampleLayout);
    };

    this.structuralLayoutSettleFrame = requestAnimationFrame(sampleLayout);
  }

  /**
   * Finish a structural Mermaid re-render after its layout settles.
   *
   * VALUE: The camera either resumes follow, fits a new level/direction change,
   * or restores the user's prior viewport without ever measuring a stale label
   * box from the in-flight render.
   */
  private finalizeStructuralRerender(previousCameraState: GraphCameraState): void {
    this.updateMinimap();

    if (this.followActive() && this.activeFocusId()) {
      this.requestFrameActiveNode();
      return;
    }

    if (!this.hasFitInitialView) {
      this.hasFitInitialView = true;
      this.cameraRef().fitAll();
      return;
    }

    this.cameraRef().setCameraState(previousCameraState, { animate: false });
  }

  /** Cancel any in-flight structural-layout settle loop. */
  private cancelStructuralLayoutSettle(): void {
    if (this.structuralLayoutSettleFrame === null) {
      return;
    }
    cancelAnimationFrame(this.structuralLayoutSettleFrame);
    this.structuralLayoutSettleFrame = null;
  }

  /** Safe access to the child camera before/after view init. */
  private readCameraComponent(): GraphCameraComponent | null {
    try {
      return this.cameraRef();
    } catch {
      return null;
    }
  }

  /** Read the rendered Mermaid SVG's current on-screen bounds. */
  private measureRenderedSvgBounds(): DOMRect | null {
    const svg = this.hostElement.nativeElement.querySelector(".mermaid svg");
    if (!(svg instanceof SVGSVGElement)) {
      return null;
    }

    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }
    return bounds;
  }

  /** True when two successive SVG bounds are equal within the configured tolerance. */
  private sameSvgBounds(current: DOMRect, previous: DOMRect): boolean {
    return Math.abs(current.width - previous.width) <= STRUCTURAL_LAYOUT_BOUNDS_EPSILON_PX
      && Math.abs(current.height - previous.height) <= STRUCTURAL_LAYOUT_BOUNDS_EPSILON_PX
      && Math.abs(current.x - previous.x) <= STRUCTURAL_LAYOUT_BOUNDS_EPSILON_PX
      && Math.abs(current.y - previous.y) <= STRUCTURAL_LAYOUT_BOUNDS_EPSILON_PX;
  }

  private updateMinimap(): void {
    const camera = this.cameraRef();
    if (!camera) return;

    const content = camera.contentRect();
    this.minimapContentRect.set(content);

    const styles = this.effectiveStatusStyles();
    const nodeRects: MinimapNodeRect[] = [];
    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      const rect = camera.measureElementsRect([element]);
      if (rect) {
        nodeRects.push({
          id: node.id,
          rect,
          className: styles[node.status]?.className ?? "undone",
        });
      }
    }
    this.minimapNodes.set(nodeRects);
  }

  centerOnPoint(point: { x: number; y: number }): void {
    // Minimap drags re-emit this on every pointermove; an eased animation
    // would restart on each call and never catch up to the pointer.
    this.cameraRef().centerOn(point, { animate: false });
  }

  /**
   * Delegates to the camera for a host rendering its own controls (`cameraControlsPlacement:
   * 'host'`) — `cameraRef` itself is private, so these are the public seam.
   */
  zoomIn(): void {
    this.cameraRef().zoomIn();
  }

  /** @see zoomIn */
  zoomOut(): void {
    this.cameraRef().zoomOut();
  }

  /** @see zoomIn */
  fitAll(): void {
    this.cameraRef().fitAll();
  }

  /** @see zoomIn */
  resetCamera(): void {
    this.cameraRef().reset();
  }

  /** Called by the camera when the user manually pans/zooms — pauses follow. */
  protected onUserInteract(): void {
    if (this.followExecution()) this.followPaused.set(true);
    // A pan/zoom moves the node the menu's position was measured for.
    this.internalContextMenuTarget.set(null);
  }

  /** Re-center chip handler: resume follow and move to the active node. */
  protected resumeFollow(): void {
    this.followPaused.set(false);
    this.scheduleFollow();
  }

  /**
   * Re-frame on the active node when follow is live. Resumes follow if the host
   * just toggled `followExecution` back on.
   */
  private scheduleFollow(): void {
    if (this.followExecution() && !this.lastFollowOn) this.followPaused.set(false);
    this.lastFollowOn = this.followExecution();
    if (this.followActive()) this.requestFrameActiveNode();
  }

  /**
   * Queue a follow re-frame for the next animation frame.
   *
   * A status change fires both the follow effect and a burst of Mermaid DOM
   * mutations; coalescing them to a single frame stops the camera re-animating
   * many times for one execution event.
   */
  private requestFrameActiveNode(): void {
    if (this.followFramePending) return;
    this.followFramePending = true;
    requestAnimationFrame(() => {
      this.followFramePending = false;
      this.frameActiveNode();
    });
  }

  /**
   * Move the camera to the active node (plus its 1-hop neighbours, so the
   * previous/upcoming nodes stay visible). Measures the live render: the layout
   * is stable, so even a node from the outgoing SVG yields the right position.
   */
  private frameActiveNode(): void {
    if (!this.followActive()) return;
    const focusId = this.activeFocusId();
    if (!focusId) return;

    const ids = new Set<string>([focusId]);
    for (const neighbour of this.buildNeighbourMap().get(focusId) ?? []) ids.add(neighbour);

    const elements: Element[] = [];
    for (const id of ids) {
      const element = this.findNodeElement(id);
      if (element) elements.push(element);
    }
    if (elements.length === 0) return;
    this.cameraRef().frameElements(elements, { maxScale: FOLLOW_MAX_ZOOM });
  }

  /** The node the camera should follow: the live focus, else a running node. */
  private activeFocusId(): string | null {
    const nodes = this.activeNodes();
    const currentId = this.currentNodeId();
    // Only honour `currentNodeId` if it exists at the active level — it addresses
    // the root graph and is meaningless inside a subgraph.
    if (currentId && nodes.some((node) => node.id === currentId)) return currentId;
    return nodes.find((node) => node.status === "running")?.id ?? null;
  }

  /** Undirected 1-hop adjacency built from the resolved edges. */
  private buildNeighbourMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const link = (a: string, b: string): void => {
      const list = map.get(a) ?? [];
      list.push(b);
      map.set(a, list);
    };
    for (const edge of this.resolveEdges()) {
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    }
    return map;
  }

  /** Resolve a real node id to its rendered `.node` element, via the click anchor. */
  private findNodeElement(nodeId: string): Element | null {
    const host = this.hostElement.nativeElement;
    const link = (Array.from(host.querySelectorAll(".mermaid a")) as Element[]).find((linkElement) => this.readNodeIdFromLink(linkElement) === nodeId);
    if (!link) return null;
    // This Mermaid build wraps the node group inside the click `<a>`, so `.node`
    // is a descendant; fall back to an ancestor for other builds.
    return link.querySelector(".node") ?? link.closest(".node");
  }

  private handleChartClick(event: MouseEvent): void {
    this.internalContextMenuTarget.set(null);
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const linkElement = target.closest("a");
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) return;

    event.preventDefault();
    event.stopPropagation();
    this.internalSelectedNodeId.set(nodeId);
    this.nodeSelected.emit(nodeId);
  }

  /** Double-click a drillable node to enter its subgraph. */
  private handleChartDblClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const linkElement = target.closest("a");
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) return;
    const node = this.activeNodes().find((candidate) => candidate.id === nodeId);
    if (!node || !this.resolveSubgraph(node)) return;
    event.preventDefault();
    event.stopPropagation();
    this.enterSubgraph(node);
  }

  /** Right-click a node to resolve it and emit {@link nodeContextMenu}, suppressing the browser menu. */
  private handleChartContextMenu(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const linkElement = target.closest("a");
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) return;
    const node = this.activeNodes().find((candidate) => candidate.id === nodeId);
    if (!node) return;

    event.preventDefault();
    event.stopPropagation();
    this.internalContextMenuTarget.set(node);
    const viewportRect = this.viewportRef().nativeElement.getBoundingClientRect();
    this.nodeContextMenu.emit({
      nodeId,
      x: event.clientX - viewportRect.left,
      y: event.clientY - viewportRect.top,
    });
  }

  /** Dismiss the context-menu target. A host calls this from its menu's own close/action handler. */
  closeContextMenu(): void {
    this.internalContextMenuTarget.set(null);
  }

  private readNodeIdFromLink(linkElement: Element): string | null {
    const href = linkElement.getAttribute("href") ?? linkElement.getAttribute("xlink:href");
    if (!href) return null;
    try {
      const url = new URL(href, window.location.origin);
      const real = url.searchParams.get(NODE_HREF_PARAM);
      return real && this.aliasMap().toAlias.has(real) ? real : null;
    } catch {
      return null;
    }
  }

  private scheduleSelectedNodeClass(selectedId: string | null): void {
    requestAnimationFrame(() => this.applySelectedNodeClass(selectedId));
  }

  /** Defer status-class application to the next frame, after any pending render. */
  private scheduleStatusClasses(): void {
    requestAnimationFrame(() => this.applyStatusClasses());
  }

  /** Defer progress-bar application to the next frame, after any pending render. */
  private scheduleNodeProgressBars(): void {
    requestAnimationFrame(() => this.applyNodeProgressBars());
  }

  /** Defer subgraph-preview application to the next frame, after any pending render. */
  private scheduleSubgraphPreviews(): void {
    requestAnimationFrame(() => this.applySubgraphPreviews());
  }

  // ── Shape-offset overlays (selected/current outline ring, progress trace) ──
  //
  // PURPOSE: Draw the selected/current highlight and the progress indicator as
  // the node's own shape redrawn larger (an outline ring), rather than a fill
  // colour or an in-label progress bar — so they read the same way regardless
  // of whether the underlying node is a rect, diamond, or subroutine.
  //
  // VALUE: Mermaid already computed each node's exact shape when it rendered
  // the `<rect>`/`<polygon>` in `.label-container` — these helpers read that
  // geometry back out and offset it, instead of re-deriving node dimensions.

  /** Find the SVG element Mermaid drew for a node's own shape (`<rect>` for `rect`/`subroutine`-envelope purposes, `<polygon>` for `diamond`/`subroutine`). */
  private findNodeShapeElement(nodeElement: Element): SVGGraphicsElement | null {
    return nodeElement.querySelector<SVGGraphicsElement>(".label-container");
  }

  /** Reads `shapeEl`'s geometry and returns it offset outward by `offsetPx`, or null if `shapeEl` is a shape kind this library doesn't know how to offset. */
  private readOffsetGeometry(shapeEl: SVGGraphicsElement, offsetPx: number): OffsetShapeGeometry | null {
    if (shapeEl instanceof SVGRectElement) {
      const rx = shapeEl.rx?.baseVal?.value ?? 0;
      return offsetRectGeometry(shapeEl.x.baseVal.value, shapeEl.y.baseVal.value, shapeEl.width.baseVal.value, shapeEl.height.baseVal.value, rx, offsetPx);
    }
    if (shapeEl instanceof SVGPolygonElement) {
      const points = Array.from(shapeEl.points).map((point) => ({ x: point.x, y: point.y }));
      return offsetPolygonGeometry(points, offsetPx);
    }
    return null;
  }

  /** Reads `shapeEl`'s own (un-offset) bounding-box top-right corner, in the same local coordinate space {@link readOffsetGeometry} uses. */
  private readShapeTopRightCorner(shapeEl: SVGGraphicsElement): ShapePoint | null {
    const geometry = this.readOffsetGeometry(shapeEl, 0);
    if (!geometry) return null;
    if (geometry.kind === "rect") {
      return { x: geometry.x + geometry.width, y: geometry.y };
    }
    const xs = geometry.points.map((point) => point.x);
    const ys = geometry.points.map((point) => point.y);
    return { x: Math.max(...xs), y: Math.min(...ys) };
  }

  /**
   * Creates or updates a `cssClass`-marked `<rect>`/`<polygon>` sibling inside
   * `nodeElement`, tracing the node's own shape offset outward by `offsetPx`.
   *
   * VALUE: Reuses `shapeEl`'s own `transform` attribute (rather than reading
   * ancestor transforms) so the overlay lands in the same screen position
   * regardless of whether Mermaid put the positioning transform on the shape
   * element itself (as it does for `diamond`) or left it on an ancestor group
   * (as it does for `rect`) — copying "whatever transform the shape already
   * has" is correct either way.
   */
  private applyShapeOutlineOverlay(nodeElement: Element, cssClass: string, offsetPx: number): void {
    const existing = nodeElement.querySelector<SVGGraphicsElement>(`:scope > .${cssClass}`);
    const shapeEl = this.findNodeShapeElement(nodeElement);
    const geometry = shapeEl ? this.readOffsetGeometry(shapeEl, offsetPx) : null;
    if (!shapeEl || !geometry) {
      existing?.remove();
      return;
    }

    const tag = geometry.kind === "rect" ? "rect" : "polygon";
    let overlay = existing;
    if (!overlay || overlay.tagName.toLowerCase() !== tag) {
      existing?.remove();
      overlay = document.createElementNS(SVG_NAMESPACE, tag) as SVGGraphicsElement;
      overlay.classList.add(cssClass, NODE_DECORATION_CLASS);
      overlay.setAttribute("fill", "none");
      overlay.setAttribute("pointer-events", "none");
      nodeElement.appendChild(overlay);
    }

    const transform = shapeEl.getAttribute("transform");
    if (transform) overlay.setAttribute("transform", transform);
    else overlay.removeAttribute("transform");

    if (geometry.kind === "rect") {
      overlay.setAttribute("x", String(geometry.x));
      overlay.setAttribute("y", String(geometry.y));
      overlay.setAttribute("width", String(geometry.width));
      overlay.setAttribute("height", String(geometry.height));
      if (geometry.rx) overlay.setAttribute("rx", String(geometry.rx));
      else overlay.removeAttribute("rx");
    } else {
      overlay.setAttribute("points", geometry.points.map((point) => `${point.x},${point.y}`).join(" "));
    }
  }

  /** Removes a previously-applied {@link applyShapeOutlineOverlay} ring, if present. */
  private removeShapeOutlineOverlay(nodeElement: Element, cssClass: string): void {
    nodeElement.querySelector(`:scope > .${cssClass}`)?.remove();
  }

  /**
   * Creates, updates, or removes a drillable node's corner badge: a small
   * circle-plus-cross glyph centred on the node shape's own top-right corner.
   *
   * VALUE: Replaces a dashed outline as the "this node opens a subgraph" cue,
   * so the node's own border can stay solid while the badge alone carries
   * that meaning (see graph-canvas.component.scss).
   */
  private applySubgraphBadge(nodeElement: Element, hasSubgraph: boolean): void {
    const existing = nodeElement.querySelector<SVGGElement>(`:scope > .${SUBGRAPH_BADGE_CLASS}`);
    const shapeEl = hasSubgraph ? this.findNodeShapeElement(nodeElement) : null;
    const corner = shapeEl ? this.readShapeTopRightCorner(shapeEl) : null;
    if (!corner) {
      existing?.remove();
      return;
    }

    let group = existing;
    if (!group) {
      group = document.createElementNS(SVG_NAMESPACE, "g") as SVGGElement;
      group.classList.add(SUBGRAPH_BADGE_CLASS, NODE_DECORATION_CLASS);
      group.setAttribute("pointer-events", "none");
      group.appendChild(document.createElementNS(SVG_NAMESPACE, "circle"));
      group.appendChild(document.createElementNS(SVG_NAMESPACE, "line"));
      group.appendChild(document.createElementNS(SVG_NAMESPACE, "line"));
      nodeElement.appendChild(group);
    }

    const transform = shapeEl!.getAttribute("transform");
    if (transform) group.setAttribute("transform", transform);
    else group.removeAttribute("transform");

    const circle = group.querySelector("circle")!;
    circle.setAttribute("cx", String(corner.x));
    circle.setAttribute("cy", String(corner.y));
    circle.setAttribute("r", String(SUBGRAPH_BADGE_RADIUS_PX));

    const [vertical, horizontal] = Array.from(group.querySelectorAll("line"));
    const armLength = SUBGRAPH_BADGE_RADIUS_PX * 0.5;
    vertical.setAttribute("x1", String(corner.x));
    vertical.setAttribute("y1", String(corner.y - armLength));
    vertical.setAttribute("x2", String(corner.x));
    vertical.setAttribute("y2", String(corner.y + armLength));
    horizontal.setAttribute("x1", String(corner.x - armLength));
    horizontal.setAttribute("y1", String(corner.y));
    horizontal.setAttribute("x2", String(corner.x + armLength));
    horizontal.setAttribute("y2", String(corner.y));
  }

  /**
   * Creates, updates, or removes a node's progress trace: a `<path>` tracing
   * its shape (offset outward by {@link NODE_PROGRESS_TRACE_OFFSET_PX}),
   * revealed clockwise from its topmost point via `stroke-dasharray`/
   * `stroke-dashoffset`, plus a small percentage `<text>` above it.
   */
  private applyProgressTraceOverlay(
    nodeElement: Element,
    progressPercent: number | null,
    activeChildNodeProgresses?: number[] | null,
  ): void {
    const existingPaths = Array.from(nodeElement.querySelectorAll<SVGPathElement>(`:scope > .${PROGRESS_TRACE_CLASS}`));
    const existingText = nodeElement.querySelector<SVGTextElement>(`:scope > .${PROGRESS_TEXT_CLASS}`);

    const childProgresses = activeChildNodeProgresses
      ? activeChildNodeProgresses
          .map((p) => this.readNodeProgressPercent(p))
          .filter((p): p is number => p !== null)
      : null;

    const hasProgress = progressPercent !== null || (childProgresses && childProgresses.length > 0);
    const shapeEl = hasProgress ? this.findNodeShapeElement(nodeElement) : null;

    if (!hasProgress || !shapeEl) {
      existingPaths.forEach((p) => p.remove());
      existingText?.remove();
      return;
    }

    const transform = shapeEl.getAttribute("transform");

    // Gather all progress configurations to render
    const NODE_PROGRESS_STACK_OFFSET_PX = 4;
    const allPercents: { percent: number; opacity: number; offset: number }[] = [];
    if (progressPercent !== null) {
      allPercents.push({
        percent: progressPercent,
        opacity: 1,
        offset: NODE_PROGRESS_TRACE_OFFSET_PX,
      });
    }

    if (childProgresses) {
      childProgresses.forEach((percent) => {
        allPercents.push({
          percent,
          opacity: 0.5,
          offset: NODE_PROGRESS_TRACE_OFFSET_PX + allPercents.length * NODE_PROGRESS_STACK_OFFSET_PX,
        });
      });
    }

    // Ensure we have exactly allPercents.length path elements
    const paths: SVGPathElement[] = [];
    for (let i = 0; i < allPercents.length; i++) {
      let path = existingPaths[i];
      if (!path) {
        path = document.createElementNS(SVG_NAMESPACE, "path") as SVGPathElement;
        path.classList.add(PROGRESS_TRACE_CLASS, NODE_DECORATION_CLASS);
        path.setAttribute("fill", "none");
        path.setAttribute("pointer-events", "none");
        nodeElement.appendChild(path);
      }
      paths.push(path);
    }
    // Remove excess paths
    for (let i = allPercents.length; i < existingPaths.length; i++) {
      existingPaths[i].remove();
    }

    // Apply values to each path
    for (let i = 0; i < allPercents.length; i++) {
      const config = allPercents[i];
      const path = paths[i];
      const geometry = this.readOffsetGeometry(shapeEl, config.offset);
      if (!geometry) continue;

      if (transform) path.setAttribute("transform", transform);
      else path.removeAttribute("transform");

      path.setAttribute("d", buildTopStartOutlinePath(geometry));
      const pathLength = computeOutlinePerimeterLength(geometry);
      path.style.strokeDasharray = `${pathLength}`;
      path.style.strokeDashoffset = `${pathLength * (1 - config.percent / 100)}`;
      path.style.opacity = `${config.opacity}`;
    }

    // Update text above the outermost path
    const outermostConfig = allPercents[allPercents.length - 1];
    const outermostGeometry = this.readOffsetGeometry(shapeEl, outermostConfig.offset);
    if (outermostGeometry) {
      const topPoint = outermostGeometry.kind === "rect"
        ? { x: outermostGeometry.x + outermostGeometry.width / 2, y: outermostGeometry.y }
        : outermostGeometry.points.reduce((top, point) => (point.y < top.y ? point : top));

      let text = existingText;
      if (!text) {
        text = document.createElementNS(SVG_NAMESPACE, "text") as SVGTextElement;
        text.classList.add(PROGRESS_TEXT_CLASS, NODE_DECORATION_CLASS);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("pointer-events", "none");
        nodeElement.appendChild(text);
      }
      if (transform) text.setAttribute("transform", transform);
      else text.removeAttribute("transform");
      text.setAttribute("x", String(topPoint.x));
      text.setAttribute("y", String(topPoint.y - PROGRESS_TEXT_GAP_PX));

      // Show all percentages, e.g. "33% | 20% | 90%"
      const nextText = allPercents.map((p) => `${p.percent}%`).join(" | ");
      if (text.textContent !== nextText) text.textContent = nextText;
    } else {
      existingText?.remove();
    }
  }

  /**
   * Apply each node's status colour and the live "current" highlight directly to
   * its rendered `.node` element, replacing the previous classes.
   *
   * PURPOSE: Reflect execution progress without regenerating the Mermaid source.
   *
   * VALUE: The SVG stays put across status updates — no teardown/rebuild — so the
   * camera measures a stable layout and node label sizing never jumps.
   */
  private applyStatusClasses(): void {
    const currentId = this.currentNodeId();
    const suppressLivePulses = this.replayActive();
    const styles = this.effectiveStatusStyles();
    const stripClasses = [...this.statusClassNames(), CURRENT_NODE_CLASS, HAS_SUBGRAPH_CLASS];

    if (suppressLivePulses) {
      this.clearEdgePulseClasses();
    }

    // Clean up stale nodes from previousStatuses map (e.g. after subgraph navigation)
    const activeIds = new Set(this.activeNodes().map((n) => n.id));
    for (const key of this.previousStatuses.keys()) {
      if (!activeIds.has(key)) {
        this.previousStatuses.delete(key);
      }
    }

    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      element.classList.remove(...stripClasses);
      const statusClass = styles[node.status]?.className;
      if (statusClass) element.classList.add(statusClass);
      if (node.id === currentId) {
        element.classList.add(CURRENT_NODE_CLASS);
        this.applyShapeOutlineOverlay(element, CURRENT_OUTLINE_CLASS, NODE_OUTLINE_OFFSET_PX);
      } else {
        this.removeShapeOutlineOverlay(element, CURRENT_OUTLINE_CLASS);
      }
      const hasSubgraph = !!this.resolveSubgraph(node);
      if (hasSubgraph) element.classList.add(HAS_SUBGRAPH_CLASS);
      this.applySubgraphBadge(element, hasSubgraph);

      // Detect transitions and trigger the generic pulse animations
      const prevStatus = this.previousStatuses.get(node.id);
      if (!suppressLivePulses && prevStatus !== undefined && prevStatus !== node.status) {
        if (statusClass) {
          this.triggerNodePulse(node.id);
          this.triggerIncomingEdgesPulse(node.id, statusClass);
        }
      }
      this.previousStatuses.set(node.id, node.status);
    }
    // Keep connection lines styled based on target node states
    this.applyEdgeStatusClasses();
  }

  /**
   * Temporarily thickens the node border outline.
   *
   * VALUE: Provides immediate visual feedback to the human operator that a specific
   * node has transitioned status (e.g. finished running or encountered an error).
   */
  private triggerNodePulse(nodeId: string): void {
    const element = this.findNodeElement(nodeId);
    if (!element) return;

    element.classList.add("pulse-active");
    setTimeout(() => element.classList.remove("pulse-active"), NODE_PULSE_DURATION_MS);
  }

  /**
   * Temporarily animates incoming connections as dashed marching ants.
   *
   * VALUE: Visually represents active flow transitions, making it clear to the operator
   * which path triggered the newly active node.
   */
  private triggerIncomingEdgesPulse(nodeId: string, statusClass: string): void {
    const { toAlias } = this.aliasMap();
    const pulseClass = `edge-pulse--${statusClass}`;
    const nodes = this.activeNodes();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    for (const edge of this.resolveEdges()) {
      if (edge.to !== nodeId) continue;

      if (!this.isEdgeActive(edge, nodeMap)) continue;

      const parentAlias = toAlias.get(edge.from);
      const childAlias = toAlias.get(edge.to);
      if (!parentAlias || !childAlias) continue;

      const edgeEl = this.findEdgeElement(parentAlias, childAlias);
      if (!edgeEl) continue;

      edgeEl.classList.add(pulseClass);
      setTimeout(() => edgeEl.classList.remove(pulseClass), EDGE_PULSE_DURATION_MS);
    }
  }

  /**
   * Applies status class modifiers to connection lines leading to nodes.
   *
   * VALUE: Styles traversed connection lines based on target node outcomes (e.g., solid
   * green for complete, solid red for failed), highlighting the execution path.
   */
  private applyEdgeStatusClasses(): void {
    const { toAlias } = this.aliasMap();
    const host = this.hostElement.nativeElement;
    const styles = this.effectiveStatusStyles();
    const nodes = this.activeNodes();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const suppressRunningEdgeAnimation = this.replayActive();

    // Clean up any old edge status classes first from the flowchart link paths
    for (const edgeEl of host.querySelectorAll(".mermaid .flowchart-link")) {
      const toRemove: string[] = [];
      for (let i = 0; i < edgeEl.classList.length; i++) {
        const cls = edgeEl.classList[i];
        if (cls.startsWith("edge-status--")) {
          toRemove.push(cls);
        }
      }
      if (toRemove.length > 0) {
        edgeEl.classList.remove(...toRemove);
      }
    }

    for (const edge of this.resolveEdges()) {
      const parentAlias = toAlias.get(edge.from);
      const childAlias = toAlias.get(edge.to);
      if (!parentAlias || !childAlias) continue;

      const childNode = nodeMap.get(edge.to);
      if (!childNode) continue;

      if (this.isEdgeActive(edge, nodeMap)) {
        const edgeEl = this.findEdgeElement(parentAlias, childAlias);
        if (!edgeEl) continue;

        const statusClass = styles[childNode.status]?.className;
        if (statusClass && !(suppressRunningEdgeAnimation && childNode.status === "running")) {
          edgeEl.classList.add(`edge-status--${statusClass}`);
        }
      }
    }
  }

  /**
   * Determine if a connection line should be visually colored/animated based on execution.
   *
   * VALUE: Prevents loop paths from highlighting prematurely, handles failed node recovery pathing,
   * and preserves parallel join animations using endedAt/startedAt timestamps.
   */
  private isEdgeActive(edge: GraphEdge, nodeMap: Map<string, MermaidRuntime.Node>): boolean {
    const parentNode = nodeMap.get(edge.from);
    const childNode = nodeMap.get(edge.to);
    if (!parentNode || !childNode) return false;

    // 1. Parent must have executed (not undone/skipped/running)
    const isParentExecuted = parentNode.status !== "undone" && parentNode.status !== "skipped" && parentNode.status !== "running";
    if (!isParentExecuted) return false;

    // 2. Child must be active/completed (not undone/skipped)
    if (childNode.status === "undone" || childNode.status === "skipped") return false;

    // 3. Resolve multi-parent connections using execution timestamps
    if (childNode.startedAt) {
      const childStart = Date.parse(childNode.startedAt);
      if (!isNaN(childStart)) {
        const candidates: { id: string; endTime: number }[] = [];
        const edges = this.resolveEdges();
        for (const e of edges) {
          if (e.to !== childNode.id) continue;
          const p = nodeMap.get(e.from);
          if (p && p.endedAt) {
            const pEnd = Date.parse(p.endedAt);
            if (!isNaN(pEnd) && pEnd <= childStart) {
              candidates.push({ id: p.id, endTime: pEnd });
            }
          }
        }

        if (candidates.length > 1) {
          const maxEndTime = Math.max(...candidates.map((c) => c.endTime));
          const parentCandidate = candidates.find((c) => c.id === parentNode.id);
          if (parentCandidate) {
            // Active if it is the closest parent OR completed within parallel join threshold
            const diff = maxEndTime - parentCandidate.endTime;
            return diff <= PARALLEL_JOIN_THRESHOLD_MS;
          }
        }
      }
    }

    return true;
  }

  /**
   * Find a rendered Mermaid edge path element in the DOM.
   *
   * VALUE: Direct query targeting of path elements via data-id and id attributes, bypassing
   * Mermaid's auto-generated unique ID suffixes.
   */
  private findEdgeElement(parentAlias: string, childAlias: string): Element | null {
    const host = this.hostElement.nativeElement;
    return host.querySelector(`.mermaid [data-id^="L_${parentAlias}_${childAlias}_"]`) ?? host.querySelector(`.mermaid [id*="-L_${parentAlias}_${childAlias}_"]`) ?? null;
  }

  /**
   * Apply each node's progress directly to the rendered Mermaid label.
   *
   * PURPOSE: Show live 0-100% node progress without changing the Mermaid source.
   *
   * VALUE: Progress ticks update the bar in place, keeping the camera and
   * selected node stable while long-running work advances.
   */
  private applyNodeProgressBars(): void {
    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      this.applyProgressTraceOverlay(
        element,
        this.readNodeProgressPercent(node.progressPercent),
        node.activeChildNodeProgresses,
      );
    }
  }

  /**
   * Applies the `selected` class and its outline overlay to `selectedId`'s
   * node, removing both from any other node.
   *
   * VALUE: Leaves the already-selected node's overlay untouched when called
   * again with the same id (e.g. from `onChartMutation`, which calls this
   * unconditionally on every mutation) — appending/removing an SVG element is
   * a `childList` mutation the observer can't attribute to the child that
   * moved (its `target` is the parent `.node` group, not the overlay), so an
   * unconditional destroy-then-recreate here would re-trigger the observer on
   * every one of its own passes: an infinite mutate → observe → mutate loop
   * that freezes the tab.
   */
  private applySelectedNodeClass(selectedId: string | null): void {
    const host = this.hostElement.nativeElement;
    const selectedLink = selectedId ? (Array.from(host.querySelectorAll(".mermaid a")) as Element[]).find((linkElement) => this.readNodeIdFromLink(linkElement) === selectedId) : undefined;
    const selectedNode = selectedLink?.querySelector(".node") ?? selectedLink?.closest(".node") ?? null;

    for (const nodeElement of host.querySelectorAll(".mermaid .node.selected")) {
      if (nodeElement === selectedNode) continue;
      nodeElement.classList.remove("selected");
      this.removeShapeOutlineOverlay(nodeElement, SELECTED_OUTLINE_CLASS);
    }
    if (!selectedNode) return;

    selectedNode.classList.add("selected");
    this.applyShapeOutlineOverlay(selectedNode, SELECTED_OUTLINE_CLASS, NODE_OUTLINE_OFFSET_PX);
  }

  // ── Subgraph inline preview ───────────────────────────────────────

  /**
   * Inject (or refresh) a static thumbnail of each drillable node's child graph
   * into the node label.
   *
   * PURPOSE: Hint a node's subgraph and its rough shape inline, without the host
   * decorating anything.
   *
   * VALUE: Decoration only — it is `pointer-events: none`, cached by structure
   * hash so status/progress ticks never rebuild it, and re-injected idempotently
   * after a structural Mermaid re-render. Never participates in selection,
   * follow, or progress, so it cannot trigger a MutationObserver re-render storm.
   */
  private applySubgraphPreviews(): void {
    if (!this.showSubgraphPreview()) {
      this.removeSubgraphPreviews();
      return;
    }

    const activeNodeIds = new Set(this.activeNodes().map((n) => n.id));

    // Cleanup hashes for nodes that are no longer active
    for (const nodeId of Array.from(this.subgraphStructureHashes.keys())) {
      if (!activeNodeIds.has(nodeId)) {
        this.subgraphStructureHashes.delete(nodeId);
      }
    }

    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      const label = element?.querySelector(".nodeLabel") ?? element?.querySelector("span");
      if (!element || !label) {
        this.subgraphStructureHashes.delete(node.id);
        continue;
      }

      const graph = this.resolveSubgraph(node);
      if (!graph) {
        label.querySelector(".task-graph-node-subgraph-preview")?.remove();
        this.subgraphStructureHashes.delete(node.id);
        continue;
      }

      const structHash = hashPreviewStructure(graph);
      const statusHash = hashPreviewStatuses(graph);
      const combinedHash = `${structHash}::${statusHash}`;

      let wrap = label.querySelector(".task-graph-node-subgraph-preview") as HTMLElement;
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.classList.add("task-graph-node-subgraph-preview");
        label.append(wrap);
      }

      // If the structure or status changed, we render/update
      const lastHash = this.subgraphStructureHashes.get(node.id);
      if (lastHash !== combinedHash) {
        this.subgraphStructureHashes.set(node.id, combinedHash);
        this.renderSubgraphMermaid(node.id, graph, wrap);
      }
    }
  }

  /** Strip every injected subgraph thumbnail (toggle off). */
  private removeSubgraphPreviews(): void {
    this.subgraphStructureHashes.clear();
    for (const preview of this.hostElement.nativeElement.querySelectorAll(".task-graph-node-subgraph-preview")) {
      preview.remove();
    }
  }

  private renderSubgraphMermaid(nodeId: string, graph: MermaidRuntime.Graph, wrap: HTMLElement): void {
    const aliasByNodeId = new Map<string, string>();
    graph.nodes.forEach((node, index) => aliasByNodeId.set(node.id, `n${index}`));

    const edges = resolvePreviewEdges(graph);
    const lines = [
      `flowchart TD`,
      ...graph.nodes.map((node) => `  ${aliasByNodeId.get(node.id)}((" "))`),
      ...edges
        .map((edge) => {
          const from = aliasByNodeId.get(edge.from);
          const to = aliasByNodeId.get(edge.to);
          return from && to ? `  ${from} --> ${to}` : null;
        })
        .filter((line): line is string => line !== null),
    ];
    const source = lines.join("\n");

    const renderId = `mr-sg-preview-${nodeId.replace(/[^a-zA-Z0-9-]/g, "")}-${Math.random().toString(36).substring(2, 9)}`;
    const config = {
      ...this.mermaidOptions(),
      flowchart: {
        ...this.mermaidOptions().flowchart,
        htmlLabels: false,
        useMaxWidth: true,
        rankSpacing: 16,
        nodeSpacing: 16,
        curve: "basis",
      },
    };

    mermaid
      .render(renderId, source)
      .then((result: { svg: string }) => {
        // Check if this node is still active and this render is still the current hash
        if (this.subgraphStructureHashes.has(nodeId)) {
          wrap.innerHTML = `<div class="gp-simple-root">${result.svg}</div>`;
          this.applySubgraphStatusClasses(nodeId, graph, aliasByNodeId, wrap);
        }
      })
      .catch((err: unknown) => {
        console.error("Failed to render subgraph preview", err);
      });
  }

  private applySubgraphStatusClasses(nodeId: string, graph: MermaidRuntime.Graph, aliasByNodeId: Map<string, string>, wrap: HTMLElement): void {
    const styles = this.effectiveStatusStyles();
    for (const node of graph.nodes) {
      const alias = aliasByNodeId.get(node.id);
      if (!alias) continue;
      const element = wrap.querySelector(`.node[id^="${alias}-"]`);
      if (!element) continue;

      const statusClassNames = Object.values(styles)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => s.className);
      element.classList.remove(...statusClassNames);

      const statusClass = resolvePreviewStatusClass(node.status, styles);
      if (statusClass) element.classList.add(statusClass);
    }
  }

  // ── Subgraph navigation ─────────────────────────────────────────

  /** Resolve a node's child graph via the host resolver, else its inline graph. */
  private resolveSubgraph(node: MermaidRuntime.Node): MermaidRuntime.Graph | null {
    const resolver = this.subgraphResolver();
    return (resolver ? resolver(node) : null) ?? node.subgraph ?? null;
  }

  /** Drill into a node's subgraph, pushing one level onto the stack. */
  enterSubgraph(node: MermaidRuntime.Node): void {
    const graph = this.resolveSubgraph(node);
    if (!graph) return;
    const frame: GraphFrame = {
      nodeId: node.id,
      label: node.subgraphLabel ?? node.title,
      graph,
    };
    const next = [...this.graphStack(), frame];
    this.graphStack.set(next);
    this.onNavigated(next, "enter");
  }

  /** Enter the currently-selected node's subgraph (inspector affordance). */
  enterSelectedSubgraph(): void {
    const node = this.selectedNode();
    if (node) this.enterSubgraph(node);
  }

  /** Pop the stack back to `depth` (0 = root). Backs the breadcrumb crumbs. */
  goToDepth(depth: number): void {
    if (depth >= this.graphStack().length) return;
    const next = this.graphStack().slice(0, depth);
    this.graphStack.set(next);
    this.onNavigated(next, "leave");
  }

  /** Leave the current subgraph, one level up. */
  leaveSubgraph(): void {
    this.goToDepth(Math.max(0, this.graphStack().length - 1));
  }

  /**
   * Shared after-navigation bookkeeping.
   *
   * PURPOSE: Reset per-level selection, re-fit the new level, and tell the host
   * where we are via the nav outputs.
   *
   * VALUE: Enter, leave, and breadcrumb jumps all emit one consistent path so the
   * host's history stays in lockstep with the viewer.
   */
  private onNavigated(stack: GraphFrame[], direction: "enter" | "leave"): void {
    this.internalSelectedNodeId.set(null);
    this.internalContextMenuTarget.set(null);
    this.hasFitInitialView = false;
    const top = stack[stack.length - 1] ?? null;
    const path = stack.map((frame) => frame.nodeId);
    const event: SubgraphNavEvent = {
      path,
      nodeId: top?.nodeId ?? null,
      label: top?.label ?? null,
    };
    if (direction === "enter") this.subgraphEntered.emit(event);
    else this.subgraphLeft.emit(event);
    this.graphPathChange.emit(path);
  }

  /**
   * Rebuild the navigation stack to match a host-supplied node-id path.
   *
   * PURPOSE: Let the host restore subgraph depth from browser history without the
   * viewer and the URL fighting each other.
   *
   * VALUE: A no-op when the stack already matches (so the echo from our own
   * {@link graphPathChange} never loops), and it walks the chain from the root
   * input, resolving each level — so deep links and back/forward land exactly
   * where the user left off.
   */
  private reconcileStackToPath(desired: readonly string[]): void {
    const current = untracked(() => this.graphStack()).map((frame) => frame.nodeId);
    if (this.samePath(current, desired)) return;

    const frames: GraphFrame[] = [];
    let nodes = untracked(() => this.nodes());
    for (const nodeId of desired) {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) break;
      const graph = this.resolveSubgraph(node);
      if (!graph) break;
      frames.push({ nodeId, label: node.subgraphLabel ?? node.title, graph });
      nodes = graph.nodes;
    }
    this.graphStack.set(frames);
    this.internalSelectedNodeId.set(null);
    this.hasFitInitialView = false;
  }

  /** Shallow ordered equality for two node-id paths. */
  private samePath(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  /**
   * Remove transient live execution pulse classes from Mermaid edge paths.
   *
   * PURPOSE: Replay owns its own overlay animation and should not reuse the live
   * execution pulse classes.
   *
   * VALUE: The base graph lines remain stable while replay paints a separate
   * current-event trace above them.
   */
  private clearEdgePulseClasses(): void {
    const host = this.hostElement.nativeElement;
    for (const edgeEl of host.querySelectorAll(".mermaid .flowchart-link")) {
      const toRemove: string[] = [];
      for (let i = 0; i < edgeEl.classList.length; i++) {
        const cls = edgeEl.classList[i];
        if (cls.startsWith("edge-pulse--")) {
          toRemove.push(cls);
        }
      }
      if (toRemove.length > 0) {
        edgeEl.classList.remove(...toRemove);
      }
    }
  }

  /**
   * Schedule the visual for the current replay event after DOM status updates land.
   *
   * PURPOSE: Replay animation is event-driven, so each tick paints exactly one
   * node flash or edge trace.
   *
   * VALUE: The completed graph never enters an all-animated final state, and the
   * overlay follows the recorded sequence including loops and parallel branches.
   */
  private scheduleReplayEventAnimation(replayActive: boolean, replayEvent: MermaidRuntime.ExecutionEvent | null): void {
    if (!replayActive) {
      this.lastReplayEventKey = null;
      this.clearReplayAnimationFrame();
      this.clearReplayEventVisuals();
      return;
    }

    const eventKey = replayEvent ? this.buildReplayEventKey(replayEvent) : null;
    if (eventKey === this.lastReplayEventKey) return;
    this.lastReplayEventKey = eventKey;

    this.clearReplayAnimationFrame();
    this.clearReplayEventVisuals();
    if (!replayEvent) return;

    this.replayAnimationFrame = requestAnimationFrame(() => {
      this.replayAnimationFrame = null;
      this.playReplayEventAnimation(replayEvent);
    });
  }

  /**
   * Build a stable identity for one replay event.
   *
   * PURPOSE: Avoid repainting the same event when unrelated signal effects run.
   *
   * VALUE: Replay visuals advance once per timeline sequence entry.
   */
  private buildReplayEventKey(event: MermaidRuntime.ExecutionEvent): string {
    return `${event.seq}:${event.kind}:${event.nodeId ?? ""}:${event.edgeId ?? ""}`;
  }

  /**
   * Paint the visual for the current replay event.
   *
   * PURPOSE: Route each timeline event kind to its matching one-shot animation.
   *
   * VALUE: Node events flash nodes; edge traversal events draw a temporary trace
   * over Mermaid's exact edge path.
   */
  private playReplayEventAnimation(event: MermaidRuntime.ExecutionEvent): void {
    if (event.kind === "node-started" && event.nodeId) {
      this.flashReplayNode(event.nodeId);
    } else if (event.kind === "edge-traversed") {
      const edge = this.resolveReplayEdge(event);
      if (edge) this.traceReplayEdge(edge);
    }

    this.replayAnimationTimer = setTimeout(() => this.clearReplayEventVisuals(), REPLAY_EVENT_CLEAR_DELAY_MS);
  }

  /**
   * Resolve a replay event's edge from its stable graph-execution edge id.
   *
   * PURPOSE: Decode the daemon's `kind:from:to[:label]` edge identity without
   * relying on final node state.
   *
   * VALUE: Loop backs, repeated traversals, and parallel branches animate in the
   * exact order they were recorded.
   */
  private resolveReplayEdge(event: MermaidRuntime.ExecutionEvent): GraphEdge | null {
    const edgeId = event.edgeId;
    if (!edgeId) return null;

    const parts = edgeId.split(":");
    if (parts.length < GRAPH_EDGE_ID_MIN_PARTS) return null;

    const from = parts[GRAPH_EDGE_ID_FROM_INDEX];
    const to = parts[GRAPH_EDGE_ID_TO_INDEX];
    if (!from || !to) return null;

    return { from, to };
  }

  /**
   * Flash one node for the active replay event.
   *
   * PURPOSE: Give node execution a short surface-sheen effect without changing
   * the node's persistent status styling.
   *
   * VALUE: Replay reads as a sequence of current events rather than a completed
   * graph blinking forever.
   */
  private flashReplayNode(nodeId: string): void {
    const element = this.findNodeElement(nodeId);
    if (!element) return;

    element.classList.remove(REPLAY_NODE_FLASH_CLASS);
    void (element as HTMLElement).offsetWidth;
    element.classList.add(REPLAY_NODE_FLASH_CLASS);
    setTimeout(() => element.classList.remove(REPLAY_NODE_FLASH_CLASS), REPLAY_NODE_FLASH_DURATION_MS);
  }

  /**
   * Draw a temporary trace over the current replay edge.
   *
   * PURPOSE: Reuse Mermaid's own edge route instead of reconstructing geometry
   * from node positions.
   *
   * VALUE: The replay path follows the exact rendered connector and avoids the
   * top-left origin collapse caused by assembled SVG path data.
   */
  private traceReplayEdge(edge: GraphEdge): void {
    const { toAlias } = this.aliasMap();
    const parentAlias = toAlias.get(edge.from);
    const childAlias = toAlias.get(edge.to);
    if (!parentAlias || !childAlias) return;

    const edgeElement = this.findEdgeElement(parentAlias, childAlias);
    const pathElement = this.findEdgePathElement(edgeElement);
    const pathData = pathElement?.getAttribute("d");
    const overlayGroup = this.getReplayOverlayGroup();
    if (!pathData || !overlayGroup) return;

    const tracePath = document.createElementNS(SVG_NAMESPACE, "path");
    tracePath.setAttribute("d", pathData);
    tracePath.setAttribute("pathLength", REPLAY_EDGE_TRACE_PATH_LENGTH);
    tracePath.classList.add(REPLAY_EDGE_TRACE_CLASS);
    overlayGroup.append(tracePath);
  }

  /**
   * Resolve the actual SVG path inside a Mermaid edge element.
   *
   * PURPOSE: Mermaid may return either the path itself or a wrapper, depending on
   * render version and selector match.
   *
   * VALUE: Replay tracing always copies from the real connector path.
   */
  private findEdgePathElement(edgeElement: Element | null): SVGPathElement | null {
    if (edgeElement instanceof SVGPathElement) return edgeElement;
    const childPath = edgeElement?.querySelector("path");
    return childPath instanceof SVGPathElement ? childPath : null;
  }

  /**
   * Get or create the replay overlay group inside Mermaid's SVG.
   *
   * PURPOSE: Keep transient replay paths in the same SVG coordinate space as the
   * rendered graph.
   *
   * VALUE: Cloned edge path data lands on top of the graph without touching the
   * original Mermaid edge elements.
   */
  private getReplayOverlayGroup(): SVGGElement | null {
    const svgElement = this.hostElement.nativeElement.querySelector(".mermaid svg");
    if (!(svgElement instanceof SVGSVGElement)) return null;

    const existing = svgElement.querySelector(`.${REPLAY_ANIMATION_OVERLAY_CLASS}`);
    if (existing instanceof SVGGElement) return existing;

    const overlayGroup = document.createElementNS(SVG_NAMESPACE, "g");
    overlayGroup.classList.add(REPLAY_ANIMATION_OVERLAY_CLASS);
    const rootGroup = svgElement.querySelector("g.output") ?? svgElement.querySelector("g") ?? svgElement;
    rootGroup.append(overlayGroup);
    return overlayGroup;
  }

  /**
   * Remove current replay event visuals from the graph.
   *
   * PURPOSE: Ensure each replay step starts from a clean overlay.
   *
   * VALUE: Only the active timeline event animates; previous traces do not build
   * up or leave the main graph altered.
   */
  private clearReplayEventVisuals(): void {
    this.clearReplayAnimationTimer();
    this.clearReplayAnimationOverlay();
    for (const nodeElement of this.hostElement.nativeElement.querySelectorAll(`.mermaid .node.${REPLAY_NODE_FLASH_CLASS}`)) {
      nodeElement.classList.remove(REPLAY_NODE_FLASH_CLASS);
    }
  }

  /**
   * Remove the replay SVG overlay group.
   *
   * PURPOSE: Clean up transient paths without touching Mermaid's generated graph.
   *
   * VALUE: Replay can stop or advance without leaving extra SVG elements behind.
   */
  private clearReplayAnimationOverlay(): void {
    this.hostElement.nativeElement.querySelector(`.mermaid .${REPLAY_ANIMATION_OVERLAY_CLASS}`)?.remove();
  }

  /**
   * Cancel a queued replay animation frame.
   *
   * PURPOSE: Prevent stale event animations from painting after replay stops or
   * a newer event arrives.
   *
   * VALUE: Fast scrubbing cannot paint an out-of-date node or edge after the
   * selected sequence changes.
   */
  private clearReplayAnimationFrame(): void {
    if (this.replayAnimationFrame === null) return;
    cancelAnimationFrame(this.replayAnimationFrame);
    this.replayAnimationFrame = null;
  }

  /**
   * Clear the replay visual cleanup timer.
   *
   * PURPOSE: Avoid overlapping cleanup timers while the user scrubs quickly.
   *
   * VALUE: The latest replay event controls the overlay lifecycle.
   */
  private clearReplayAnimationTimer(): void {
    if (this.replayAnimationTimer === null) return;
    clearTimeout(this.replayAnimationTimer);
    this.replayAnimationTimer = null;
  }
}
