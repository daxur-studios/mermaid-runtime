import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Reusable layout container for lists and grids of {@link GraphCardComponent}.
 *
 * PURPOSE: Provide consistent responsive grid and list layouts, spacing, and empty states
 * for collections of graph cards.
 *
 * VALUE: Hosts wrap their `@for` loop of `<mr-graph-card>` in `<mr-graph-card-list>` to
 * instantly get responsive grid packing or list alignment without writing custom CSS.
 */
@Component({
  selector: 'mr-graph-card-list',
  templateUrl: './graph-card-list.component.html',
  styleUrl: './graph-card-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'mr-graph-card-list',
    '[class.mr-graph-card-list--grid]': 'layout() === "grid"',
    '[class.mr-graph-card-list--list]': 'layout() === "list"',
    '[style.--mr-card-list-columns]': 'columnStyle()',
    '[style.--mr-card-list-gap]': 'gap()',
  },
})
export class GraphCardListComponent {
  /** Layout mode: 'grid' (responsive multi-column) or 'list' (single column stack). */
  readonly layout = input<'grid' | 'list'>('grid');

  /** Number of grid columns, or 'auto' for responsive auto-fill based on card min-width. */
  readonly columns = input<number | 'auto'>('auto');

  /** Spacing gap between cards (e.g. '16px', '1rem'). */
  readonly gap = input<string>('16px');

  /** Whether the collection is empty. Shows the empty state slot instead of card content. */
  readonly empty = input<boolean>(false);

  /** Default message displayed when empty is true and no custom [empty] slot is projected. */
  readonly emptyText = input<string>('No graphs or runs available');

  /** Computed CSS grid-template-columns value. */
  readonly columnStyle = computed(() => {
    const cols = this.columns();
    if (cols === 'auto') {
      return 'repeat(auto-fill, minmax(var(--mr-card-min-width, 280px), 1fr))';
    }
    return `repeat(${cols}, minmax(0, 1fr))`;
  });
}
