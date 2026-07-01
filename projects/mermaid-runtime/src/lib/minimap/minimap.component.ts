import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import type { GraphRect } from '../graph-camera/graph-camera.component';
import type { MinimapNodeRect } from '../graph-canvas/graph-canvas.component';

/** Fixed on-screen size (px) of the minimap panel. */
const MINIMAP_WIDTH_PX = 168;
const MINIMAP_HEIGHT_PX = 116;

/** Scene-space padding added around contentRect to keep nodes away from edges. */
const MINIMAP_VIEWBOX_PADDING_PX = 12;

/** Minimum size in scene units for very small nodes so they stay visible. */
const MINIMAP_NODE_MIN_SIZE_PX = 6;

@Component({
  selector: 'mr-minimap',
  templateUrl: './minimap.component.html',
  styleUrl: './minimap.component.scss',
  host: { class: 'mr-minimap' },
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MinimapComponent {
  constructor() {
    console.log('[MinimapComponent] Instantiated');
    effect(() => {
      console.log('[MinimapComponent] Inputs - contentRect:', this.contentRect(), 
                  'viewportRect:', this.viewportRect(), 
                  'nodesCount:', this.nodes().length);
    });
    effect(() => {
      console.log('[MinimapComponent] Computed viewBox:', this.viewBox());
    });
  }

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  /** Bounding box of the entire graph in scene space. */
  readonly contentRect = input<GraphRect | null>(null);

  /** Bounding box of what's currently visible in the main viewport in scene space. */
  readonly viewportRect = input<GraphRect | null>(null);

  /** List of graph nodes with their coordinates and status classes. */
  readonly nodes = input<MinimapNodeRect[]>([]);

  /** Emits a scene-space point when the user clicks or drags on the minimap. */
  readonly jump = output<{ x: number; y: number }>();

  protected readonly panelWidth = MINIMAP_WIDTH_PX;
  protected readonly panelHeight = MINIMAP_HEIGHT_PX;

  /** Dynamic SVG viewBox computed from the graph's content size and padding. */
  protected readonly viewBox = computed(() => {
    const rect = this.contentRect();
    if (!rect) return null;
    const pad = MINIMAP_VIEWBOX_PADDING_PX;
    return `${rect.x - pad} ${rect.y - pad} ${rect.width + pad * 2} ${rect.height + pad * 2}`;
  });

  /** Clamps node rect sizes to a minimum threshold so they stay visible as dots when zoomed out. */
  protected readonly nodeRects = computed(() =>
    this.nodes().map((node) => ({
      id: node.id,
      className: node.className,
      x: node.rect.x,
      y: node.rect.y,
      width: Math.max(node.rect.width, MINIMAP_NODE_MIN_SIZE_PX),
      height: Math.max(node.rect.height, MINIMAP_NODE_MIN_SIZE_PX),
    }))
  );

  private isPointerDown = false;
  private moveUpdatePending = false;
  private pendingMoveClient: { x: number; y: number } | null = null;

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return; // Only respond to primary click
    this.isPointerDown = true;
    this.svgRef().nativeElement.setPointerCapture?.(event.pointerId);
    this.emitJumpFromClient(event.clientX, event.clientY);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.isPointerDown) return;

    this.pendingMoveClient = { x: event.clientX, y: event.clientY };
    if (this.moveUpdatePending) return;

    this.moveUpdatePending = true;
    requestAnimationFrame(() => {
      this.moveUpdatePending = false;
      if (this.pendingMoveClient) {
        this.emitJumpFromClient(this.pendingMoveClient.x, this.pendingMoveClient.y);
      }
    });
  }

  protected onPointerUp(event: PointerEvent): void {
    this.isPointerDown = false;
    this.pendingMoveClient = null;
    this.svgRef().nativeElement.releasePointerCapture?.(event.pointerId);
  }

  /** Converts screen client coordinates to scene space using the SVG's CTM. */
  private emitJumpFromClient(clientX: number, clientY: number): void {
    const svg = this.svgRef().nativeElement;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    
    const scenePoint = point.matrixTransform(ctm.inverse());
    this.jump.emit({ x: scenePoint.x, y: scenePoint.y });
  }
}
