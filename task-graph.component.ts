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

import { DaxurDaemonAPI } from '@daxur-daemon-api/daxur-daemon-api';
import { LocalDaemonService } from '@app/core/services/daemon/local-daemon.service';
import { GraphCameraComponent } from '../graph-camera/graph-camera.component';

/**
 * Per-node visual override supplied by the host.
 *
 * Value: Lets a caller relabel a node or render it as a decision diamond
 * without polluting the execution model (`TaskRunNode`) with view concerns.
 */
export interface TaskGraphNodeDecoration {
  displayTitle?: string;
  shape?: 'rect' | 'diamond';
}

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
  kind: DaxurDaemonAPI.TaskRunInspectableRefKind;
  refs: DaxurDaemonAPI.TaskRunInspectableRef[];
}

/**
 * Ref currently selected for preview.
 *
 * Value: Couples the clicked ref to its node so repeated ref ids on different
 * nodes cannot highlight or preview the wrong evidence.
 */
interface SelectedTaskGraphRef {
  nodeId: string;
  refKind: DaxurDaemonAPI.TaskRunInspectableRefKind;
  ref: DaxurDaemonAPI.TaskRunInspectableRef;
}

/** Query parameter used to encode the real node id in Mermaid click hrefs. */
const NODE_HREF_PARAM = 'node';

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
  imports: [CommonModule, MarkdownModule, GraphCameraComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskGraphComponent {
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly daemonService = inject(LocalDaemonService);
  private readonly cameraRef = viewChild.required(GraphCameraComponent);

  /** Execution nodes to render. The host owns their lifecycle and status. */
  readonly nodes = input.required<DaxurDaemonAPI.TaskRunNode[]>();

  /**
   * Runtime/story edges. When omitted, edges fall back to per-node
   * `transitions`, then to `dependencies` so a dependency-only graph still draws.
   */
  readonly transitions = input<DaxurDaemonAPI.TaskRunTransition[] | null>(null);

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

  protected readonly selectedRefContent = signal<DaxurDaemonAPI.TaskRunRefContent | null>(null);

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

  /** Set when the running set changes; cleared once the camera has re-framed. */
  private followFrameRequested = false;

  /** Pending rAF handle for a follow re-frame, so we coalesce rapid changes. */
  private followFrameHandle: number | null = null;

  /** Last seen `followExecution` value, to detect off→on (which resumes follow). */
  private lastFollowOn = false;

  constructor() {
    const host = this.hostElement.nativeElement;
    const clickListener = (event: MouseEvent) => this.handleChartClick(event);
    const chartObserver = new MutationObserver(() => this.onChartMutation());
    host.addEventListener('click', clickListener, true);
    chartObserver.observe(host, { childList: true, subtree: true });
    this.destroyRef.onDestroy(() => {
      host.removeEventListener('click', clickListener, true);
      chartObserver.disconnect();
      if (this.followFrameHandle !== null) cancelAnimationFrame(this.followFrameHandle);
    });

    effect(() => this.scheduleSelectedNodeClass(this.effectiveSelectedNodeId()));

    // Re-frame whenever follow toggles, the pause clears, or the running set
    // changes. All signal writes/measurements happen later in the rAF callback,
    // outside this reactive context.
    effect(() => {
      this.followExecution();
      this.followPaused();
      this.runningKey();
      this.requestFollowFrame();
    });
  }

  private buildAliasMap(nodes: readonly DaxurDaemonAPI.TaskRunNode[]): TaskGraphAliasMap {
    const toAlias = new Map<string, string>();
    const toReal = new Map<string, string>();
    nodes.forEach((node, index) => {
      const alias = `tg${index}`;
      toAlias.set(node.id, alias);
      toReal.set(alias, node.id);
    });
    return { toAlias, toReal };
  }

  private buildGraph(): string {
    const nodes = this.nodes();
    const { toAlias } = this.aliasMap();
    const decorations = this.decorations();
    const aliasFor = (id: string): string | undefined => toAlias.get(id);

    const statusAliases = (status: DaxurDaemonAPI.TaskRunNodeStatus): string[] =>
      nodes.filter((node) => node.status === status).map((node) => toAlias.get(node.id) ?? '');

    const currentId = this.currentNodeId();
    const currentAlias = currentId ? aliasFor(currentId) : undefined;

    return [
      'flowchart TD',
      ...nodes.map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id])),
      '',
      ...this.buildEdgeLines(aliasFor),
      '',
      ...nodes.map((node) => this.buildNodeClickLine(node, toAlias.get(node.id) ?? node.id)),
      '',
      `  class ${nodes.map((node) => toAlias.get(node.id)).join(',')} clickable;`,
      this.buildStatusClassLine(statusAliases('complete'), 'done'),
      this.buildStatusClassLine(statusAliases('failed'), 'failed'),
      this.buildStatusClassLine(statusAliases('skipped'), 'skipped'),
      this.buildStatusClassLine(statusAliases('running'), 'running'),
      currentAlias ? `  class ${currentAlias} current;` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildNodeDefinitionLine(
    node: DaxurDaemonAPI.TaskRunNode,
    alias: string,
    decoration: TaskGraphNodeDecoration | undefined,
  ): string {
    const title = this.escapeMermaidString(decoration?.displayTitle ?? node.title);
    return decoration?.shape === 'diamond' ? `  ${alias}{"${title}"}` : `  ${alias}["${title}"]`;
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

  private buildNodeClickLine(node: DaxurDaemonAPI.TaskRunNode, alias: string): string {
    const tooltip = this.escapeMermaidString(`View ${node.title}`);
    return `  click ${alias} "?${NODE_HREF_PARAM}=${encodeURIComponent(node.id)}" "${tooltip}"`;
  }

  private buildStatusClassLine(aliases: string[], className: string): string {
    const present = aliases.filter(Boolean);
    return present.length > 0 ? `  class ${present.join(',')} ${className};` : '';
  }

  private escapeMermaidString(value: string): string {
    return value.replace(/"/g, '\\"');
  }

  private onChartMutation(): void {
    this.applySelectedNodeClass(this.effectiveSelectedNodeId());
    if (!this.hostElement.nativeElement.querySelector('.mermaid .node')) return;

    // A re-render after a status change is the moment the new running nodes
    // exist in the DOM, so honour any pending follow re-frame here first.
    if (this.followActive() && this.followFrameRequested) {
      this.hasFitInitialView = true;
      this.tryFollowFrame();
      return;
    }

    if (!this.hasFitInitialView) {
      this.hasFitInitialView = true;
      requestAnimationFrame(() => (this.followActive() ? this.tryFollowFrame() : this.cameraRef().fitAll()));
    }
  }

  /** Called by the camera when the user manually pans/zooms — pauses follow. */
  protected onUserInteract(): void {
    if (this.followExecution()) this.followPaused.set(true);
  }

  /** Re-center chip handler: resume follow and immediately re-frame. */
  protected resumeFollow(): void {
    this.followPaused.set(false);
    this.requestFollowFrame();
  }

  /** Coalesce follow re-frames into a single rAF, so rapid changes batch. */
  private requestFollowFrame(): void {
    this.followFrameRequested = true;
    if (this.followFrameHandle !== null) cancelAnimationFrame(this.followFrameHandle);
    this.followFrameHandle = requestAnimationFrame(() => {
      this.followFrameHandle = null;
      this.tryFollowFrame();
    });
  }

  /**
   * Frame the running nodes (plus their direct neighbours for context) if follow
   * is active. Re-enabling follow (off→on) also clears any earlier pause.
   */
  private tryFollowFrame(): void {
    // Peeked outside a reactive consumer — no dependency is registered here.
    if (this.followExecution() && !this.lastFollowOn) this.followPaused.set(false);
    this.lastFollowOn = this.followExecution();

    if (!this.followActive() || !this.followFrameRequested) return;
    const elements = this.collectFollowElements();
    if (elements.length === 0) return;
    this.followFrameRequested = false;
    this.cameraRef().frameElements(elements, { maxScale: FOLLOW_MAX_ZOOM });
  }

  /** Running node elements plus their 1-hop neighbours, for follow framing. */
  private collectFollowElements(): Element[] {
    const runningIds = this.nodes()
      .filter((node) => node.status === 'running')
      .map((node) => node.id);
    if (runningIds.length === 0) return [];

    const focusIds = new Set(runningIds);
    const neighbours = this.buildNeighbourMap();
    for (const id of runningIds) {
      for (const neighbour of neighbours.get(id) ?? []) focusIds.add(neighbour);
    }

    const elements: Element[] = [];
    for (const id of focusIds) {
      const element = this.findNodeElement(id);
      if (element) elements.push(element);
    }
    return elements;
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
  private buildRefGroups(node: DaxurDaemonAPI.TaskRunNode): TaskGraphRefGroup[] {
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
    refKind: DaxurDaemonAPI.TaskRunInspectableRefKind,
    ref: DaxurDaemonAPI.TaskRunInspectableRef,
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
    refKind: DaxurDaemonAPI.TaskRunInspectableRefKind,
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
  protected readRefLabel(ref: DaxurDaemonAPI.TaskRunInspectableRef): string {
    return 'label' in ref && ref.label ? ref.label : ref.id;
  }

  /**
   * Read the main summary line from any task-run ref.
   *
   * PURPOSE: Prefer human-authored summaries and fall back to the stored path or event id.
   *
   * VALUE: Ref rows remain useful even when a task only publishes a file pointer.
   */
  protected readRefSummary(ref: DaxurDaemonAPI.TaskRunInspectableRef): string {
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
  protected readRefPath(ref: DaxurDaemonAPI.TaskRunInspectableRef): string | null {
    return 'path' in ref && typeof ref.path === 'string' && ref.path.trim().length > 0 ? ref.path : null;
  }

  /**
   * Format loaded ref content for display.
   *
   * PURPOSE: Pretty-print JSON snapshots while leaving logs and text artifacts untouched.
   *
   * VALUE: Structured node context is easier to inspect without changing how refs are stored.
   */
  private formatTaskRunRefContent(content: DaxurDaemonAPI.TaskRunRefContent): string {
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
