import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { MermaidRuntime } from '../task-graph-model';
import { computePreviewDepths, resolvePreviewEdges, resolvePreviewStatusClass } from './graph-preview.utils';
import { DEFAULT_PREVIEW_STATUS_STYLES } from './status-styles';

/** Most nodes drawn before the remainder collapses into a "+N" overflow marker. */
const GRAPH_PREVIEW_SIMPLE_MAX_NODES = 10;

/** Width (SVG user units) of one node box. */
const GRAPH_PREVIEW_SIMPLE_BOX_WIDTH = 16;

/** Height (SVG user units) of one node box. */
const GRAPH_PREVIEW_SIMPLE_BOX_HEIGHT = 8;

/** Horizontal gap (SVG user units) between depth columns. */
const GRAPH_PREVIEW_SIMPLE_COLUMN_GAP = 24;

/** Vertical gap (SVG user units) between sibling rows in a column. */
const GRAPH_PREVIEW_SIMPLE_ROW_GAP = 14;

/** Outer padding (SVG user units) around the drawing. */
const GRAPH_PREVIEW_SIMPLE_PADDING = 4;

/** Extra width (SVG user units) reserved for the "+N" overflow label. */
const GRAPH_PREVIEW_SIMPLE_OVERFLOW_LABEL_WIDTH = 16;

/**
 * Cheap, dependency-free "shape" preview of a graph — a depth-column box diagram, each box
 * status-coloured, with no Mermaid/DOM layout engine involved.
 *
 * PURPOSE: Give many simultaneous previews (e.g. a kanban board full of cards) a near-free
 * rendering path.
 *
 * VALUE: The SVG is built by a pure `computed()` and bound declaratively via `[innerHTML]`, so
 * it repaints whenever the `graph` input changes (structure or status) with no manual
 * hash/DOM-patch bookkeeping to fall out of sync — the class of bug the original inline
 * subgraph-preview in `GraphCanvasComponent` has.
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

  /** Graph to preview. Re-render is driven entirely by this input changing (structure or status). */
  readonly graph = input.required<MermaidRuntime.Graph>();

  /** Status → visual-treatment overrides, merged over the built-in defaults. */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  private readonly effectiveStatusStyles = computed<MermaidRuntime.StatusStyleMap>(() => ({
    ...DEFAULT_PREVIEW_STATUS_STYLES,
    ...this.statusStyles(),
  }));

  /** The rendered SVG markup, sanitized for `[innerHTML]` binding. */
  protected readonly svg = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.buildSvg()));

  private buildSvg(): string {
    const graph = this.graph();
    const allEdges = resolvePreviewEdges(graph);

    const nodes = graph.nodes.slice(0, GRAPH_PREVIEW_SIMPLE_MAX_NODES);
    const truncated = graph.nodes.length - nodes.length;
    const ids = new Set(nodes.map((node) => node.id));
    const edges = allEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));

    const depthById = computePreviewDepths(nodes, edges);
    const columns: string[][] = [];
    for (const node of nodes) {
      const depth = depthById.get(node.id) ?? 0;
      (columns[depth] ??= []).push(node.id);
    }

    const boxW = GRAPH_PREVIEW_SIMPLE_BOX_WIDTH;
    const boxH = GRAPH_PREVIEW_SIMPLE_BOX_HEIGHT;
    const colGap = GRAPH_PREVIEW_SIMPLE_COLUMN_GAP;
    const rowGap = GRAPH_PREVIEW_SIMPLE_ROW_GAP;
    const pad = GRAPH_PREVIEW_SIMPLE_PADDING;

    const positionById = new Map<string, { x: number; y: number }>();
    columns.forEach((column, depth) => {
      column.forEach((id, row) => {
        positionById.set(id, { x: pad + depth * colGap, y: pad + row * rowGap });
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
        if (!from || !to) return '';
        const x1 = from.x + boxW;
        const y1 = from.y + boxH / 2;
        const x2 = to.x;
        const y2 = to.y + boxH / 2;
        return `<line class="gp-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
      })
      .join('');

    const styles = this.effectiveStatusStyles();
    const boxMarkup = nodes
      .map((node) => {
        const pos = positionById.get(node.id);
        if (!pos) return '';
        const statusClass = resolvePreviewStatusClass(node.status, styles) ?? '';
        return `<rect class="gp-box ${statusClass}" x="${pos.x}" y="${pos.y}" width="${boxW}" height="${boxH}" rx="1.5" ry="1.5" />`;
      })
      .join('');

    let overflowMarkup = '';
    if (truncated > 0) {
      const textX = width + 2;
      width += GRAPH_PREVIEW_SIMPLE_OVERFLOW_LABEL_WIDTH;
      overflowMarkup = `<text class="gp-more" x="${textX}" y="${height / 2 + 3}">+${truncated}</text>`;
    }

    return (
      `<svg class="gp-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
      `${edgeMarkup}${boxMarkup}${overflowMarkup}</svg>`
    );
  }
}
