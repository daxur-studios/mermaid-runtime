import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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

/** Query param used on a node's click-suppressed href so its element can be found post-render. */
const NODE_HREF_PARAM = 'node';

/** Key for the Mermaid config most recently applied to Mermaid's module-global renderer. */
let activeMermaidConfigKey: string | null = null;

/**
 * Applies Mermaid's module-global render config when it changed.
 *
 * PURPOSE: Mermaid keeps its render config as module-global state; whichever caller
 * initializes it last wins app-wide.
 *
 * VALUE: Graph previews can follow a host theme change without locking Mermaid to the
 * first dark/light config that happened to render.
 */
function ensureMermaidConfigured(config: MermaidRuntimeConfig): void {
  const key = readMermaidRuntimeConfigKey(config);
  if (activeMermaidConfigKey === key) return;
  activeMermaidConfigKey = key;
  mermaid.initialize(config);
}

/** Running counter so each component instance gets a unique Mermaid render-id prefix. */
let instanceCounter = 0;

/**
 * Real Mermaid-rendered preview of a graph.
 *
 * PURPOSE: A faithful thumbnail for the one case worth the real layout cost, such as the single
 * actively-running kanban card or a task-graph node's drilled-into detail.
 *
 * VALUE: Two-tier reactivity keeps this cheap to keep live: a structure-only hash gates the
 * actual `mermaid.render()` call, while a separate status-only hash drives a plain DOM class
 * toggle on the already-rendered nodes.
 */
@Component({
  selector: 'mr-graph-preview-mermaid',
  templateUrl: './graph-preview-mermaid.component.html',
  styleUrl: './graph-preview-mermaid.component.scss',
  host: { class: 'mr-graph-preview-mermaid' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphPreviewMermaidComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly instanceId = `mr-graph-preview-mermaid-${instanceCounter++}`;
  private renderToken = 0;

  /** Graph to preview. */
  readonly graph = input.required<MermaidRuntime.Graph>();

  /** Status to visual-treatment overrides, merged over the built-in defaults. */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Contrast family used when the runtime builds its default Mermaid config. */
  readonly mermaidTheme = input<MermaidRuntime.MermaidThemeId>('dark');

  /**
   * Full Mermaid render config override for hosts that need custom theme variables.
   *
   * VALUE: Lets advanced hosts provide `theme: 'base'` and `themeVariables` while
   * simple hosts use `mermaidTheme` only.
   */
  readonly mermaidConfig = input<MermaidRuntimeConfig | null>(null);

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
   * Compact-render override applied on top of {@link buildMermaidRuntimeConfig}'s defaults.
   *
   * PURPOSE: `htmlLabels: true` (the shared default, tuned for the full interactive graph
   * viewer) renders node labels as `<foreignObject>` HTML content, which Chromium does not
   * rescale with the surrounding SVG's `viewBox` — at this component's thumbnail size that
   * left labels (and their node boxes) rendering at full, unscaled size and spilling out of
   * the tiny preview area.
   *
   * VALUE: Plain SVG `<text>` labels scale correctly with the viewBox, so the preview stays
   * inside whatever box the host gives it via CSS, however small.
   */
  private static readonly COMPACT_FLOWCHART_OVERRIDE = { htmlLabels: false, useMaxWidth: true } as const;

  private readonly resolvedMermaidConfig = computed<MermaidRuntimeConfig>(() => {
    const override = this.mermaidConfig();
    if (override) return override;
    const base = buildMermaidRuntimeConfig(this.mermaidTheme(), false);
    return {
      ...base,
      flowchart: { ...base.flowchart, ...GraphPreviewMermaidComponent.COMPACT_FLOWCHART_OVERRIDE },
    };
  });

  /** The rendered SVG markup, sanitized for `[innerHTML]` binding. */
  protected readonly svg = signal<SafeHtml | null>(null);

  constructor() {
    const host = this.hostElement.nativeElement;
    // Mermaid's `click` directive is reused here purely to get a reliable per-node `<a>`
    // wrapper to query after render. This preview has no click behavior, so navigation is
    // suppressed unconditionally.
    const suppressClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    host.addEventListener('click', suppressClick, true);
    this.destroyRef.onDestroy(() => host.removeEventListener('click', suppressClick, true));

    effect(() => {
      this.structureHash();
      const config = this.resolvedMermaidConfig();
      const graph = untracked(() => this.graph());
      const aliasByNodeId = untracked(() => this.aliasByNodeId());
      void this.renderMermaid(graph, aliasByNodeId, config);
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
  ): Promise<void> {
    const token = ++this.renderToken;
    ensureMermaidConfigured(config);
    const source = this.buildMermaidSource(graph, aliasByNodeId);
    const renderId = `${this.instanceId}-${token}`;
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

  private buildMermaidSource(graph: MermaidRuntime.Graph, aliasByNodeId: Map<string, string>): string {
    const edges = resolvePreviewEdges(graph);
    const lines = [
      'flowchart TD',
      ...graph.nodes.map((node) => `  ${aliasByNodeId.get(node.id)}["${this.escapeMermaidString(node.title)}"]`),
      ...edges
        .map((edge) => {
          const from = aliasByNodeId.get(edge.from);
          const to = aliasByNodeId.get(edge.to);
          return from && to ? `  ${from} --> ${to}` : null;
        })
        .filter((line): line is string => line !== null),
      ...graph.nodes.map((node) => `  click ${aliasByNodeId.get(node.id)} "?${NODE_HREF_PARAM}=${aliasByNodeId.get(node.id)}"`),
    ];
    return lines.join('\n');
  }

  private escapeMermaidString(value: string): string {
    return value.replace(/"/g, '\\"');
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

  /** Resolve a node's alias to its rendered `.node` element, via the click-suppressed anchor. */
  private findNodeElement(alias: string): Element | null {
    const host = this.hostElement.nativeElement;
    const link = (Array.from(host.querySelectorAll('a')) as Element[]).find(
      (linkElement) => this.readAliasFromLink(linkElement) === alias,
    );
    if (!link) return null;
    return link.querySelector('.node') ?? link.closest('.node');
  }

  private readAliasFromLink(linkElement: Element): string | null {
    const href = linkElement.getAttribute('href') ?? linkElement.getAttribute('xlink:href');
    if (!href) return null;
    try {
      const url = new URL(href, window.location.origin);
      return url.searchParams.get(NODE_HREF_PARAM);
    } catch {
      return null;
    }
  }
}
