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
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarkdownModule, MermaidAPI } from 'ngx-markdown';

import { TaskGraphModel } from './task-graph-model';
import { LocalDaemonService } from '@app/core/services/daemon/local-daemon.service';
import { GraphCameraComponent } from '../graph-camera/graph-camera.component';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * Per-node visual override supplied by the host.
 *
 * Value: Re-exported from the viewer's self-owned model so existing consumers
 * keep importing `TaskGraphNodeDecoration` from this component while the canonical
 * definition lives in `TaskGraphModel` (the extractable library surface).
 */
export type TaskGraphNodeDecoration = TaskGraphModel.NodeDecoration;

/** A directed graph edge, from one node id to another, with an optional label. */
interface TaskGraphEdge {
  from: string;
  to: string;
  label?: string;
}

/** Maps real node ids to Mermaid-safe aliases and back. */
interface TaskGraphAliasMap {
  toAlias: Map<string, string>;
  toReal: Map<string, string>;
}

/**
 * Ref group rendered in the selected-node inspector.
 *
 * Value: Keeps the template generic while each node can publish inputs,
 * outputs, context, logs, and artifacts through separate fields.
 */
interface TaskGraphRefGroup {
  title: string;
  kind: TaskGraphModel.InspectableRefKind;
  refs: TaskGraphModel.InspectableRef[];
}

/**
 * Ref currently selected for preview.
 *
 * Value: Couples the clicked ref to its node so repeated ref ids on different
 * nodes cannot highlight or preview the wrong evidence.
 */
interface SelectedTaskGraphRef {
  nodeId: string;
  refKind: TaskGraphModel.InspectableRefKind;
  ref: TaskGraphModel.InspectableRef;
}

/** Query parameter used to encode the real node id in Mermaid click hrefs. */
const NODE_HREF_PARAM = 'node';

/**
 * Maps an execution status to the CSS class applied to its live `.node` element.
 *
 * PURPOSE: Keep execution-state styling out of the Mermaid source.
 *
 * VALUE: Status changes update the rendered DOM in place, so Mermaid does not
 * tear down and rebuild the SVG for every running/done/failed transition.
 */
const STATUS_CLASS_BY_STATUS: Partial<
  Record<TaskGraphModel.NodeStatus, string>
> = {
  complete: 'done',
  failed: 'failed',
  skipped: 'skipped',
  running: 'running',
};

/**
 * Status/current classes removed before each status re-application.
 *
 * PURPOSE: Make status styling idempotent after every graph update.
 *
 * VALUE: Stale visual state never sticks to a node after its execution status
 * changes.
 */
const ALL_STATUS_CLASSES = ['done', 'failed', 'skipped', 'running', 'current'] as const;

/**
 * Zoom cap when follow-execution frames the running nodes.
 *
 * Value: Keeps the camera from snapping uncomfortably close to one or two
 * nodes — "not too far, not too close" — while `frameRect` padding handles the
 * lower bound for larger running sets.
 */
const FOLLOW_MAX_ZOOM = 1.4;

/**
 * JSON indentation used in node-ref previews.
 *
 * Value: Structured context snapshots stay readable in the compact inspector
 * without hiding a bare formatting number.
 */
const TASK_RUN_REF_JSON_INDENT_SPACES = 2;

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
 * Generic, reusable Mermaid task-graph viewer with camera navigation.
 *
 * PURPOSE: Render any `TaskRunNode[]` (+ transitions) as a status-coloured,
 * clickable flowchart inside a pan/zoom camera, emitting node selection. Knows
 * the task-run model but nothing about any specific task (daemon-agent,
 * copy-cat, Meowney) — those are thin hosts that map their domain in.
 *
 * VALUE: Replaces the daemon-agent-specific flow panel's rendering with a
 * shared component, so every task graph gets the same navigation, colouring,
 * and selection behaviour for free.
 */
