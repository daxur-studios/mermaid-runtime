import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import mermaid from 'mermaid';

import { MermaidRuntime } from '../task-graph-model';
import { hashPreviewStatuses, hashPreviewStructure, resolvePreviewEdges, resolvePreviewStatusClass } from './graph-preview.utils';
import { DEFAULT_PREVIEW_STATUS_STYLES } from './status-styles';

/** Query param used on a node's (click-suppressed) href so its element can be found post-render. */
const NODE_HREF_PARAM = 'node';

/** Whether {@link ensureMermaidInitialized} has already run for this app instance. */
let mermaidInitialized = false;

/**
 * One-time global Mermaid init, matching `GraphCanvasComponent`'s own defaults.
 *
 * PURPOSE: Mermaid keeps its render config as module-global state — whichever caller
 * initializes it first wins app-wide.
 *
 * VALUE: Using the same options as the interactive canvas's `DEFAULT_MERMAID_OPTIONS` means it
 * doesn't matter which one runs first; every Mermaid diagram in a host app renders consistently.
 */
function ensureMermaidInitialized(): void {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaid.initialize({
    theme: 'dark',
    startOnLoad: false,
    securityLevel: 'loose',
    flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
  });
}

/** Running counter so each component instance gets a unique Mermaid render-id prefix. */
let instanceCounter = 0;

/**
 * Real Mermaid-rendered preview of a graph.
 *
 * PURPOSE: A faithful (not simplified) thumbnail, for the one case worth the real layout cost —
 * e.g. the single actively-running kanban card, or a task-graph node's drilled-into detail.
 *
 * VALUE: Two-tier reactivity keeps this cheap to keep live: a structure-only hash gates the
 * actual `mermaid.render()` call (the expensive part), while a separate status-only hash drives
 * a plain DOM class toggle on the already-rendered nodes — so a running task's node colours
 * update every tick without ever re-invoking Mermaid's layout engine. No camera, minimap, or
 * click/drill-down chrome; a host box plus Mermaid's own `viewBox` does the scale-down.
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

  /** Status → visual-treatment overrides, merged over the built-in defaults. */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

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

  /** Structure-only signature — gates the actual (expensive) Mermaid render. */
  private readonly structureHash = computed(() => hashPreviewStructure(this.graph()));

  /** Status-only signature — gates the cheap "recolour in place" DOM pass. */
  private readonly statusHash = computed(() => hashPreviewStatuses(this.graph()));

  /** The rendered SVG markup, sanitized for `[innerHTML]` binding. */
  protected readonly svg = signal<SafeHtml | null>(null);

  constructor() {
    const host = this.hostElement.nativeElement;
    // Mermaid's `click` directive is reused here purely to get a reliable per-node `<a>`
    // wrapper to query after render (same technique as GraphCanvasComponent.findNodeElement) —
    // this preview has no click behaviour, so navigation is suppressed unconditionally.
    const suppressClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    host.addEventListener('click', suppressClick, true);
    this.destroyRef.onDestroy(() => host.removeEventListener('click', suppressClick, true));

    effect(() => {
      this.structureHash();
      const graph = untracked(() => this.graph());
      const aliasByNodeId = untracked(() => this.aliasByNodeId());
      void this.renderMermaid(graph, aliasByNodeId);
    });

    effect(() => {
      this.statusHash();
      this.applyStatusClasses();
    });
  }

  private async renderMermaid(graph: MermaidRuntime.Graph, aliasByNodeId: Map<string, string>): Promise<void> {
    const token = ++this.renderToken;
    ensureMermaidInitialized();
    const source = this.buildMermaidSource(graph, aliasByNodeId);
    const renderId = `${this.instanceId}-${token}`;
    const { svg, bindFunctions } = await mermaid.render(renderId, source);
    if (token !== this.renderToken) return; // Superseded by a newer structure change mid-flight.

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

  /** Apply each node's status colour directly to its rendered `.node` element — no re-render. */
  private applyStatusClasses(): void {
    const styles = this.effectiveStatusStyles();
    const statusClassNames = [...new Set(Object.values(styles).map((style) => style?.className).filter((name): name is string => !!name))];

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

  /** Resolve a node's alias to its rendered `.node` element, via the (click-suppressed) anchor. */
  private findNodeElement(alias: string): Element | null {
    const host = this.hostElement.nativeElement;
    const link = (Array.from(host.querySelectorAll('a')) as Element[]).find((linkElement) => this.readAliasFromLink(linkElement) === alias);
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
