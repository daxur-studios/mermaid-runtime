import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Camera transform state shared with consumers.
 *
 * Value: A single source of truth for pan (`x`, `y` in viewport pixels) and
 * `scale`, so the parent can persist or restore the view without reaching into
 * the DOM.
 */
export interface GraphCameraState {
  x: number;
  y: number;
  scale: number;
}

/**
 * A rectangle in scene/world coordinates (pre-transform, scale 1).
 *
 * Value: Lets graph-aware callers ask the camera to frame an arbitrary region
 * (e.g. the union box of running nodes) without knowing the current transform.
 */
export interface GraphRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lowest allowed camera zoom; stops the scene shrinking to an unreadable dot. */
const MIN_CAMERA_ZOOM = 0.1;

/** Highest allowed camera zoom; stops a single node filling the whole viewport. */
const MAX_CAMERA_ZOOM = 4;

/**
 * Wheel-zoom sensitivity. Scale factor per wheel event is `exp(-deltaY * k)`,
 * giving smooth, direction-correct, trackpad-friendly zoom toward the cursor.
 */
const ZOOM_WHEEL_SENSITIVITY = 0.0015;

/** Multiplicative zoom step for the on-screen +/- buttons (one click). */
const ZOOM_BUTTON_STEP = 1.2;

/**
 * Fraction of the viewport a framed rect should occupy, leaving margin so
 * framed content is never jammed against the edges.
 */
const FRAME_PADDING_FACTOR = 0.9;

/** Duration of an eased camera move (fit/frame), in milliseconds. */
const CAMERA_EASE_MS = 350;

/**
 * Pointer travel (px) before a press becomes a pan. Below this a press stays a
 * click, so node selection inside the projected content keeps working.
 */
const PAN_START_THRESHOLD_PX = 3;

/** Linear interpolation between two values. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Ease-in-out cubic, for camera moves that accelerate then settle. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Whether a press target carries selectable text (SVG `<text>`/`<tspan>` or an
 * HTML label inside `<foreignObject>`). Such presses should select text rather
 * than start a pan. Generic to SVG content — not coupled to any renderer.
 */
function isTextSelectionTarget(target: Element): boolean {
  return target.closest('text, tspan, foreignObject') !== null;
}

/**
 * Generic pan / zoom / frame camera around arbitrary projected content.
 *
 * PURPOSE: Wrap any SVG or DOM (here, a Mermaid render) in a viewport whose
 * single CSS transform the camera owns — wheel-zoom-to-cursor, drag-pan,
 * fit-all, and imperative `frameRect()` for follow-execution.
 *
 * VALUE: Content-agnostic and dependency-free. It knows nothing about task
 * graphs or Mermaid, so the same camera serves any future graph viewer while
 * the graph-aware logic (node → bounding box, follow rules) lives in the parent.
 */
