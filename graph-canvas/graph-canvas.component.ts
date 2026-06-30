import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule, MermaidAPI } from 'ngx-markdown';

import { MermaidRuntime } from '../task-graph-model';
import { GraphCameraComponent } from '../../graph-camera/graph-camera.component';

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

/** Query parameter used to encode the real node id in Mermaid click hrefs. */
const NODE_HREF_PARAM = 'node';

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
  running: { className: 'running', label: 'Running' },
  complete: { className: 'done', label: 'Complete' },
  failed: { className: 'failed', label: 'Failed' },
  skipped: { className: 'skipped', label: 'Skipped' },
};

/**
 * CSS class marking the live "current" focus node.
 *
 * VALUE: Kept separate from status classes so the focus highlight and the
 * execution colour are applied and stripped independently.
 */
const CURRENT_NODE_CLASS = 'current';

/**
 * CSS class marking a node the user can drill into (it resolves to a subgraph).
 *
 * VALUE: Lets the stylesheet flag drillable nodes (badge/affordance) without the
 * host having to decorate them.
 */
const HAS_SUBGRAPH_CLASS = 'has-subgraph';

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
 * Default Mermaid render configuration for the task graph.
 *
 * Value: Dark theme to match the app, `loose` security so click hrefs render
 * as anchors we can intercept, and a smooth flowchart curve.
 */
const DEFAULT_MERMAID_OPTIONS: MermaidAPI.MermaidConfig = {
  theme: 'dark',
  startOnLoad: true,
  securityLevel: 'loose',
  flowchart: {
    // The camera owns sizing/zoom. `useMaxWidth: false` gives the SVG a fixed
    // intrinsic size so a re-render (status change) never re-fits it to the
    // container and fights the current zoom — text stays the right size.
    useMaxWidth: false,
    htmlLabels: true,
    curve: 'basis',
  },
};

/**
 * Interactive Mermaid graph canvas — the rendering + interaction core.
 *
 * PURPOSE: Render any `MermaidRuntime.Node[]` (+ transitions) as a status-coloured,
 * clickable flowchart inside a pan/zoom camera, with progress bars, follow, and
 * nested-subgraph navigation. It owns selection/navigation state and exposes it,
 * but renders no inspector or toolbar chrome itself.
 *
 * VALUE: The reusable product surface. A host projects its own chrome through the
 * `[overlay]` and `[detail]` slots and binds it to the canvas's exposed signals
 * (e.g. `selectedNode`, `selectedNodeHasSubgraph`) via a template ref — so every
 * project arranges its own layout while the interaction behaviour is shared.
 */
