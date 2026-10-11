import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { MermaidRuntime } from '../task-graph-model';
import { GraphPreviewComponent, type GraphPreviewMode } from '../graph-preview/graph-preview.component';
import { computeGraphProgress } from './graph-card.utils';

/**
 * Reusable card component for displaying a graph or run in a list, grid, or board.
 *
 * PURPOSE: Render a single task, run, or workflow item with a mini graph preview / image header,
 * title, subtitle, status badge, progress bar, and customizable content projection slots.
 *
 * VALUE: Host applications can display lists and grids of execution graphs out-of-the-box
 * (matching the feel of Daxur Daemon's Kanban cards and run lists) while retaining total
 * control over badges, actions, metadata, and styling via CSS custom properties.
 */
@Component({
  selector: 'mr-graph-card',
  templateUrl: './graph-card.component.html',
  styleUrl: './graph-card.component.scss',
  imports: [GraphPreviewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mr-graph-card',
    '[class.mr-graph-card--interactive]': 'interactive()',
    '[class.mr-graph-card--selected]': 'selected()',
    '[class.mr-graph-card--horizontal]': 'orientation() === "horizontal"',
    '[class.mr-graph-card--running]': 'resolvedStatus() === "running"',
    '[class.mr-graph-card--failed]': 'resolvedStatus() === "failed"',
    '[class.mr-graph-card--complete]': 'resolvedStatus() === "complete"',
    '[attr.data-status]': 'resolvedStatus()',
    '(click)': 'onHostClick($event)',
  },
})
export class GraphCardComponent {
  /** Graph to render in the mini preview header. */
  readonly graph = input<MermaidRuntime.Graph | null>(null);

  /** Optional static image URL to show in the header instead of (or as fallback to) a graph preview. */
  readonly headerImageSrc = input<string | null>(null);

  /** Alt text for the static header image. */
  readonly headerAlt = input<string>('');

  /** Main title of the card. */
  readonly title = input<string>('');

  /** Secondary subtitle / description text. */
  readonly subtitle = input<string | null>(null);

  /** Explicit status string (e.g. 'running', 'complete', 'failed', 'idle'). Inferred from graph if omitted. */
  readonly status = input<string | null>(null);

  /** Explicit progress percentage (0-100). Inferred from graph nodes if omitted. */
  readonly progress = input<number | null>(null);

  /** Whether to automatically derive progress from graph nodes when progress input is not provided. */
  readonly autoProgress = input<boolean>(true);

  /** Whether to display the progress bar below the header. */
  readonly showProgress = input<boolean>(true);

  /** Mode for the built-in mini preview ('simple' circular nodes or 'mermaid' full SVG). Default is 'simple'. */
  readonly previewMode = input<GraphPreviewMode>('simple');

  /** Direction for the mini preview flow ('LR' or 'TD'). Default is 'LR'. */
  readonly previewDirection = input<'TD' | 'LR'>('LR');

  /** Theme forwarded to the mini preview. */
  readonly mermaidTheme = input<MermaidRuntime.MermaidThemeId>('dark');

  /** Custom status styles forwarded to the preview. */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Whether the card is interactive (pointer cursor, hover effects, emits cardClick). */
  readonly interactive = input<boolean>(true);

  /** Whether the card is visually marked as selected/active. */
  readonly selected = input<boolean>(false);

  /** Card layout orientation: 'vertical' (header on top) or 'horizontal' (header on left). */
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');

  /** Emitted when the card is clicked by the user (excluding clicks on inner buttons, links, or inputs). */
  readonly cardClick = output<MouseEvent>();

  /** Whether a header banner (preview or image) should be displayed. */
  readonly hasHeader = computed(() => {
    return !!(this.headerImageSrc() || this.graph());
  });

  /** Resolved progress percentage (0-100). */
  readonly resolvedProgress = computed(() => {
    const explicit = this.progress();
    if (explicit !== null && explicit !== undefined) {
      return Math.max(0, Math.min(100, Math.round(explicit)));
    }
    if (this.autoProgress()) {
      const g = this.graph();
      if (g && g.nodes && g.nodes.length > 0) {
        return computeGraphProgress(g).percent;
      }
    }
    return 0;
  });

  /** Whether the progress bar element should be visible. */
  readonly hasProgressBar = computed(() => {
    if (!this.showProgress()) {
      return false;
    }
    if (this.progress() !== null && this.progress() !== undefined) {
      return true;
    }
    if (this.autoProgress()) {
      const g = this.graph();
      return !!(g && g.nodes && g.nodes.length > 0);
    }
    return false;
  });

  /** Resolved execution status of the card. */
  readonly resolvedStatus = computed(() => {
    const explicit = this.status();
    if (explicit) {
      return explicit;
    }
    const g = this.graph();
    if (g && g.nodes && g.nodes.length > 0) {
      const summary = computeGraphProgress(g);
      if (summary.running > 0) {
        return 'running';
      }
      if (summary.failed > 0) {
        return 'failed';
      }
      if (summary.total > 0 && summary.done === summary.total) {
        return 'complete';
      }
      return 'idle';
    }
    return null;
  });

  onHostClick(event: MouseEvent): void {
    if (!this.interactive()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select, textarea, [data-prevent-card-click]')) {
      return;
    }

    this.cardClick.emit(event);
  }
}