@Component({
  selector: 'app-graph-camera',
  templateUrl: './graph-camera.component.html',
  styleUrl: './graph-camera.component.scss',
  host: { class: 'app-graph-camera' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphCameraComponent {
  private readonly destroyRef = inject(DestroyRef);

  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly sceneRef = viewChild.required<ElementRef<HTMLElement>>('scene');

  /** Emits the current transform whenever the camera moves (pan, zoom, frame). */
  readonly cameraChange = output<GraphCameraState>();

  /**
   * Emits when the user manually pans or zooms. The parent uses this to pause
   * follow-execution and reveal a re-center control.
   */
  readonly userInteract = output<void>();

  private readonly camera = signal<GraphCameraState>({ x: 0, y: 0, scale: 1 });

  protected readonly sceneTransform = computed(() => {
    const { x, y, scale } = this.camera();
    return `translate(${x}px, ${y}px) scale(${scale})`;
  });

  protected readonly isPanning = signal(false);
  protected readonly isAnimating = signal(false);

  /**
   * True only while the user pans/zooms or a camera move animates.
   *
   * Value: Drives a temporary `will-change: transform`. When idle the hint is
   * removed so the browser re-rasterizes the SVG at the displayed scale (crisp
   * when zoomed in) instead of scaling a cached bitmap (blurry).
   */
  protected readonly isInteracting = computed(() => this.isPanning() || this.isAnimating());

  private pointerStart: { x: number; y: number } | null = null;
  private cameraAtPointerStart: GraphCameraState | null = null;
  private activePointerId: number | null = null;
  private animationFrameId: number | null = null;

  constructor() {
    effect(() => this.cameraChange.emit(this.camera()));
    this.destroyRef.onDestroy(() => this.cancelCameraAnimation());
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.cancelCameraAnimation();
    this.userInteract.emit();

    const viewport = this.viewportRef().nativeElement.getBoundingClientRect();
    const pointerX = event.clientX - viewport.left;
    const pointerY = event.clientY - viewport.top;
    const factor = Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY);
    this.zoomAtPoint(factor, pointerX, pointerY);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    // A press that begins on text starts a native selection, not a pan, so the
    // two share-the-same-motion gestures stay distinguishable by where they begin.
    if (event.target instanceof Element && isTextSelectionTarget(event.target)) return;
    this.pointerStart = { x: event.clientX, y: event.clientY };
    this.cameraAtPointerStart = this.camera();
    this.activePointerId = event.pointerId;
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.pointerStart === null || this.cameraAtPointerStart === null) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;

    if (!this.isPanning()) {
      if (Math.hypot(dx, dy) < PAN_START_THRESHOLD_PX) return;
      this.beginPan(event);
    }

    this.camera.set({
      x: this.cameraAtPointerStart.x + dx,
      y: this.cameraAtPointerStart.y + dy,
      scale: this.cameraAtPointerStart.scale,
    });
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.activePointerId !== null) {
      this.viewportRef().nativeElement.releasePointerCapture?.(this.activePointerId);
    }
    this.pointerStart = null;
    this.cameraAtPointerStart = null;
    this.activePointerId = null;
    this.isPanning.set(false);
  }

  protected zoomIn(): void {
    this.zoomFromCenter(ZOOM_BUTTON_STEP);
  }

  protected zoomOut(): void {
    this.zoomFromCenter(1 / ZOOM_BUTTON_STEP);
  }

  /** Reset to the identity transform (top-left, no zoom). */
  reset(): void {
    this.animateCameraTo({ x: 0, y: 0, scale: 1 });
  }

  /** Frame the whole projected content so all of it is visible. */
  fitAll(): void {
    const naturalRect = this.measureContentRect();
    if (naturalRect) this.frameRect(naturalRect);
  }

  /**
   * Frame a scene-space rectangle, centering it at a comfortable zoom.
   * `maxScale` lets callers cap zoom-in (e.g. a single-node floor for follow).
   */
  frameRect(rect: GraphRect, options?: { maxScale?: number; animate?: boolean }): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    const viewport = this.viewportRef().nativeElement.getBoundingClientRect();
    if (viewport.width === 0 || viewport.height === 0) return;

    const maxScale = Math.min(MAX_CAMERA_ZOOM, options?.maxScale ?? MAX_CAMERA_ZOOM);
    const scale = clamp(
      Math.min(viewport.width / rect.width, viewport.height / rect.height) * FRAME_PADDING_FACTOR,
      MIN_CAMERA_ZOOM,
      maxScale,
    );
    const target: GraphCameraState = {
      x: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
      y: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
      scale,
    };

    if (options?.animate === false) {
      this.cancelCameraAnimation();
      this.camera.set(target);
    } else {
      this.animateCameraTo(target);
    }
  }

  /**
   * Union bounds of a set of on-screen elements, in scene coordinates.
   *
   * Value: The returned rect is in scene space, so it is invariant to the
   * camera's current pan/zoom (even mid-animation). A caller can poll this to
   * detect when projected content (e.g. an async Mermaid render) has finished
   * laying out before moving the camera, avoiding a jump to a stale position.
   */
  measureElementsRect(elements: Iterable<Element>): GraphRect | null {
    const sceneRect = this.sceneRef().nativeElement.getBoundingClientRect();
    const scale = this.camera().scale;
    if (scale === 0) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let count = 0;

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const x = (rect.left - sceneRect.left) / scale;
      const y = (rect.top - sceneRect.top) / scale;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + rect.width / scale);
      maxY = Math.max(maxY, y + rect.height / scale);
      count++;
    }

    if (count === 0) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Frame the union of a set of on-screen elements (e.g. the running nodes).
   *
   * Value: Convenience wrapper over `measureElementsRect` + `frameRect` for
   * callers that don't need the intermediate measurement.
   */
  frameElements(elements: Iterable<Element>, options?: { maxScale?: number; animate?: boolean }): void {
    const rect = this.measureElementsRect(elements);
    if (rect) this.frameRect(rect, options);
  }

  private beginPan(event: PointerEvent): void {
    this.isPanning.set(true);
    this.userInteract.emit();
    // Drop any text selection started in the few px before the pan threshold.
    window.getSelection()?.removeAllRanges();
    this.viewportRef().nativeElement.setPointerCapture?.(event.pointerId);
  }

  private zoomFromCenter(factor: number): void {
    this.cancelCameraAnimation();
    this.userInteract.emit();
    const viewport = this.viewportRef().nativeElement.getBoundingClientRect();
    this.zoomAtPoint(factor, viewport.width / 2, viewport.height / 2);
  }

  /** Scale by `factor` while keeping the world point under (px, py) fixed. */
  private zoomAtPoint(factor: number, px: number, py: number): void {
    const current = this.camera();
    const nextScale = clamp(current.scale * factor, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
    if (nextScale === current.scale) return;
    const worldX = (px - current.x) / current.scale;
    const worldY = (py - current.y) / current.scale;
    this.camera.set({
      x: px - worldX * nextScale,
      y: py - worldY * nextScale,
      scale: nextScale,
    });
  }

  /** Natural (scale-1) bounds of the projected content, in scene coordinates. */
  private measureContentRect(): GraphRect | null {
    const sceneEl = this.sceneRef().nativeElement;
    const scale = this.camera().scale;
    const rect = sceneEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || scale === 0) return null;
    return { x: 0, y: 0, width: rect.width / scale, height: rect.height / scale };
  }

  private animateCameraTo(target: GraphCameraState): void {
    this.cancelCameraAnimation();
    const start = this.camera();
    // Clock starts on the FIRST painted frame, not at call time. If a heavy task
    // (e.g. a Mermaid re-render) blocks the main thread between this call and the
    // first rAF tick, a call-time clock would already read t≈1 and snap the
    // camera to the target (a teleport) instead of easing to it.
    let startTime: number | null = null;
    this.isAnimating.set(true);
    const step = (now: number) => {
      if (startTime === null) startTime = now;
      const t = Math.min(1, (now - startTime) / CAMERA_EASE_MS);
      const eased = easeInOutCubic(t);
      this.camera.set({
        x: lerp(start.x, target.x, eased),
        y: lerp(start.y, target.y, eased),
        scale: lerp(start.scale, target.scale, eased),
      });
      if (t < 1) {
        this.animationFrameId = requestAnimationFrame(step);
      } else {
        this.animationFrameId = null;
        this.isAnimating.set(false);
      }
    };
    this.animationFrameId = requestAnimationFrame(step);
  }

  private cancelCameraAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isAnimating.set(false);
  }
}