@Component({
  selector: 'app-graph-canvas',
  templateUrl: './graph-canvas.component.html',
  styleUrl: './graph-canvas.component.scss',
  host: { class: 'app-graph-canvas' },
  imports: [CommonModule, MarkdownModule, GraphCameraComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphCanvasComponent {
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cameraRef = viewChild.required(GraphCameraComponent);

  /** Execution nodes to render. The host owns their lifecycle and status. */
  readonly nodes = input.required<MermaidRuntime.Node[]>();

  /**
   * Runtime/story edges. When omitted, edges fall back to per-node
   * `transitions`, then to `dependencies` so a dependency-only graph still draws.
   */
  readonly transitions = input<MermaidRuntime.Transition[] | null>(null);

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
  readonly rootLabel = input<string>('Main');

  /** Whether to render the breadcrumb overlay while inside a subgraph. */
  readonly showBreadcrumb = input<boolean>(true);

  /**
   * Whether drillable nodes show a small, static thumbnail of their child graph.
   *
   * VALUE: A purely decorative hint that a node contains a subgraph (and its
   * rough shape); set false to drop it entirely with no other behaviour change.
   */
  readonly showSubgraphPreview = input<boolean>(true);

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
  readonly subgraphResolver = input<
    ((node: MermaidRuntime.Node) => MermaidRuntime.Graph | null) | null
  >(null);

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
    return top ? top.graph.transitions ?? null : this.transitions();
  });

  /** True while inside a subgraph (the stack is non-empty). */
  protected readonly inSubgraph = computed(() => this.graphStack().length > 0);

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

  protected readonly flowMarkdown = computed(() => `\`\`\`mermaid\n${this.buildGraph()}\n\`\`\``);

  protected readonly effectiveSelectedNodeId = computed(() => {
    const nodes = this.activeNodes();
    return (
      this.selectedNodeId() ??
      this.internalSelectedNodeId() ??
      this.currentNodeId() ??
      nodes.find((node) => node.status === 'running')?.id ??
      nodes[0]?.id ??
      null
    );
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

  /** Ids of the currently running nodes, joined — drives follow re-framing. */
  private readonly runningKey = computed(() =>
    this.activeNodes()
      .filter((node) => node.status === 'running')
      .map((node) => node.id)
      .join(','),
  );

  /** Joined `id:status` pairs — drives live status-class application (no re-render). */
  private readonly statusKey = computed(() =>
    this.activeNodes()
      .map((node) => `${node.id}:${node.status}`)
      .join(','),
  );

  /** Joined node progress values — drives live progress-bar DOM updates. */
  private readonly progressKey = computed(() =>
    this.activeNodes()
      .map((node) => `${node.id}:${node.progressPercent ?? ''}:${node.progressLabel ?? ''}`)
      .join(','),
  );

  /** Follow temporarily suspended after a manual pan/zoom. */
  protected readonly followPaused = signal(false);

  /** Follow is on and not paused — the camera should track the running nodes. */
  protected readonly followActive = computed(() => this.followExecution() && !this.followPaused());

  /** Whether to offer the "re-center" chip (follow on, but paused by the user). */
  protected readonly showRecenterChip = computed(
    () => this.followExecution() && this.followPaused(),
  );

  /** True once the first Mermaid node has rendered, so we fit the view once. */
  private hasFitInitialView = false;

  /** Last seen `followExecution` value, to detect off→on (which resumes follow). */
  private lastFollowOn = false;

  /** A follow re-frame is already queued for the next frame (coalesces bursts). */
  private followFramePending = false;

  constructor() {
    const host = this.hostElement.nativeElement;
    const clickListener = (event: MouseEvent) => this.handleChartClick(event);
    const dblClickListener = (event: MouseEvent) => this.handleChartDblClick(event);
    const chartObserver = new MutationObserver(() => this.onChartMutation());
    host.addEventListener('click', clickListener, true);
    host.addEventListener('dblclick', dblClickListener, true);
    chartObserver.observe(host, { childList: true, subtree: true });
    this.destroyRef.onDestroy(() => {
      host.removeEventListener('click', clickListener, true);
      host.removeEventListener('dblclick', dblClickListener, true);
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

    // Re-apply the inline subgraph thumbnails when the toggle flips or the active
    // level changes. A structural re-render already re-applies them via
    // `onChartMutation`; this covers the false→true toggle (no re-render fires).
    effect(() => {
      this.showSubgraphPreview();
      this.graphStack();
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
      'flowchart TD',
      ...nodes.map((node) =>
        this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id]),
      ),
      '',
      ...this.buildEdgeLines(aliasFor),
      '',
      ...nodes.map((node) => this.buildNodeClickLine(node, toAlias.get(node.id) ?? node.id)),
      '',
      `  class ${nodes.map((node) => toAlias.get(node.id)).join(',')} clickable;`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildNodeDefinitionLine(
    node: MermaidRuntime.Node,
    alias: string,
    decoration: MermaidRuntime.NodeDecoration | undefined,
  ): string {
    const title = this.buildNodeLabel(decoration?.displayTitle ?? node.title);
    return decoration?.shape === 'diamond' ? `  ${alias}{"${title}"}` : `  ${alias}["${title}"]`;
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
    if (
      progressPercent === null ||
      progressPercent === undefined ||
      !Number.isFinite(progressPercent)
    ) {
      return null;
    }
    return Math.max(
      TASK_GRAPH_PROGRESS_MIN_PERCENT,
      Math.min(TASK_GRAPH_PROGRESS_MAX_PERCENT, Math.round(progressPercent)),
    );
  }

  private buildEdgeLines(aliasFor: (id: string) => string | undefined): string[] {
    return this.resolveEdges()
      .map((edge) => {
        const from = aliasFor(edge.from);
        const to = aliasFor(edge.to);
        if (!from || !to) return null;
        return edge.label
          ? `  ${from} -->|${this.escapeMermaidString(edge.label)}| ${to}`
          : `  ${from} --> ${to}`;
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
    return nodes.flatMap((node) =>
      (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })),
    );
  }

  private buildNodeClickLine(node: MermaidRuntime.Node, alias: string): string {
    const tooltip = this.escapeMermaidString(`View ${node.title}`);
    return `  click ${alias} "?${NODE_HREF_PARAM}=${encodeURIComponent(node.id)}" "${tooltip}"`;
  }

  private escapeMermaidString(value: string): string {
    return value.replace(/"/g, '\\"');
  }

  private onChartMutation(): void {
    this.applySelectedNodeClass(this.effectiveSelectedNodeId());
    if (!this.hostElement.nativeElement.querySelector('.mermaid .node')) return;
    // A structural re-render produces fresh, class-less nodes; re-apply status.
    this.applyStatusClasses();
    this.applySubgraphPreviews();
    this.applyNodeProgressBars();

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

  /** Called by the camera when the user manually pans/zooms — pauses follow. */
  protected onUserInteract(): void {
    if (this.followExecution()) this.followPaused.set(true);
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
    return nodes.find((node) => node.status === 'running')?.id ?? null;
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
    const link = (Array.from(host.querySelectorAll('.mermaid a')) as Element[]).find(
      (linkElement) => this.readNodeIdFromLink(linkElement) === nodeId,
    );
    if (!link) return null;
    // This Mermaid build wraps the node group inside the click `<a>`, so `.node`
    // is a descendant; fall back to an ancestor for other builds.
    return link.querySelector('.node') ?? link.closest('.node');
  }

  private handleChartClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;

    const linkElement = target.closest('a');
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
    const linkElement = target.closest('a');
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) return;
    const node = this.activeNodes().find((candidate) => candidate.id === nodeId);
    if (!node || !this.resolveSubgraph(node)) return;
    event.preventDefault();
    event.stopPropagation();
    this.enterSubgraph(node);
  }

  private readNodeIdFromLink(linkElement: Element): string | null {
    const href = linkElement.getAttribute('href') ?? linkElement.getAttribute('xlink:href');
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
    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      element.classList.remove(...stripClasses);
      const statusClass = styles[node.status]?.className;
      if (statusClass) element.classList.add(statusClass);
      if (node.id === currentId) element.classList.add(CURRENT_NODE_CLASS);
      if (this.resolveSubgraph(node)) element.classList.add(HAS_SUBGRAPH_CLASS);
    }
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
      const label = element?.querySelector('.nodeLabel') ?? element?.querySelector('span');
      if (!element || !label) continue;

      let progressWrap = element.querySelector('.task-graph-node-progress-wrap');
      if (!progressWrap) {
        progressWrap = document.createElement('div');
        progressWrap.classList.add('task-graph-node-progress-wrap');

        const progressElement = document.createElement('progress');
        progressElement.classList.add('task-graph-node-progress');
        progressElement.value = TASK_GRAPH_PROGRESS_MIN_PERCENT;
        progressElement.max = TASK_GRAPH_PROGRESS_MAX_PERCENT;

        const progressText = document.createElement('small');
        progressWrap.append(progressElement, progressText);
        label.append(progressWrap);
      }

      const progressPercent = this.readNodeProgressPercent(node.progressPercent);
      progressWrap.classList.toggle('has-progress', progressPercent !== null);

      const progressElement = progressWrap.querySelector('progress');
      if (progressElement instanceof HTMLProgressElement) {
        progressElement.value = progressPercent ?? TASK_GRAPH_PROGRESS_MIN_PERCENT;
        progressElement.max = TASK_GRAPH_PROGRESS_MAX_PERCENT;
      }

      const progressText = progressWrap.querySelector('small');
      // Only write when the text actually changes. Writing a non-empty
      // `textContent` replaces the child text node, which is a childList
      // mutation inside the subtree the host MutationObserver watches — an
      // unconditional write would re-trigger `onChartMutation` → this method in
      // an unbounded loop that freezes the page.
      if (progressText) {
        const nextText = progressPercent === null ? '' : `${progressPercent}%`;
        if (progressText.textContent !== nextText) progressText.textContent = nextText;
      }
    }
  }

  private applySelectedNodeClass(selectedId: string | null): void {
    const host = this.hostElement.nativeElement;
    for (const nodeElement of host.querySelectorAll('.mermaid .node.selected')) {
      nodeElement.classList.remove('selected');
    }
    if (!selectedId) return;

    const selectedLink = (Array.from(host.querySelectorAll('.mermaid a')) as Element[]).find(
      (linkElement) => this.readNodeIdFromLink(linkElement) === selectedId,
    );
    const selectedNode = selectedLink?.querySelector('.node') ?? selectedLink?.closest('.node');
    selectedNode?.classList.add('selected');
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
    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      const label = element?.querySelector('.nodeLabel') ?? element?.querySelector('span');
      if (!element || !label) continue;

      const existing = label.querySelector('.task-graph-node-subgraph-preview');
      const graph = this.resolveSubgraph(node);
      if (!graph) {
        existing?.remove();
        continue;
      }

      const { html, hash } = this.buildSubgraphPreview(graph);
      if (existing instanceof HTMLElement) {
        // Skip the DOM write when the structure is unchanged — an unconditional
        // write would be a childList mutation that re-triggers `onChartMutation`.
        if (existing.dataset['sgHash'] === hash) continue;
        existing.innerHTML = html;
        existing.dataset['sgHash'] = hash;
      } else {
        const wrap = document.createElement('div');
        wrap.classList.add('task-graph-node-subgraph-preview');
        wrap.dataset['sgHash'] = hash;
        wrap.innerHTML = html;
        label.append(wrap);
      }
    }
  }

  /** Strip every injected subgraph thumbnail (toggle off). */
  private removeSubgraphPreviews(): void {
    for (const preview of this.hostElement.nativeElement.querySelectorAll(
      '.task-graph-node-subgraph-preview',
    )) {
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
    const hash = `${graph.nodes.map((node) => node.id).join('|')}::${allEdges
      .map((edge) => `${edge.from}>${edge.to}`)
      .join('|')}`;

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
        if (!from || !to) return '';
        return `<line class="sg-edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
      })
      .join('');

    const dotMarkup = nodes
      .map((node) => {
        const position = positionById.get(node.id);
        if (!position) return '';
        const terminalClass = hasOutgoing.has(node.id) ? '' : ' sg-dot--terminal';
        return `<circle class="sg-dot${terminalClass}" cx="${position.x}" cy="${position.y}" r="${r}" />`;
      })
      .join('');

    let overflowMarkup = '';
    if (truncated > 0) {
      const textX = width + 2;
      width += SUBGRAPH_PREVIEW_OVERFLOW_LABEL_WIDTH_PX;
      overflowMarkup = `<text class="sg-more" x="${textX}" y="${height / 2 + 3}">+${truncated}</text>`;
    }

    const html =
      `<svg class="sg-svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
      `${edgeMarkup}${dotMarkup}${overflowMarkup}</svg>`;
    return { html, hash };
  }

  /**
   * Longest-path depth (column index) for each node in a child graph.
   *
   * VALUE: A topological pass (cycle-safe) that places dependents to the right of
   * their prerequisites, giving the mini-preview a readable left-to-right flow.
   */
  private computeGraphDepths(
    nodes: readonly MermaidRuntime.Node[],
    edges: readonly { from: string; to: string }[],
  ): Map<string, number> {
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
    return graph.nodes.flatMap((node) =>
      (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })),
    );
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
    this.onNavigated(next, 'enter');
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
    this.onNavigated(next, 'leave');
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
  private onNavigated(stack: GraphFrame[], direction: 'enter' | 'leave'): void {
    this.internalSelectedNodeId.set(null);
    this.hasFitInitialView = false;
    const top = stack[stack.length - 1] ?? null;
    const path = stack.map((frame) => frame.nodeId);
    const event: SubgraphNavEvent = {
      path,
      nodeId: top?.nodeId ?? null,
      label: top?.label ?? null,
    };
    if (direction === 'enter') this.subgraphEntered.emit(event);
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
}
