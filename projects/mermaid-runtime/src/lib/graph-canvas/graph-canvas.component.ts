import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MarkdownModule, MermaidAPI } from "ngx-markdown";

import { MermaidRuntime } from "../task-graph-model";
import { GraphCameraComponent, type GraphRect } from "../graph-camera/graph-camera.component";
import { MinimapComponent } from "../minimap/minimap.component";

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

/** A breadcrumb entry: a navigable depth in the graph stack (0 = root). */
interface GraphCrumb {
  label: string;
  depth: number;
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

/**
 * Zoom cap when follow-execution frames the running nodes.
 *
 * Value: Keeps the camera from snapping uncomfortably close to one or two
 * nodes — "not too far, not too close" — while `frameRect` padding handles the
 * lower bound for larger running sets.
 */
const FOLLOW_MAX_ZOOM = 1.4;

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

/**
 * Most subgraph child nodes drawn in a node's inline mini-preview.
 *
 * PURPOSE: Keep the decorative thumbnail small and cheap regardless of how large
 * a child graph is.
 *
 * VALUE: Bounds the rendered SVG; any overflow is summarised as a "+N" marker.
 */
const SUBGRAPH_PREVIEW_MAX_NODES = 10;

/** Dot radius (px) for a node in the inline subgraph mini-preview. */
const SUBGRAPH_PREVIEW_DOT_RADIUS_PX = 2.4;

/** Horizontal gap (px) between dependency columns in the subgraph mini-preview. */
const SUBGRAPH_PREVIEW_COLUMN_GAP_PX = 13;

/** Vertical gap (px) between sibling rows in a subgraph mini-preview column. */
const SUBGRAPH_PREVIEW_ROW_GAP_PX = 9;

/** Outer padding (px) around the subgraph mini-preview drawing. */
const SUBGRAPH_PREVIEW_PADDING_PX = 5;

/** Extra width (px) reserved for the "+N" overflow marker in the mini-preview. */
const SUBGRAPH_PREVIEW_OVERFLOW_LABEL_WIDTH_PX = 16;

/**
 * Zoom scale threshold below which we show the simplified dot preview instead of the real Mermaid preview.
 *
 * Value: Keeps the node clear of high-density text and paths when zoomed far out, automatically
 * showing the simple preview instead.
 */
const SUBGRAPH_PREVIEW_DETAIL_ZOOM_THRESHOLD = 0.7;

/**
 * Default Mermaid render configuration for the task graph.
 *
 * Value: Dark theme to match the app, `loose` security so click hrefs render
 * as anchors we can intercept, and a smooth flowchart curve.
 */
const DEFAULT_MERMAID_OPTIONS: MermaidAPI.MermaidConfig = {
  theme: "dark",
  startOnLoad: true,
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

@Component({
  selector: "mr-graph-canvas",
  templateUrl: "./graph-canvas.component.html",
  styleUrl: "./graph-canvas.component.scss",
  host: { class: "mr-graph-canvas" },
  imports: [CommonModule, MarkdownModule, GraphCameraComponent, MinimapComponent],
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

  protected readonly runComplete = computed(() => {
    const ns = this.nodes();
    if (ns.length === 0) return false;
    const hasExecuted = ns.some((n) => n.status === 'complete' || n.status === 'failed' || n.status === 'skipped');
    const anyRunning = ns.some((n) => n.status === 'running');
    return hasExecuted && !anyRunning;
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

  /** Per-node display overrides, keyed by real node id. */
  readonly decorations = input<Record<string, MermaidRuntime.NodeDecoration>>({});

  /**
   * Status → visual-treatment overrides, merged over {@link DEFAULT_STATUS_STYLES}.
   *
   * VALUE: A host defines its own status vocabulary/colours (and can add states
   * beyond the built-in five) without forking the component.
   */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Breadcrumb label for the root (top-level) graph. */
  readonly rootLabel = input<string>("Main");

  /** Whether to render the breadcrumb overlay while inside a subgraph. */
  readonly showBreadcrumb = input<boolean>(true);

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

  protected readonly mermaidOptions = DEFAULT_MERMAID_OPTIONS;

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

  /** Whether the detailed preview should be displayed instead of the fallback dot preview. */
  protected readonly showDetailedPreview = computed(() => {
    return this.currentZoom() >= SUBGRAPH_PREVIEW_DETAIL_ZOOM_THRESHOLD;
  });

  /** Breadcrumb trail (root + each entered level); empty at the root graph. */
  protected readonly breadcrumb = computed<GraphCrumb[]>(() => {
    const stack = this.graphStack();
    if (stack.length === 0) return [];
    const crumbs: GraphCrumb[] = [{ label: this.rootLabel(), depth: 0 }];
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
      .map((node) => `${node.id}:${node.progressPercent ?? ""}:${node.progressLabel ?? ""}`)
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

  /** Last seen `followExecution` value, to detect off→on (which resumes follow). */
  private lastFollowOn = false;

  private followFramePending = false;

  /**
   * Track previous status of each node.
   *
   * VALUE: Detects real-time state transitions so the component only pulses nodes
   * that changed state while the user is actively watching.
   */
  private readonly previousStatuses = new Map<string, string>();

  constructor() {
    const host = this.hostElement.nativeElement;
    const clickListener = (event: MouseEvent) => this.handleChartClick(event);
    const dblClickListener = (event: MouseEvent) => this.handleChartDblClick(event);
    const contextMenuListener = (event: MouseEvent) => this.handleChartContextMenu(event);
    const chartObserver = new MutationObserver((mutations) => {
      const hasRealMutations = mutations.some((m) => {
        const target = m.target;
        if (target instanceof Element) {
          if (target.closest("mr-minimap, .mr-minimap")) {
            return false;
          }
          if (target.closest(".mr-path-animation-overlay-group, .mr-path-flow-line")) {
            return false;
          }
          if (target.closest(".task-graph-node-progress-wrap")) {
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
    });

    effect(() => this.scheduleSelectedNodeClass(this.effectiveSelectedNodeId()));

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
      this.effectiveStatusStyles();
      this.graphStack();
      this.scheduleStatusClasses();
    });

    effect(() => {
      this.progressKey();
      this.scheduleNodeProgressBars();
    });

    // Re-apply the inline subgraph thumbnails when the toggle flips, the active
    // level changes, or the detailed zoom threshold is crossed. A structural re-render
    // already re-applies them via `onChartMutation`; this covers the false→true toggle
    // and zoom threshold crossings.
    effect(() => {
      this.showSubgraphPreview();
      this.graphStack();
      this.showDetailedPreview();
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
      "flowchart TD",
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
    return decoration?.shape === "diamond" ? `  ${alias}{"${title}"}` : `  ${alias}["${title}"]`;
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
    // A structural re-render produces fresh, class-less nodes; re-apply status.
    this.applyStatusClasses();
    this.applySubgraphPreviews();
    this.applyNodeProgressBars();

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
    const styles = this.effectiveStatusStyles();
    const stripClasses = [...this.statusClassNames(), CURRENT_NODE_CLASS, HAS_SUBGRAPH_CLASS];

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
      if (node.id === currentId) element.classList.add(CURRENT_NODE_CLASS);
      if (this.resolveSubgraph(node)) element.classList.add(HAS_SUBGRAPH_CLASS);

      // Detect transitions and trigger the generic pulse animations
      const prevStatus = this.previousStatuses.get(node.id);
      if (prevStatus !== undefined && prevStatus !== node.status) {
        if (statusClass) {
          this.triggerNodePulse(node.id);
          this.triggerIncomingEdgesPulse(node.id, statusClass);
        }
      }
      this.previousStatuses.set(node.id, node.status);
    }
    // Keep connection lines styled based on target node states
    this.applyEdgeStatusClasses();
    // Apply dynamic trace flow animations on completed run
    this.updatePathAnimations();
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
        if (statusClass) {
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
  private findEdgeElement(parentAlias: string, childAlias: string): HTMLElement | null {
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
      const label = element?.querySelector(".nodeLabel") ?? element?.querySelector("span");
      if (!element || !label) continue;

      let progressWrap = element.querySelector(".task-graph-node-progress-wrap");
      if (!progressWrap) {
        progressWrap = document.createElement("div");
        progressWrap.classList.add("task-graph-node-progress-wrap");

        const progressElement = document.createElement("progress");
        progressElement.classList.add("task-graph-node-progress");
        progressElement.value = TASK_GRAPH_PROGRESS_MIN_PERCENT;
        progressElement.max = TASK_GRAPH_PROGRESS_MAX_PERCENT;

        const progressText = document.createElement("small");
        progressWrap.append(progressElement, progressText);
        label.append(progressWrap);
      }

      const progressPercent = this.readNodeProgressPercent(node.progressPercent);
      progressWrap.classList.toggle("has-progress", progressPercent !== null);

      const progressElement = progressWrap.querySelector("progress");
      if (progressElement instanceof HTMLProgressElement) {
        progressElement.value = progressPercent ?? TASK_GRAPH_PROGRESS_MIN_PERCENT;
        progressElement.max = TASK_GRAPH_PROGRESS_MAX_PERCENT;
      }

      const progressText = progressWrap.querySelector("small");
      // Only write when the text actually changes. Writing a non-empty
      // `textContent` replaces the child text node, which is a childList
      // mutation inside the subtree the host MutationObserver watches — an
      // unconditional write would re-trigger `onChartMutation` → this method in
      // an unbounded loop that freezes the page.
      if (progressText) {
        const nextText = progressPercent === null ? "" : `${progressPercent}%`;
        if (progressText.textContent !== nextText) progressText.textContent = nextText;
      }
    }
  }

  private applySelectedNodeClass(selectedId: string | null): void {
    const host = this.hostElement.nativeElement;
    for (const nodeElement of host.querySelectorAll(".mermaid .node.selected")) {
      nodeElement.classList.remove("selected");
    }
    if (!selectedId) return;

    const selectedLink = (Array.from(host.querySelectorAll(".mermaid a")) as Element[]).find((linkElement) => this.readNodeIdFromLink(linkElement) === selectedId);
    const selectedNode = selectedLink?.querySelector(".node") ?? selectedLink?.closest(".node");
    selectedNode?.classList.add("selected");
  }

  // ── Subgraph inline preview ────────────────────────────────────────

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
    const showDetailed = this.showDetailedPreview();

    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      const label = element?.querySelector(".nodeLabel") ?? element?.querySelector("span");
      if (!element || !label) continue;

      const existing = label.querySelector(".task-graph-node-subgraph-preview");
      const graph = this.resolveSubgraph(node);
      if (!graph) {
        existing?.remove();
        continue;
      }

      const { html, hash } = showDetailed ? this.buildSubgraphDetailedPreview(graph) : this.buildSubgraphPreview(graph);

      if (existing instanceof HTMLElement) {
        // Skip DOM write if the preview hash matches
        if (existing.dataset["sgHash"] === hash) {
          continue;
        }
        existing.innerHTML = html;
        existing.dataset["sgHash"] = hash;
      } else {
        const wrap = document.createElement("div");
        wrap.classList.add("task-graph-node-subgraph-preview");
        wrap.dataset["sgHash"] = hash;
        wrap.innerHTML = html;
        label.append(wrap);
      }
    }
  }

  /** Strip every injected subgraph thumbnail (toggle off). */
  private removeSubgraphPreviews(): void {
    for (const preview of this.hostElement.nativeElement.querySelectorAll(".task-graph-node-subgraph-preview")) {
      preview.remove();
    }
  }

  /**
   * Build the static mini-preview SVG for a child graph plus a structure hash.
   *
   * PURPOSE: Lay the child graph out as a tiny dependency-layered dot diagram
   * (columns = depth, terminal nodes accented) that reads as "this node contains
   * a few steps".
   *
   * VALUE: Pure structure — it ignores node status, so the cached SVG only needs
   * rebuilding when the child graph's nodes/edges change.
   */
  private buildSubgraphPreview(graph: MermaidRuntime.Graph): { html: string; hash: string } {
    const allEdges = this.resolveGraphEdges(graph);
    const hash = `${graph.nodes.map((node) => node.id).join("|")}::${allEdges.map((edge) => `${edge.from}>${edge.to}`).join("|")}`;

    const nodes = graph.nodes.slice(0, SUBGRAPH_PREVIEW_MAX_NODES);
    const truncated = graph.nodes.length - nodes.length;
    const ids = new Set(nodes.map((node) => node.id));
    const edges = allEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));

    const depthById = this.computeGraphDepths(nodes, edges);
    const hasOutgoing = new Set(edges.map((edge) => edge.from));

    // Group nodes into columns by depth, preserving declaration order within each.
    const columns: string[][] = [];
    for (const node of nodes) {
      const depth = depthById.get(node.id) ?? 0;
      (columns[depth] ??= []).push(node.id);
    }

    const r = SUBGRAPH_PREVIEW_DOT_RADIUS_PX;
    const pad = SUBGRAPH_PREVIEW_PADDING_PX;
    const positionById = new Map<string, { x: number; y: number }>();
    columns.forEach((column, depth) => {
      column.forEach((id, row) => {
        positionById.set(id, {
          x: pad + r + depth * SUBGRAPH_PREVIEW_COLUMN_GAP_PX,
          y: pad + r + row * SUBGRAPH_PREVIEW_ROW_GAP_PX,
        });
      });
    });

    const columnCount = Math.max(1, columns.length);
    const maxRows = Math.max(1, ...columns.map((column) => column.length));
    let width = pad * 2 + r * 2 + (columnCount - 1) * SUBGRAPH_PREVIEW_COLUMN_GAP_PX;
    const height = pad * 2 + r * 2 + (maxRows - 1) * SUBGRAPH_PREVIEW_ROW_GAP_PX;

    const edgeMarkup = edges
      .map((edge) => {
        const from = positionById.get(edge.from);
        const to = positionById.get(edge.to);
        if (!from || !to) return "";
        return `<line class="sg-edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
      })
      .join("");

    const dotMarkup = nodes
      .map((node) => {
        const position = positionById.get(node.id);
        if (!position) return "";
        const terminalClass = hasOutgoing.has(node.id) ? "" : " sg-dot--terminal";
        return `<circle class="sg-dot${terminalClass}" cx="${position.x}" cy="${position.y}" r="${r}" />`;
      })
      .join("");

    let overflowMarkup = "";
    if (truncated > 0) {
      const textX = width + 2;
      width += SUBGRAPH_PREVIEW_OVERFLOW_LABEL_WIDTH_PX;
      overflowMarkup = `<text class="sg-more" x="${textX}" y="${height / 2 + 3}">+${truncated}</text>`;
    }

    const html = `<svg class="sg-svg" width="${width}" height="${height}" ` + `viewBox="0 0 ${width} ${height}" aria-hidden="true">` + `${edgeMarkup}${dotMarkup}${overflowMarkup}</svg>`;
    return { html, hash };
  }

  /**
   * Build the detailed preview SVG layout for a child graph, mapping node statuses to visual classes.
   *
   * PURPOSE: Lay the child graph out as a tiny flowchart with rectangles colored by their status,
   * showing what the real Mermaid flowchart layout represents without the clutter of tiny text.
   */
  private buildSubgraphDetailedPreview(graph: MermaidRuntime.Graph): { html: string; hash: string } {
    const allEdges = this.resolveGraphEdges(graph);
    // Include status in hash so status changes trigger redraw
    const hash = `${graph.nodes.map((node) => `${node.id}:${node.status}`).join("|")}::${allEdges.map((edge) => `${edge.from}>${edge.to}`).join("|")}`;

    const nodes = graph.nodes.slice(0, SUBGRAPH_PREVIEW_MAX_NODES);
    const truncated = graph.nodes.length - nodes.length;
    const ids = new Set(nodes.map((node) => node.id));
    const edges = allEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));

    const depthById = this.computeGraphDepths(nodes, edges);

    // Group nodes into columns by depth
    const columns: string[][] = [];
    for (const node of nodes) {
      const depth = depthById.get(node.id) ?? 0;
      (columns[depth] ??= []).push(node.id);
    }

    const boxW = 16;
    const boxH = 8;
    const colGap = 24;
    const rowGap = 14;
    const pad = 4;

    const positionById = new Map<string, { x: number; y: number }>();
    columns.forEach((column, depth) => {
      column.forEach((id, row) => {
        positionById.set(id, {
          x: pad + depth * colGap,
          y: pad + row * rowGap,
        });
      });
    });

    const columnCount = Math.max(1, columns.length);
    const maxRows = Math.max(1, ...columns.map((column) => column.length));
    let width = pad * 2 + boxW + (columnCount - 1) * colGap;
    const height = pad * 2 + boxH + (maxRows - 1) * rowGap;

    const edgeMarkup = edges
      .map((edge) => {
        const from = positionById.get(edge.from);
        const to = positionById.get(edge.to);
        if (!from || !to) return "";
        const x1 = from.x + boxW;
        const y1 = from.y + boxH / 2;
        const x2 = to.x;
        const y2 = to.y + boxH / 2;
        return `<line class="sg-detailed-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
      })
      .join("");

    const styles = this.effectiveStatusStyles();
    const boxMarkup = nodes
      .map((node) => {
        const pos = positionById.get(node.id);
        if (!pos) return "";
        const statusClass = styles[node.status]?.className ?? "";
        return `<rect class="sg-detailed-box ${statusClass}" x="${pos.x}" y="${pos.y}" width="${boxW}" height="${boxH}" rx="1.5" ry="1.5" />`;
      })
      .join("");

    let overflowMarkup = "";
    if (truncated > 0) {
      const textX = width + 2;
      width += SUBGRAPH_PREVIEW_OVERFLOW_LABEL_WIDTH_PX;
      overflowMarkup = `<text class="sg-more" x="${textX}" y="${height / 2 + 3}">+${truncated}</text>`;
    }

    const html = `<svg class="sg-svg" width="${width}" height="${height}" ` + `viewBox="0 0 ${width} ${height}" aria-hidden="true">` + `${edgeMarkup}${boxMarkup}${overflowMarkup}</svg>`;

    return { html, hash };
  }

  /**
   * Longest-path depth (column index) for each node in a child graph.
   *
   * VALUE: A topological pass (cycle-safe) that places dependents to the right of
   * their prerequisites, giving the mini-preview a readable left-to-right flow.
   */
  private computeGraphDepths(nodes: readonly MermaidRuntime.Node[], edges: readonly { from: string; to: string }[]): Map<string, number> {
    const depth = new Map<string, number>();
    const indegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) {
      depth.set(node.id, 0);
      indegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      adjacency.get(edge.from)?.push(edge.to);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
    const queue = [...indegree.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const next of adjacency.get(current) ?? []) {
        depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(current) ?? 0) + 1));
        const remaining = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) queue.push(next);
      }
    }
    return depth;
  }

  /** Resolve a child graph's edges (explicit → per-node → dependencies). */
  private resolveGraphEdges(graph: MermaidRuntime.Graph): { from: string; to: string }[] {
    const explicit = graph.transitions ?? [];
    const perNode = graph.nodes.flatMap((node) => node.transitions ?? []);
    const transitions = explicit.length > 0 ? explicit : perNode;
    if (transitions.length > 0) {
      return transitions.map((transition) => ({ from: transition.from, to: transition.to }));
    }
    return graph.nodes.flatMap((node) => (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })));
  }

