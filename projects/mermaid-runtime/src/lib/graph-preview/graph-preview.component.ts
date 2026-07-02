import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { MermaidRuntime } from '../task-graph-model';
import { GraphPreviewSimpleComponent } from './graph-preview-simple.component';
import { GraphPreviewMermaidComponent } from './graph-preview-mermaid.component';

/**
 * Rendering strategy for {@link GraphPreviewComponent}.
 *
 * VALUE: `'simple'` is a near-free hand-drawn box diagram, safe to use for many simultaneous
 * previews (e.g. a full kanban board); `'mermaid'` is a real Mermaid render, worth the layout
 * cost for the one graph a host wants an accurate, detailed thumbnail of.
 */
export type GraphPreviewMode = 'simple' | 'mermaid';

/**
 * Standalone, reusable preview of a {@link MermaidRuntime.Graph} — status-coloured and
 * live-updating, with no dependency on the interactive `GraphCanvasComponent`.
 *
 * PURPOSE: Give a node's subgraph, a delegated task's graph, or a kanban card a small thumbnail
 * of "what's inside" without pulling in the full pan/zoom/minimap/drill-down viewer.
 *
 * VALUE: A single component a host drops in anywhere, choosing per-instance between the cheap
 * {@link GraphPreviewSimpleComponent} shape and the faithful {@link GraphPreviewMermaidComponent}
 * render via the `mode` input — both read live status straight off the `graph` input, so passing
 * a new graph object on every status tick (the same immutable-data convention already used
 * elsewhere in this library) is all a host needs to do to keep it live.
 */
@Component({
  selector: 'mr-graph-preview',
  templateUrl: './graph-preview.component.html',
  styleUrl: './graph-preview.component.scss',
  host: { class: 'mr-graph-preview' },
  imports: [GraphPreviewSimpleComponent, GraphPreviewMermaidComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphPreviewComponent {
  /** Graph to preview (a node's subgraph, a delegated task's graph, or any standalone graph). */
  readonly graph = input.required<MermaidRuntime.Graph>();

  /** Which renderer to use — see {@link GraphPreviewMode}. */
  readonly mode = input<GraphPreviewMode>('simple');

  /** Status → visual-treatment overrides, merged over the built-in defaults. */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});
}
