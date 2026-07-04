import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { GraphCanvasComponent } from '../graph-canvas/graph-canvas.component';

/**
 * Camera zoom, pan, and layout direction control buttons for a graph canvas.
 *
 * PURPOSE: A reusable control panel that can float over the graph canvas or be Relocated
 * by the host application (e.g. inside a global app shell overlay) while retaining direct
 * control over zoom, pan, and layout flow.
 *
 * VALUE: Clean separation of camera mechanics and host overlay placement, allowing any graph
 * page to get standardized view controls that sync with its dynamic layout direction.
 */
@Component({
  selector: 'mr-graph-camera-controls',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './graph-camera-controls.component.html',
  styleUrl: './graph-camera-controls.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphCameraControlsComponent {
  /** Reference to the GraphCanvasComponent being controlled. */
  readonly canvas = input.required<GraphCanvasComponent>();

  /** Whether to reveal the button that toggles layout flow direction (TD vs LR). */
  readonly showDirectionToggle = input<boolean>(true);

  /**
   * Toggles the target canvas's layout direction.
   *
   * Triggers an asynchronous SVG re-layout and a post-render camera auto-fit.
   */
  toggleDirection(): void {
    const current = this.canvas().direction();
    this.canvas().direction.set(current === 'TD' ? 'LR' : 'TD');
  }
}