@Component({
  selector: 'app-task-graph',
  templateUrl: './task-graph.component.html',
  styleUrl: './task-graph.component.scss',
  host: { class: 'app-task-graph' },
  imports: [CommonModule, MarkdownModule, GraphCameraComponent, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskGraphComponent {
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly daemonService = inject(LocalDaemonService);
  private readonly cameraRef = viewChild.required(GraphCameraComponent);

  /** Execution nodes to render. The host owns their lifecycle and status. */
  readonly nodes = input.required<TaskGraphModel.Node[]>();

  /**
   * Runtime/story edges. When omitted, edges fall back to per-node
   * `transitions`, then to `dependencies` so a dependency-only graph still draws.
   */
  readonly transitions = input<TaskGraphModel.Transition[] | null>(null);

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
   * When true, the camera keeps the running ("green") nodes framed as the run
   * progresses. A manual pan/zoom pauses it until the host re-enables follow or
   * the user clicks the re-center chip.
   */
  readonly followExecution = input<boolean>(false);

  /** Emits the real node id when a node is clicked. */
  readonly nodeSelected = output<string>();

  protected readonly mermaidOptions = DEFAULT_MERMAID_OPTIONS;

  private readonly internalSelectedNodeId = signal<string | null>(null);

  private readonly aliasMap = computed<TaskGraphAliasMap>(() => this.buildAliasMap(this.nodes()));

  protected readonly copiedNodeId = signal<string | null>(null);

  protected copyNodeForAgent(node: TaskGraphModel.Node): void {
    const lines: string[] = [];
    const runId = this.runId();
    if (runId) {
      lines.push(`Run ID: ${runId}`);
    }
    lines.push(`Node: ${node.title} (${node.id})`);
    lines.push(`Status: ${node.status}`);
    if (node.progressPercent != null || node.progressLabel) {
      const pct = node.progressPercent != null ? `${node.progressPercent}%` : '';
      const label = node.progressLabel || '';
      lines.push(`Progress: ${label}${pct ? ` (${pct})` : ''}`);
    }
    if (node.detail) {
      lines.push(`Detail: ${node.detail}`);
    }
    if (node.error) {
      lines.push(`Error: ${node.error}`);
    }
    const text = lines.join('\n');
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.copiedNodeId.set(node.id);
        setTimeout(() => {
          if (this.copiedNodeId() === node.id) {
            this.copiedNodeId.set(null);
          }
        }, 2000);
      });
    }
  }

  protected readonly flowMarkdown = computed(() => `\`\`\`mermaid\n${this.buildGraph()}\n\`\`\``);

  protected readonly effectiveSelectedNodeId = computed(() => {
    return (
      this.selectedNodeId() ??
      this.internalSelectedNodeId() ??
      this.currentNodeId() ??
      this.nodes().find((node) => node.status === 'running')?.id ??
      this.nodes()[0]?.id ??
      null
    );
  });

  protected readonly selectedNode = computed(() => {
    const selectedId = this.effectiveSelectedNodeId();
    if (!selectedId) return null;
    return this.nodes().find((node) => node.id === selectedId) ?? null;
  });

  protected readonly selectedNodeRefGroups = computed(() => {
    const node = this.selectedNode();
    if (!node) return [];
    return this.buildRefGroups(node);
  });

  protected readonly selectedRef = signal<SelectedTaskGraphRef | null>(null);

  protected readonly selectedRefContent = signal<TaskGraphModel.RefContent | null>(null);

  protected readonly selectedRefLoading = signal(false);

  protected readonly selectedRefError = signal<string | null>(null);

  protected readonly selectedRefDisplayText = computed(() => {
    const content = this.selectedRefContent();
    return content ? this.formatTaskRunRefContent(content) : '';
  });

  /** Ids of the currently running nodes, joined — drives follow re-framing. */
  private readonly runningKey = computed(() =>
    this.nodes()
      .filter((node) => node.status === 'running')
      .map((node) => node.id)
      .join(','),
  );

  /** Joined `id:status` pairs — drives live status-class application (no re-render). */
  private readonly statusKey = computed(() =>
    this.nodes()
      .map((node) => `${node.id}:${node.status}`)
      .join(','),
  );

  /** Joined node progress values — drives live progress-bar DOM updates. */
  private readonly progressKey = computed(() =>
    this.nodes()
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
    const chartObserver = new MutationObserver(() => this.onChartMutation());
    host.addEventListener('click', clickListener, true);
    chartObserver.observe(host, { childList: true, subtree: true });
    this.destroyRef.onDestroy(() => {
      host.removeEventListener('click', clickListener, true);
      chartObserver.disconnect();
    });

    effect(() => this.scheduleSelectedNodeClass(this.effectiveSelectedNodeId()));

    // Status colouring and the "current" highlight live as DOM classes on the
    // rendered nodes, applied whenever a status or the current focus changes.
    // Because this never touches the Mermaid source, the SVG is not re-rendered.
    effect(() => {
      this.statusKey();
      this.currentNodeId();
      this.scheduleStatusClasses();
    });

    effect(() => {
      this.progressKey();
      this.scheduleNodeProgressBars();
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

  private buildAliasMap(nodes: readonly TaskGraphModel.Node[]): TaskGraphAliasMap {
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
    const nodes = this.nodes();
    const { toAlias } = this.aliasMap();
    const decorations = this.decorations();
    const aliasFor = (id: string): string | undefined => toAlias.get(id);

    return [
      'flowchart TD',
      ...nodes.map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id])),
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
    node: TaskGraphModel.Node,
    alias: string,
    decoration: TaskGraphNodeDecoration | undefined,
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
    if (progressPercent === null || progressPercent === undefined || !Number.isFinite(progressPercent)) {
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
  private resolveEdges(): TaskGraphEdge[] {
    const explicit = this.transitions() ?? [];
    const perNode = this.nodes().flatMap((node) => node.transitions ?? []);
    const transitions = explicit.length > 0 ? explicit : perNode;
    if (transitions.length > 0) {
      return transitions.map((transition) => ({
        from: transition.from,
        to: transition.to,
        label: transition.label ?? undefined,
      }));
    }
    return this.nodes().flatMap((node) =>
      (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })),
    );
  }

  private buildNodeClickLine(node: TaskGraphModel.Node, alias: string): string {
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
    this.applyNodeProgressBars();

    if (this.followActive()) {
      // First render (or a re-render) with follow on: frame the active node.
      this.requestFrameActiveNode();
    } else if (!this.hasFitInitialView) {
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
    return (
      this.currentNodeId() ??
      this.nodes().find((node) => node.status === 'running')?.id ??
      null
    );
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
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const linkElement = target.closest('a');
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) return;

    event.preventDefault();
    event.stopPropagation();
    this.internalSelectedNodeId.set(nodeId);
    this.clearSelectedRef();
    this.nodeSelected.emit(nodeId);
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
    for (const node of this.nodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      element.classList.remove(...ALL_STATUS_CLASSES);
      const statusClass = STATUS_CLASS_BY_STATUS[node.status];
      if (statusClass) element.classList.add(statusClass);
      if (node.id === currentId) element.classList.add('current');
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
    for (const node of this.nodes()) {
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

  /**
   * Build non-empty ref groups for the selected node.
   *
   * PURPOSE: Present all evidence types through one inspector path while keeping
   * the persisted node shape separated by ref purpose.
   *
   * VALUE: Any task that publishes refs gets clickable inputs, outputs, context,
   * logs, and artifacts without a task-specific component.
   */
  private buildRefGroups(node: TaskGraphModel.Node): TaskGraphRefGroup[] {
    const groups: TaskGraphRefGroup[] = [
      { title: 'Inputs', kind: 'input', refs: node.inputRefs ?? [] },
      { title: 'Outputs', kind: 'output', refs: node.outputRefs ?? [] },
      { title: 'Context', kind: 'context', refs: node.contextRefs ?? [] },
      { title: 'Logs', kind: 'log', refs: node.logRefs ?? [] },
      { title: 'Artifacts', kind: 'artifact', refs: node.artifactRefs ?? [] },
    ];
    return groups.filter((group) => group.refs.length > 0);
  }

  /**
   * Load a clicked node ref through the local daemon preview route.
   *
   * PURPOSE: Turn published node refs into inspectable evidence without exposing
   * arbitrary local paths in browser requests.
   *
   * VALUE: Inputs, outputs, context, logs, and artifacts become reviewable from
   * the same reusable graph component that shows node status.
   */
  protected openNodeRef(
    nodeId: string,
    refKind: TaskGraphModel.InspectableRefKind,
    ref: TaskGraphModel.InspectableRef,
  ): void {
    const runId = this.runId();
    this.selectedRef.set({ nodeId, refKind, ref });
    this.selectedRefContent.set(null);
    this.selectedRefError.set(null);

    if (!runId) {
      this.selectedRefError.set('No task run id is available for this ref.');
      return;
    }

    this.selectedRefLoading.set(true);
    this.daemonService
      .getTaskRunRef(runId, nodeId, refKind, ref.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (content) => {
          if (!this.isSelectedRef(nodeId, refKind, ref.id)) return;
          this.selectedRefContent.set(content);
          this.selectedRefLoading.set(false);
        },
        error: (error: unknown) => {
          if (!this.isSelectedRef(nodeId, refKind, ref.id)) return;
          this.selectedRefError.set(error instanceof Error ? error.message : 'Could not load this ref.');
          this.selectedRefLoading.set(false);
        },
      });
  }

  /**
   * Check whether a ref row is currently selected.
   *
   * PURPOSE: Keep row highlighting aligned with the preview block.
   *
   * VALUE: The Human can see exactly which published ref produced the visible
   * content below the node details.
   */
  protected isSelectedRef(
    nodeId: string,
    refKind: TaskGraphModel.InspectableRefKind,
    refId: string,
  ): boolean {
    const selected = this.selectedRef();
    return selected?.nodeId === nodeId && selected.refKind === refKind && selected.ref.id === refId;
  }

  /**
   * Read a concise label from any task-run ref.
   *
   * PURPOSE: Normalize data, log, and artifact refs for compact row rendering.
   *
   * VALUE: The template stays readable while preserving each ref's original shape.
   */
  protected readRefLabel(ref: TaskGraphModel.InspectableRef): string {
    return 'label' in ref && ref.label ? ref.label : ref.id;
  }

  /**
   * Read the main summary line from any task-run ref.
   *
   * PURPOSE: Prefer human-authored summaries and fall back to the stored path or event id.
   *
   * VALUE: Ref rows remain useful even when a task only publishes a file pointer.
   */
  protected readRefSummary(ref: TaskGraphModel.InspectableRef): string {
    const pathValue = this.readRefPath(ref);
    return ref.summary || pathValue || ('eventId' in ref && ref.eventId ? ref.eventId : '');
  }

  /**
   * Read the path display value from any task-run ref.
   *
   * PURPOSE: Hide optional-path branching from the template.
   *
   * VALUE: Event-only refs can render without showing an empty path row.
   */
  protected readRefPath(ref: TaskGraphModel.InspectableRef): string | null {
    return 'path' in ref && typeof ref.path === 'string' && ref.path.trim().length > 0 ? ref.path : null;
  }

  /**
   * Format loaded ref content for display.
   *
   * PURPOSE: Pretty-print JSON snapshots while leaving logs and text artifacts untouched.
   *
   * VALUE: Structured node context is easier to inspect without changing how refs are stored.
   */
  private formatTaskRunRefContent(content: TaskGraphModel.RefContent): string {
    if (content.contentType !== 'application/json') {
      return content.content;
    }

    try {
      return JSON.stringify(JSON.parse(content.content), null, TASK_RUN_REF_JSON_INDENT_SPACES);
    } catch {
      return content.content;
    }
  }

  /**
   * Clear the current ref preview when the selected node changes.
   *
   * PURPOSE: Avoid showing stale evidence for a node that is no longer selected.
   *
   * VALUE: The side panel always reads as one coherent node inspection.
   */
  private clearSelectedRef(): void {
    this.selectedRef.set(null);
    this.selectedRefContent.set(null);
    this.selectedRefLoading.set(false);
    this.selectedRefError.set(null);
  }
}
