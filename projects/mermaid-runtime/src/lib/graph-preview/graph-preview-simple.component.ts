import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import mermaid from 'mermaid';

import { MermaidRuntime } from '../task-graph-model';
import { ensureMermaidTemporaryRenderIsolation } from '../mermaid-render-sandbox';
import {
  buildMermaidRuntimeConfig,
  readMermaidRuntimeConfigKey,
  type MermaidRuntimeConfig,
} from '../mermaid-theme';
import {
  hashPreviewStatuses,
  hashPreviewStructure,
  resolvePreviewEdges,
  resolvePreviewStatusClass,
} from './graph-preview.utils';
import { DEFAULT_PREVIEW_STATUS_STYLES } from './status-styles';

let instanceCounter = 0;
let activeMermaidConfigKey: string | null = null;

function ensureMermaidConfigured(config: MermaidRuntimeConfig): void {
  const key = readMermaidRuntimeConfigKey(config);
  if (activeMermaidConfigKey === key) return;
  activeMermaidConfigKey = key;
  mermaid.initialize(config);
}

/**
 * Reworked simple shape preview of a graph — renders a compact node graph
 * via Mermaid with status-coloured circles, no text labels, and thick connecting lines.
 *
 * PURPOSE: Render a clean, high-level structural map of the task graph for idle states
 * or dashboards.
 *
 * VALUE: Provides a faithful but highly simplified topological preview that retains the
 * exact same graph layout structure as the full-resolution view.
 */
@Component({
  selector: 'mr-graph-preview-simple',
  templateUrl: './graph-preview-simple.component.html',
  styleUrl: './graph-preview-simple.component.scss',
  host: { class: 'mr-graph-preview-simple' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphPreviewSimpleComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);

  private readonly instanceId = `mr-graph-preview-simple-${instanceCounter++}`;
  private renderToken = 0;

  /** Graph to preview. */
  readonly graph = input.required<MermaidRuntime.Graph>();

  /** Status to visual-treatment overrides, merged over the built-in defaults. */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Contrast family used when the runtime builds its default Mermaid config. */
  readonly mermaidTheme = input<MermaidRuntime.MermaidThemeId>('dark');

  /** Layout direction of the graph flow ('TD' or 'LR'). */
  readonly direction = input<'TD' | 'LR'>('TD');

  private readonly effectiveStatusStyles = computed<MermaidRuntime.StatusStyleMap>(() => ({
    ...DEFAULT_PREVIEW_STATUS_STYLES,
    ...this.statusStyles(),
  }));

  /** Mermaid-safe alias per real node id, rebuilt only when the node set/order changes. */
  private readonly aliasByNodeId = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    this.graph().nodes.forEach((node, index) => map.set(node.id, `n${index}`));
    return map;
  });

  /** Structure-only signature - gates the actual expensive Mermaid render. */
  private readonly structureHash = computed(() => hashPreviewStructure(this.graph()));

  /** Status-only signature - gates the cheap recolor-in-place DOM pass. */
  private readonly statusHash = computed(() => hashPreviewStatuses(this.graph()));

  /**
   * Compact-render override for the simplified mode.
   *
   * VALUE: Spacing is reduced to a minimum and labels are disabled to keep it extremely compact.
   */
  private static readonly COMPACT_FLOWCHART_OVERRIDE = {
    htmlLabels: false,
    useMaxWidth: true,
    rankSpacing: 16,
    nodeSpacing: 16,
    curve: 'basis',
  } as const;

  private readonly resolvedMermaidConfig = computed<MermaidRuntimeConfig>(() => {
    const base = buildMermaidRuntimeConfig(this.mermaidTheme(), false);
    return {
      ...base,
      flowchart: { ...base.flowchart, ...GraphPreviewSimpleComponent.COMPACT_FLOWCHART_OVERRIDE },
    };
  });

  /** The rendered SVG markup, sanitized for `[innerHTML]` binding. */
  protected readonly svg = signal<SafeHtml | null>(null);

  constructor() {
    effect(() => {
      this.structureHash();
      const direction = this.direction();
      const config = this.resolvedMermaidConfig();
      const graph = untracked(() => this.graph());
      const aliasByNodeId = untracked(() => this.aliasByNodeId());
      void this.renderMermaid(graph, aliasByNodeId, config, direction);
    });

    effect(() => {
      this.statusHash();
      this.applyStatusClasses();
    });
  }

  private async renderMermaid(
    graph: MermaidRuntime.Graph,
    aliasByNodeId: Map<string, string>,
    config: MermaidRuntimeConfig,
    direction: 'TD' | 'LR',
  ): Promise<void> {
    const token = ++this.renderToken;
    ensureMermaidConfigured(config);
    const source = this.buildMermaidSource(graph, aliasByNodeId, direction);
    const renderId = `${this.instanceId}-${token}`;
    ensureMermaidTemporaryRenderIsolation(this.hostElement.nativeElement.ownerDocument);
    const { svg, bindFunctions } = await mermaid.render(renderId, source);
    if (token !== this.renderToken) return;

    this.svg.set(this.sanitizer.bypassSecurityTrustHtml(svg));
    afterNextRender(
      () => {
        bindFunctions?.(this.hostElement.nativeElement);
        this.applyStatusClasses();
      },
      { injector: this.injector },
    );
  }

  private buildMermaidSource(
    graph: MermaidRuntime.Graph,
    aliasByNodeId: Map<string, string>,
    direction: 'TD' | 'LR',
  ): string {
    const edges = resolvePreviewEdges(graph);
    const lines = [
      `flowchart ${direction}`,
      // Render each node as a circle containing a space
      ...graph.nodes.map((node) => `  ${aliasByNodeId.get(node.id)}((" "))`),
      ...edges
        .map((edge) => {
          const from = aliasByNodeId.get(edge.from);
          const to = aliasByNodeId.get(edge.to);
          // Strip labels on lines connecting nodes
          return from && to ? `  ${from} --> ${to}` : null;
        })
        .filter((line): line is string => line !== null),
    ];
    return lines.join('\n');
  }

  /** Apply each node's status color directly to its rendered `.node` element - no re-render. */
  private applyStatusClasses(): void {
    const styles = this.effectiveStatusStyles();
    const statusClassNames = [
      ...new Set(Object.values(styles).map((style) => style?.className).filter((name): name is string => !!name)),
    ];

    const aliasByNodeId = this.aliasByNodeId();
    for (const node of this.graph().nodes) {
      const alias = aliasByNodeId.get(node.id);
      if (!alias) continue;
      const element = this.findNodeElement(alias);
      if (!element) continue;
      element.classList.remove(...statusClassNames);
      const statusClass = resolvePreviewStatusClass(node.status, styles);
      if (statusClass) element.classList.add(statusClass);
    }
  }

  /** Resolve a node's alias to its rendered `.node` element. */
  private findNodeElement(alias: string): Element | null {
    const host = this.hostElement.nativeElement;
    const nodes = host.querySelectorAll('g.node');
    for (const nodeEl of Array.from(nodes) as Element[]) {
      const id = nodeEl.getAttribute('id');
      if (id) {
        const parts = id.split('-');
        if (parts.includes(alias)) {
          return nodeEl;
        }
      }
    }
    return null;
  }
}