  // ── Subgraph navigation ────────────────────────────────────────────

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
   * Traverses completed paths and draws animating trace overlays.
   */
  private updatePathAnimations(): void {
    const host = this.hostElement.nativeElement;
    const svgEl = host.querySelector('.mermaid svg');
    if (!svgEl) return;

    let overlayGroup = svgEl.querySelector('.mr-path-animation-overlay-group');

    if (!this.runComplete()) {
      if (overlayGroup) {
        overlayGroup.innerHTML = '';
      }
      return;
    }

    if (overlayGroup) {
      overlayGroup.innerHTML = '';
    } else {
      overlayGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      overlayGroup.setAttribute('class', 'mr-path-animation-overlay-group');
      const innerG = svgEl.querySelector('g.output') || svgEl.querySelector('g') || svgEl;
      innerG.appendChild(overlayGroup);
    }

    const nodes = this.activeNodes();
    const visited = new Set(
      nodes
        .filter((n) => n.status === 'complete' || n.status === 'failed' || n.status === 'skipped')
        .map((n) => n.id)
    );

    if (visited.size === 0) return;

    const { toAlias } = this.aliasMap();
    const transitions = this.resolveEdges();
    const adj = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const t of transitions) {
      if (visited.has(t.from) && visited.has(t.to)) {
        if (!adj.has(t.from)) adj.set(t.from, []);
        adj.get(t.from)!.push(t.to);
        inDegree.set(t.to, (inDegree.get(t.to) || 0) + 1);
      }
    }

