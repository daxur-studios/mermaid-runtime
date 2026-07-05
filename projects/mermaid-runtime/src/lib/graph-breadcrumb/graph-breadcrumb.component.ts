import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { CommonModule } from "@angular/common";

/**
 * One navigable graph breadcrumb entry.
 *
 * Value: Lets hosts render the graph drill-down path outside the canvas while
 * still routing depth changes back through the canvas navigation API.
 */
export interface GraphBreadcrumbEntry {
  /** Label shown for this breadcrumb level. */
  label: string;
  /** Navigation depth in the graph stack, where 0 is the root graph. */
  depth: number;
}

/**
 * Reusable graph breadcrumb control.
 *
 * Value: Keeps the breadcrumb visual treatment shared between the built-in graph
 * chrome and host-rendered overlay stacks.
 */
@Component({
  selector: "mr-graph-breadcrumb",
  templateUrl: "./graph-breadcrumb.component.html",
  styleUrl: "./graph-breadcrumb.component.scss",
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphBreadcrumbComponent {
  /** Breadcrumb entries from root to the current graph depth. */
  readonly breadcrumbs = input<readonly GraphBreadcrumbEntry[]>([]);

  /** Emits the target graph depth when a non-current crumb is selected. */
  readonly depthSelected = output<number>();
}
