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
  viewChild,
} from '@angular/core';
import { MarkdownModule, MermaidAPI } from 'ngx-markdown';

import { DaxurDaemonAPI } from '@daxur-daemon-api/daxur-daemon-api';
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

/** Query parameter used to encode the real node id in Mermaid click hrefs. */
const NODE_HREF_PARAM = 'node';

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
    useMaxWidth: true,
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
  imports: [MarkdownModule, GraphCameraComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskGraphComponent {
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
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

  /** The node to mark as the live "current" focus, if any. */
  readonly currentNodeId = input<string | null>(null);

  /** Per-node display overrides, keyed by real node id. */
  readonly decorations = input<Record<string, TaskGraphNodeDecoration>>({});

  /** Emits the real node id when a node is clicked. */
  readonly nodeSelected = output<string>();

  protected readonly mermaidOptions = DEFAULT_MERMAID_OPTIONS;

  private readonly aliasMap = computed<TaskGraphAliasMap>(() => this.buildAliasMap(this.nodes()));

  protected readonly flowMarkdown = computed(() => `\`\`\`mermaid\n${this.buildGraph()}\n\`\`\``);

  /** True once the first Mermaid node has rendered, so we fit the view once. */
  private hasFitInitialView = false;

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

    effect(() => this.scheduleSelectedNodeClass(this.selectedNodeId()));
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
    this.applySelectedNodeClass(this.selectedNodeId());
    if (!this.hasFitInitialView && this.hostElement.nativeElement.querySelector('.mermaid .node')) {
      this.hasFitInitialView = true;
      requestAnimationFrame(() => this.cameraRef().fitAll());
    }
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
}