    const roots = Array.from(visited).filter((id) => !inDegree.has(id));
    const paths: string[][] = [];
    const currentPath: string[] = [];

    const dfs = (nodeId: string, pathVisited: Set<string>) => {
      if (pathVisited.has(nodeId)) {
        paths.push([...currentPath]);
        return;
      }
      pathVisited.add(nodeId);
      currentPath.push(nodeId);

      const next = adj.get(nodeId) || [];
      if (next.length === 0) {
        paths.push([...currentPath]);
      } else {
        for (const n of next) {
          dfs(n, pathVisited);
        }
      }

      currentPath.pop();
      pathVisited.delete(nodeId);
    };

    for (const root of roots) {
      dfs(root, new Set<string>());
    }

    for (const path of paths) {
      if (path.length === 0) continue;

      let pathD = '';
      let prevEnd: { x: number; y: number } | null = null;

      for (let i = 0; i < path.length - 1; i++) {
        const fromNode = path[i];
        const toNode = path[i + 1];

        const parentAlias = toAlias.get(fromNode);
        const childAlias = toAlias.get(toNode);
        if (!parentAlias || !childAlias) continue;

        const edgeEl = this.findEdgeElement(parentAlias, childAlias);
        if (!edgeEl) continue;

        const pathEl = edgeEl.tagName.toLowerCase() === 'path'
          ? (edgeEl as unknown as SVGPathElement)
          : edgeEl.querySelector('path');

        if (!pathEl) continue;

        const d = pathEl.getAttribute('d') || '';
        const len = pathEl.getTotalLength();
        const pStart = pathEl.getPointAtLength(0);
        const pEnd = pathEl.getPointAtLength(len);

        const cleanD = d.trim().replace(/^M\s*[\d.-]+[\s,]+[\d.-]+/i, '');

        if (pathD === '') {
          pathD = d;
        } else if (prevEnd) {
          pathD += ` L ${pStart.x} ${pStart.y} ${cleanD}`;
        }

        if (i + 1 < path.length - 1) {
          const nextNode = path[i + 2];
          const nextParentAlias = toAlias.get(toNode);
          const nextChildAlias = toAlias.get(nextNode);
          const nextEdgeEl = nextParentAlias && nextChildAlias
            ? this.findEdgeElement(nextParentAlias, nextChildAlias)
            : null;

          const nextPathEl = nextEdgeEl
            ? (nextEdgeEl.tagName.toLowerCase() === 'path'
              ? (nextEdgeEl as unknown as SVGPathElement)
              : nextEdgeEl.querySelector('path'))
            : null;

          if (nextPathEl) {
            const pNextStart = nextPathEl.getPointAtLength(0);
            const nodeEl = this.findNodeElement(toNode);
            if (nodeEl) {
              const bbox = (nodeEl as any).getBBox();
              const transform = nodeEl.getAttribute('transform') || '';
              const m = /translate\(([^,)]+)(?:[\s,]+([^)]+))?\)/.exec(transform);
              const cx = m ? parseFloat(m[1]) : 0;
              const cy = m && m[2] ? parseFloat(m[2]) : 0;
              const nodeBox = { x: cx + bbox.x, y: cy + bbox.y, w: bbox.width, h: bbox.height };

              const offset = 8;
              const yTop = nodeBox.y - offset;
              const xLeft = nodeBox.x - offset;

              const isHorizontal = Math.abs(pNextStart.x - pEnd.x) > Math.abs(pNextStart.y - pEnd.y);

              if (isHorizontal) {
                const cornerX1 = pEnd.x < cx ? nodeBox.x - offset : nodeBox.x + nodeBox.w + offset;
                const cornerY1 = yTop;
                const cornerX2 = pNextStart.x > cx ? nodeBox.x + nodeBox.w + offset : nodeBox.x - offset;
                const cornerY2 = yTop;

                pathD += ` Q ${cornerX1} ${pEnd.y} ${cornerX1} ${cornerY1} L ${cornerX2} ${cornerY2} Q ${cornerX2} ${pNextStart.y} ${pNextStart.x} ${pNextStart.y}`;
              } else {
                const cornerX1 = xLeft;
                const cornerY1 = pEnd.y < cy ? nodeBox.y - offset : nodeBox.y + nodeBox.h + offset;
                const cornerX2 = xLeft;
                const cornerY2 = pNextStart.y > cy ? nodeBox.y + nodeBox.h + offset : nodeBox.y - offset;

                pathD += ` Q ${pEnd.x} ${cornerY1} ${cornerX1} ${cornerY1} L ${cornerX2} ${cornerY2} Q ${pNextStart.x} ${cornerY2} ${pNextStart.x} ${pNextStart.y}`;
              }
              prevEnd = pNextStart;
            }
          }
        } else {
          prevEnd = pEnd;
        }
      }

      if (pathD !== '') {
        const svgPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        svgPath.setAttribute('d', pathD);
        svgPath.setAttribute('class', 'mr-path-flow-line');
        svgPath.setAttribute('pathLength', '100');
        overlayGroup.appendChild(svgPath);
      }
    }
  }
}
