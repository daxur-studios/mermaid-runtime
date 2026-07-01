import * as i0 from '@angular/core';
import { inject, DestroyRef, viewChild, output, signal, computed, effect, ChangeDetectionStrategy, Component, ElementRef, input, untracked, InjectionToken } from '@angular/core';
import * as i3 from '@angular/common';
import { CommonModule } from '@angular/common';
import * as i1 from 'ngx-markdown';
import { MarkdownModule } from 'ngx-markdown';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as i1$1 from '@angular/material/icon';
import { MatIconModule } from '@angular/material/icon';
import * as i2 from '@angular/material/tooltip';
import { MatTooltipModule } from '@angular/material/tooltip';
import { from } from 'rxjs';

const _c0$1 = ["viewport"];
const _c1$1 = ["scene"];
const _c2 = ["*"];
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
function lerp(from, to, t) {
    return from + (to - from) * t;
}
/** Ease-in-out cubic, for camera moves that accelerate then settle. */
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/**
 * Whether a press target carries selectable text (SVG `<text>`/`<tspan>` or an
 * HTML label inside `<foreignObject>`). Such presses should select text rather
 * than start a pan. Generic to SVG content — not coupled to any renderer.
 */
function isTextSelectionTarget(target) {
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
class GraphCameraComponent {
    constructor() {
        this.destroyRef = inject(DestroyRef);
        this.viewportRef = viewChild.required('viewport');
        this.sceneRef = viewChild.required('scene');
        /** Emits the current transform whenever the camera moves (pan, zoom, frame). */
        this.cameraChange = output();
        /**
         * Emits when the user manually pans or zooms. The parent uses this to pause
         * follow-execution and reveal a re-center control.
         */
        this.userInteract = output();
        this.camera = signal({ x: 0, y: 0, scale: 1 }, ...(ngDevMode ? [{ debugName: "camera" }] : []));
        this.sceneTransform = computed(() => {
            const { x, y, scale } = this.camera();
            return `translate(${x}px, ${y}px) scale(${scale})`;
        }, ...(ngDevMode ? [{ debugName: "sceneTransform" }] : []));
        this.isPanning = signal(false, ...(ngDevMode ? [{ debugName: "isPanning" }] : []));
        this.isAnimating = signal(false, ...(ngDevMode ? [{ debugName: "isAnimating" }] : []));
        /**
         * True only while the user pans/zooms or a camera move animates.
         *
         * Value: Drives a temporary `will-change: transform`. When idle the hint is
         * removed so the browser re-rasterizes the SVG at the displayed scale (crisp
         * when zoomed in) instead of scaling a cached bitmap (blurry).
         */
        this.isInteracting = computed(() => this.isPanning() || this.isAnimating(), ...(ngDevMode ? [{ debugName: "isInteracting" }] : []));
        this.pointerStart = null;
        this.cameraAtPointerStart = null;
        this.activePointerId = null;
        this.animationFrameId = null;
        effect(() => this.cameraChange.emit(this.camera()));
        this.destroyRef.onDestroy(() => this.cancelCameraAnimation());
    }
    onWheel(event) {
        event.preventDefault();
        this.cancelCameraAnimation();
        this.userInteract.emit();
        const viewport = this.viewportRef().nativeElement.getBoundingClientRect();
        const pointerX = event.clientX - viewport.left;
        const pointerY = event.clientY - viewport.top;
        const factor = Math.exp(-event.deltaY * ZOOM_WHEEL_SENSITIVITY);
        this.zoomAtPoint(factor, pointerX, pointerY);
    }
    onPointerDown(event) {
        if (event.button !== 0)
            return;
        // A press that begins on text starts a native selection, not a pan, so the
        // two share-the-same-motion gestures stay distinguishable by where they begin.
        if (event.target instanceof Element && isTextSelectionTarget(event.target))
            return;
        this.pointerStart = { x: event.clientX, y: event.clientY };
        this.cameraAtPointerStart = this.camera();
        this.activePointerId = event.pointerId;
    }
    onPointerMove(event) {
        if (this.pointerStart === null || this.cameraAtPointerStart === null)
            return;
        const dx = event.clientX - this.pointerStart.x;
        const dy = event.clientY - this.pointerStart.y;
        if (!this.isPanning()) {
            if (Math.hypot(dx, dy) < PAN_START_THRESHOLD_PX)
                return;
            this.beginPan(event);
        }
        this.camera.set({
            x: this.cameraAtPointerStart.x + dx,
            y: this.cameraAtPointerStart.y + dy,
            scale: this.cameraAtPointerStart.scale,
        });
    }
    onPointerUp(event) {
        if (this.activePointerId !== null) {
            this.viewportRef().nativeElement.releasePointerCapture?.(this.activePointerId);
        }
        this.pointerStart = null;
        this.cameraAtPointerStart = null;
        this.activePointerId = null;
        this.isPanning.set(false);
    }
    zoomIn() {
        this.zoomFromCenter(ZOOM_BUTTON_STEP);
    }
    zoomOut() {
        this.zoomFromCenter(1 / ZOOM_BUTTON_STEP);
    }
    /** Reset to the identity transform (top-left, no zoom). */
    reset() {
        this.animateCameraTo({ x: 0, y: 0, scale: 1 });
    }
    /** Frame the whole projected content so all of it is visible. */
    fitAll() {
        const naturalRect = this.measureContentRect();
        if (naturalRect)
            this.frameRect(naturalRect);
    }
    /**
     * Frame a scene-space rectangle, centering it at a comfortable zoom.
     * `maxScale` lets callers cap zoom-in (e.g. a single-node floor for follow).
     */
    frameRect(rect, options) {
        if (rect.width <= 0 || rect.height <= 0)
            return;
        const viewport = this.viewportRef().nativeElement.getBoundingClientRect();
        if (viewport.width === 0 || viewport.height === 0)
            return;
        const maxScale = Math.min(MAX_CAMERA_ZOOM, options?.maxScale ?? MAX_CAMERA_ZOOM);
        const scale = clamp(Math.min(viewport.width / rect.width, viewport.height / rect.height) * FRAME_PADDING_FACTOR, MIN_CAMERA_ZOOM, maxScale);
        const target = {
            x: viewport.width / 2 - (rect.x + rect.width / 2) * scale,
            y: viewport.height / 2 - (rect.y + rect.height / 2) * scale,
            scale,
        };
        if (options?.animate === false) {
            this.cancelCameraAnimation();
            this.camera.set(target);
        }
        else {
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
    measureElementsRect(elements) {
        const sceneRect = this.sceneRef().nativeElement.getBoundingClientRect();
        const scale = this.camera().scale;
        if (scale === 0)
            return null;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let count = 0;
        for (const element of elements) {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0)
                continue;
            const x = (rect.left - sceneRect.left) / scale;
            const y = (rect.top - sceneRect.top) / scale;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + rect.width / scale);
            maxY = Math.max(maxY, y + rect.height / scale);
            count++;
        }
        if (count === 0)
            return null;
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    /**
     * Frame the union of a set of on-screen elements (e.g. the running nodes).
     *
     * Value: Convenience wrapper over `measureElementsRect` + `frameRect` for
     * callers that don't need the intermediate measurement.
     */
    frameElements(elements, options) {
        const rect = this.measureElementsRect(elements);
        if (rect)
            this.frameRect(rect, options);
    }
    beginPan(event) {
        this.isPanning.set(true);
        this.userInteract.emit();
        // Drop any text selection started in the few px before the pan threshold.
        window.getSelection()?.removeAllRanges();
        this.viewportRef().nativeElement.setPointerCapture?.(event.pointerId);
    }
    zoomFromCenter(factor) {
        this.cancelCameraAnimation();
        this.userInteract.emit();
        const viewport = this.viewportRef().nativeElement.getBoundingClientRect();
        this.zoomAtPoint(factor, viewport.width / 2, viewport.height / 2);
    }
    /** Scale by `factor` while keeping the world point under (px, py) fixed. */
    zoomAtPoint(factor, px, py) {
        const current = this.camera();
        const nextScale = clamp(current.scale * factor, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
        if (nextScale === current.scale)
            return;
        const worldX = (px - current.x) / current.scale;
        const worldY = (py - current.y) / current.scale;
        this.camera.set({
            x: px - worldX * nextScale,
            y: py - worldY * nextScale,
            scale: nextScale,
        });
    }
    /** Natural (scale-1) bounds of the projected content, in scene coordinates. */
    measureContentRect() {
        const sceneEl = this.sceneRef().nativeElement;
        const scale = this.camera().scale;
        const rect = sceneEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || scale === 0)
            return null;
        return { x: 0, y: 0, width: rect.width / scale, height: rect.height / scale };
    }
    animateCameraTo(target) {
        this.cancelCameraAnimation();
        const start = this.camera();
        // Clock starts on the FIRST painted frame, not at call time. If a heavy task
        // (e.g. a Mermaid re-render) blocks the main thread between this call and the
        // first rAF tick, a call-time clock would already read t≈1 and snap the
        // camera to the target (a teleport) instead of easing to it.
        let startTime = null;
        this.isAnimating.set(true);
        const step = (now) => {
            if (startTime === null)
                startTime = now;
            const t = Math.min(1, (now - startTime) / CAMERA_EASE_MS);
            const eased = easeInOutCubic(t);
            this.camera.set({
                x: lerp(start.x, target.x, eased),
                y: lerp(start.y, target.y, eased),
                scale: lerp(start.scale, target.scale, eased),
            });
            if (t < 1) {
                this.animationFrameId = requestAnimationFrame(step);
            }
            else {
                this.animationFrameId = null;
                this.isAnimating.set(false);
            }
        };
        this.animationFrameId = requestAnimationFrame(step);
    }
    cancelCameraAnimation() {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.isAnimating.set(false);
    }
    static { this.ɵfac = function GraphCameraComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || GraphCameraComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: GraphCameraComponent, selectors: [["app-graph-camera"]], viewQuery: function GraphCameraComponent_Query(rf, ctx) { if (rf & 1) {
            i0.ɵɵviewQuerySignal(ctx.viewportRef, _c0$1, 5);
            i0.ɵɵviewQuerySignal(ctx.sceneRef, _c1$1, 5);
        } if (rf & 2) {
            i0.ɵɵqueryAdvance(2);
        } }, hostAttrs: [1, "app-graph-camera"], outputs: { cameraChange: "cameraChange", userInteract: "userInteract" }, ngContentSelectors: _c2, decls: 14, vars: 6, consts: [["viewport", ""], ["scene", ""], [1, "graph-camera__viewport", 3, "wheel", "pointerdown", "pointermove", "pointerup", "pointercancel"], [1, "graph-camera__scene"], [1, "graph-camera__controls"], ["type", "button", "title", "Zoom in", 1, "graph-camera__btn", 3, "click"], ["type", "button", "title", "Zoom out", 1, "graph-camera__btn", 3, "click"], ["type", "button", "title", "Fit all", 1, "graph-camera__btn", 3, "click"], ["type", "button", "title", "Reset view", 1, "graph-camera__btn", 3, "click"]], template: function GraphCameraComponent_Template(rf, ctx) { if (rf & 1) {
            const _r1 = i0.ɵɵgetCurrentView();
            i0.ɵɵprojectionDef();
            i0.ɵɵdomElementStart(0, "div", 2, 0);
            i0.ɵɵdomListener("wheel", function GraphCameraComponent_Template_div_wheel_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.onWheel($event)); })("pointerdown", function GraphCameraComponent_Template_div_pointerdown_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.onPointerDown($event)); })("pointermove", function GraphCameraComponent_Template_div_pointermove_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.onPointerMove($event)); })("pointerup", function GraphCameraComponent_Template_div_pointerup_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.onPointerUp($event)); })("pointercancel", function GraphCameraComponent_Template_div_pointercancel_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.onPointerUp($event)); });
            i0.ɵɵdomElementStart(2, "div", 3, 1);
            i0.ɵɵprojection(4);
            i0.ɵɵdomElementEnd()();
            i0.ɵɵdomElementStart(5, "div", 4)(6, "button", 5);
            i0.ɵɵdomListener("click", function GraphCameraComponent_Template_button_click_6_listener() { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.zoomIn()); });
            i0.ɵɵtext(7, "+");
            i0.ɵɵdomElementEnd();
            i0.ɵɵdomElementStart(8, "button", 6);
            i0.ɵɵdomListener("click", function GraphCameraComponent_Template_button_click_8_listener() { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.zoomOut()); });
            i0.ɵɵtext(9, "\u2212");
            i0.ɵɵdomElementEnd();
            i0.ɵɵdomElementStart(10, "button", 7);
            i0.ɵɵdomListener("click", function GraphCameraComponent_Template_button_click_10_listener() { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.fitAll()); });
            i0.ɵɵtext(11, "Fit");
            i0.ɵɵdomElementEnd();
            i0.ɵɵdomElementStart(12, "button", 8);
            i0.ɵɵdomListener("click", function GraphCameraComponent_Template_button_click_12_listener() { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.reset()); });
            i0.ɵɵtext(13, "Reset");
            i0.ɵɵdomElementEnd()();
        } if (rf & 2) {
            i0.ɵɵclassProp("graph-camera__viewport--panning", ctx.isPanning());
            i0.ɵɵadvance(2);
            i0.ɵɵstyleProp("transform", ctx.sceneTransform());
            i0.ɵɵclassProp("graph-camera__scene--interacting", ctx.isInteracting());
        } }, styles: ["[_nghost-%COMP%]{position:relative;display:block;width:100%;height:100%;overflow:hidden}.graph-camera__viewport[_ngcontent-%COMP%]{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none}.graph-camera__viewport--panning[_ngcontent-%COMP%]{cursor:grabbing;user-select:none;-webkit-user-select:none}.graph-camera__scene[_ngcontent-%COMP%]{position:absolute;top:0;left:0;transform-origin:0 0;width:max-content;height:max-content}.graph-camera__scene--interacting[_ngcontent-%COMP%]{will-change:transform}.graph-camera__controls[_ngcontent-%COMP%]{position:absolute;right:12px;bottom:12px;z-index:1;display:flex;gap:6px;padding:4px;border-radius:8px;background:var(--mat-sys-surface-container-high);border:1px solid var(--mat-sys-outline-variant)}.graph-camera__btn[_ngcontent-%COMP%]{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:28px;padding:0 8px;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface-container);color:var(--mat-sys-on-surface);font-size:.8rem;line-height:1;cursor:pointer}.graph-camera__btn[_ngcontent-%COMP%]:hover{background:#ffffff0f}.graph-camera__btn[_ngcontent-%COMP%]:active{background:#ffffff1a}"], changeDetection: 0 }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(GraphCameraComponent, [{
        type: Component,
        args: [{ selector: 'app-graph-camera', host: { class: 'app-graph-camera' }, changeDetection: ChangeDetectionStrategy.OnPush, template: "<div\n  #viewport\n  class=\"graph-camera__viewport\"\n  [class.graph-camera__viewport--panning]=\"isPanning()\"\n  (wheel)=\"onWheel($event)\"\n  (pointerdown)=\"onPointerDown($event)\"\n  (pointermove)=\"onPointerMove($event)\"\n  (pointerup)=\"onPointerUp($event)\"\n  (pointercancel)=\"onPointerUp($event)\"\n>\n  <div\n    #scene\n    class=\"graph-camera__scene\"\n    [class.graph-camera__scene--interacting]=\"isInteracting()\"\n    [style.transform]=\"sceneTransform()\"\n  >\n    <ng-content />\n  </div>\n</div>\n\n<div class=\"graph-camera__controls\">\n  <button type=\"button\" class=\"graph-camera__btn\" title=\"Zoom in\" (click)=\"zoomIn()\">+</button>\n  <button type=\"button\" class=\"graph-camera__btn\" title=\"Zoom out\" (click)=\"zoomOut()\">&minus;</button>\n  <button type=\"button\" class=\"graph-camera__btn\" title=\"Fit all\" (click)=\"fitAll()\">Fit</button>\n  <button type=\"button\" class=\"graph-camera__btn\" title=\"Reset view\" (click)=\"reset()\">Reset</button>\n</div>\n", styles: [":host{position:relative;display:block;width:100%;height:100%;overflow:hidden}.graph-camera__viewport{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none}.graph-camera__viewport--panning{cursor:grabbing;user-select:none;-webkit-user-select:none}.graph-camera__scene{position:absolute;top:0;left:0;transform-origin:0 0;width:max-content;height:max-content}.graph-camera__scene--interacting{will-change:transform}.graph-camera__controls{position:absolute;right:12px;bottom:12px;z-index:1;display:flex;gap:6px;padding:4px;border-radius:8px;background:var(--mat-sys-surface-container-high);border:1px solid var(--mat-sys-outline-variant)}.graph-camera__btn{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:28px;padding:0 8px;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface-container);color:var(--mat-sys-on-surface);font-size:.8rem;line-height:1;cursor:pointer}.graph-camera__btn:hover{background:#ffffff0f}.graph-camera__btn:active{background:#ffffff1a}\n"] }]
    }], () => [], { viewportRef: [{ type: i0.ViewChild, args: ['viewport', { isSignal: true }] }], sceneRef: [{ type: i0.ViewChild, args: ['scene', { isSignal: true }] }], cameraChange: [{ type: i0.Output, args: ["cameraChange"] }], userInteract: [{ type: i0.Output, args: ["userInteract"] }] }); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(GraphCameraComponent, { className: "GraphCameraComponent", filePath: "lib/graph-camera/graph-camera.component.ts", lineNumber: 111 }); })();

const _c0 = [[["", "overlay", ""]], [["", "detail", ""]]];
const _c1 = ["[overlay]", "[detail]"];
const _forTrack0$1 = ($index, $item) => $item.depth;
function GraphCanvasComponent_Conditional_4_Template(rf, ctx) { if (rf & 1) {
    const _r1 = i0.ɵɵgetCurrentView();
    i0.ɵɵelementStart(0, "button", 6);
    i0.ɵɵlistener("click", function GraphCanvasComponent_Conditional_4_Template_button_click_0_listener() { i0.ɵɵrestoreView(_r1); const ctx_r1 = i0.ɵɵnextContext(); return i0.ɵɵresetView(ctx_r1.resumeFollow()); });
    i0.ɵɵtext(1, " Re-center on running ");
    i0.ɵɵelementEnd();
} }
function GraphCanvasComponent_Conditional_5_For_2_Conditional_2_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "span", 8);
    i0.ɵɵtext(1, "\u203A");
    i0.ɵɵelementEnd();
} }
function GraphCanvasComponent_Conditional_5_For_2_Template(rf, ctx) { if (rf & 1) {
    const _r3 = i0.ɵɵgetCurrentView();
    i0.ɵɵelementStart(0, "button", 7);
    i0.ɵɵlistener("click", function GraphCanvasComponent_Conditional_5_For_2_Template_button_click_0_listener() { const crumb_r4 = i0.ɵɵrestoreView(_r3).$implicit; const ctx_r1 = i0.ɵɵnextContext(2); return i0.ɵɵresetView(ctx_r1.goToDepth(crumb_r4.depth)); });
    i0.ɵɵtext(1);
    i0.ɵɵelementEnd();
    i0.ɵɵconditionalCreate(2, GraphCanvasComponent_Conditional_5_For_2_Conditional_2_Template, 2, 0, "span", 8);
} if (rf & 2) {
    const crumb_r4 = ctx.$implicit;
    const ɵ$index_16_r5 = ctx.$index;
    const ɵ$count_16_r6 = ctx.$count;
    i0.ɵɵclassProp("graph-canvas__crumb--current", ɵ$index_16_r5 === ɵ$count_16_r6 - 1);
    i0.ɵɵproperty("disabled", ɵ$index_16_r5 === ɵ$count_16_r6 - 1);
    i0.ɵɵadvance();
    i0.ɵɵtextInterpolate1(" ", crumb_r4.label, " ");
    i0.ɵɵadvance();
    i0.ɵɵconditional(!(ɵ$index_16_r5 === ɵ$count_16_r6 - 1) ? 2 : -1);
} }
function GraphCanvasComponent_Conditional_5_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "nav", 5);
    i0.ɵɵrepeaterCreate(1, GraphCanvasComponent_Conditional_5_For_2_Template, 3, 5, null, null, _forTrack0$1);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const ctx_r1 = i0.ɵɵnextContext();
    i0.ɵɵadvance();
    i0.ɵɵrepeater(ctx_r1.breadcrumb());
} }
/** Query parameter used to encode the real node id in Mermaid click hrefs. */
const NODE_HREF_PARAM = 'node';
/**
 * Built-in status → visual-treatment map, merged under any host `statusStyles`.
 *
 * PURPOSE: Give the five daemon-default states their colours while keeping status
 * styling out of the Mermaid source (applied as DOM classes after render).
 *
 * VALUE: Status changes update the rendered DOM in place — Mermaid never tears
 * down and rebuilds the SVG for a running/done/failed transition — and a host can
 * override or extend this map without forking the component.
 */
const DEFAULT_STATUS_STYLES = {
    running: { className: 'running', label: 'Running' },
    complete: { className: 'done', label: 'Complete' },
    failed: { className: 'failed', label: 'Failed' },
    skipped: { className: 'skipped', label: 'Skipped' },
};
/**
 * CSS class marking the live "current" focus node.
 *
 * VALUE: Kept separate from status classes so the focus highlight and the
 * execution colour are applied and stripped independently.
 */
const CURRENT_NODE_CLASS = 'current';
/**
 * CSS class marking a node the user can drill into (it resolves to a subgraph).
 *
 * VALUE: Lets the stylesheet flag drillable nodes (badge/affordance) without the
 * host having to decorate them.
 */
const HAS_SUBGRAPH_CLASS = 'has-subgraph';
/**
 * Zoom cap when follow-execution frames the running nodes.
 *
 * Value: Keeps the camera from snapping uncomfortably close to one or two
 * nodes — "not too far, not too close" — while `frameRect` padding handles the
 * lower bound for larger running sets.
 */
const FOLLOW_MAX_ZOOM = 1.4;
/**
 * Lowest valid percentage shown in a task graph node progress bar.
 *
 * PURPOSE: Clamp malformed task-run node progress before it reaches Mermaid.
 *
 * VALUE: Progress bars never render negative values.
 */
const TASK_GRAPH_PROGRESS_MIN_PERCENT = 0;
/**
 * Highest valid percentage shown in a task graph node progress bar.
 *
 * PURPOSE: Keep task-run node progress inside the browser progress element's
 * expected range.
 *
 * VALUE: Node labels and inspector bars share the same 0-100 scale.
 */
const TASK_GRAPH_PROGRESS_MAX_PERCENT = 100;
/**
 * Most subgraph child nodes drawn in a node's inline mini-preview.
 *
 * PURPOSE: Keep the decorative thumbnail small and cheap regardless of how large
 * a child graph is.
 *
 * VALUE: Bounds the rendered SVG; any overflow is summarised as a "+N" marker.
 */
const SUBGRAPH_PREVIEW_MAX_NODES = 10;
/** Dot radius (px) for a node in the inline subgraph mini-preview. */
const SUBGRAPH_PREVIEW_DOT_RADIUS_PX = 2.4;
/** Horizontal gap (px) between dependency columns in the subgraph mini-preview. */
const SUBGRAPH_PREVIEW_COLUMN_GAP_PX = 13;
/** Vertical gap (px) between sibling rows in a subgraph mini-preview column. */
const SUBGRAPH_PREVIEW_ROW_GAP_PX = 9;
/** Outer padding (px) around the subgraph mini-preview drawing. */
const SUBGRAPH_PREVIEW_PADDING_PX = 5;
/** Extra width (px) reserved for the "+N" overflow marker in the mini-preview. */
const SUBGRAPH_PREVIEW_OVERFLOW_LABEL_WIDTH_PX = 16;
/**
 * Default Mermaid render configuration for the task graph.
 *
 * Value: Dark theme to match the app, `loose` security so click hrefs render
 * as anchors we can intercept, and a smooth flowchart curve.
 */
const DEFAULT_MERMAID_OPTIONS = {
    theme: 'dark',
    startOnLoad: true,
    securityLevel: 'loose',
    flowchart: {
        // The camera owns sizing/zoom. `useMaxWidth: false` gives the SVG a fixed
        // intrinsic size so a re-render (status change) never re-fits it to the
        // container and fights the current zoom — text stays the right size.
        useMaxWidth: false,
        htmlLabels: true,
        curve: 'basis',
    },
};
/**
 * Interactive Mermaid graph canvas — the rendering + interaction core.
 *
 * PURPOSE: Render any `MermaidRuntime.Node[]` (+ transitions) as a status-coloured,
 * clickable flowchart inside a pan/zoom camera, with progress bars, follow, and
 * nested-subgraph navigation. It owns selection/navigation state and exposes it,
 * but renders no inspector or toolbar chrome itself.
 *
 * VALUE: The reusable product surface. A host projects its own chrome through the
 * `[overlay]` and `[detail]` slots and binds it to the canvas's exposed signals
 * (e.g. `selectedNode`, `selectedNodeHasSubgraph`) via a template ref — so every
 * project arranges its own layout while the interaction behaviour is shared.
 */
/**
 * Maximum time difference (ms) allowed between parallel execution parent node completions.
 *
 * VALUE: Ensures concurrent parent nodes in a parallel AND-join are both treated as triggering
 * the child node, while stale parents from older loop iterations are correctly filtered out.
 */
const PARALLEL_JOIN_THRESHOLD_MS = 3000;
/**
 * Duration (ms) that the node border pulse class remains active.
 *
 * VALUE: Matches the CSS transition duration so the class is removed exactly as the
 * visual animation completes.
 */
const NODE_PULSE_DURATION_MS = 500;
/**
 * Duration (ms) that the connection edge marching-ants pulse class remains active.
 *
 * VALUE: Matches the transition and animation timings so the edge settles into its
 * solid color state exactly as the pulse completes.
 */
const EDGE_PULSE_DURATION_MS = 1000;
class GraphCanvasComponent {
    constructor() {
        this.hostElement = inject((ElementRef));
        this.destroyRef = inject(DestroyRef);
        this.cameraRef = viewChild.required(GraphCameraComponent);
        /** Execution nodes to render. The host owns their lifecycle and status. */
        this.nodes = input.required(...(ngDevMode ? [{ debugName: "nodes" }] : []));
        /**
         * Runtime/story edges. When omitted, edges fall back to per-node
         * `transitions`, then to `dependencies` so a dependency-only graph still draws.
         */
        this.transitions = input(null, ...(ngDevMode ? [{ debugName: "transitions" }] : []));
        /** Currently selected node id (highlight only; host owns the value). */
        this.selectedNodeId = input(null, ...(ngDevMode ? [{ debugName: "selectedNodeId" }] : []));
        /** The node to mark as the live "current" focus, if any. */
        this.currentNodeId = input(null, ...(ngDevMode ? [{ debugName: "currentNodeId" }] : []));
        /** Per-node display overrides, keyed by real node id. */
        this.decorations = input({}, ...(ngDevMode ? [{ debugName: "decorations" }] : []));
        /**
         * Status → visual-treatment overrides, merged over {@link DEFAULT_STATUS_STYLES}.
         *
         * VALUE: A host defines its own status vocabulary/colours (and can add states
         * beyond the built-in five) without forking the component.
         */
        this.statusStyles = input({}, ...(ngDevMode ? [{ debugName: "statusStyles" }] : []));
        /** Breadcrumb label for the root (top-level) graph. */
        this.rootLabel = input('Main', ...(ngDevMode ? [{ debugName: "rootLabel" }] : []));
        /** Whether to render the breadcrumb overlay while inside a subgraph. */
        this.showBreadcrumb = input(true, ...(ngDevMode ? [{ debugName: "showBreadcrumb" }] : []));
        /**
         * Whether drillable nodes show a small, static thumbnail of their child graph.
         *
         * VALUE: A purely decorative hint that a node contains a subgraph (and its
         * rough shape); set false to drop it entirely with no other behaviour change.
         */
        this.showSubgraphPreview = input(true, ...(ngDevMode ? [{ debugName: "showSubgraphPreview" }] : []));
        /**
         * Whether a host has projected `[detail]` chrome — toggles the side column.
         *
         * VALUE: Lets the canvas reserve layout space for a projected inspector without
         * knowing what it is.
         */
        this.showDetail = input(false, ...(ngDevMode ? [{ debugName: "showDetail" }] : []));
        /**
         * Resolves a node's child graph. When omitted, the node's inline
         * `subgraph` is used.
         *
         * VALUE: Lets daemon-style hosts turn a `subgraphId` into a `Graph` lazily,
         * while inline-graph hosts need supply nothing.
         */
        this.subgraphResolver = input(null, ...(ngDevMode ? [{ debugName: "subgraphResolver" }] : []));
        /**
         * Externally-controlled subgraph path (root node ids drilled into).
         *
         * VALUE: The history seam — a host drives this from its router so browser
         * back/forward can restore the viewer's depth; the viewer reconciles its stack
         * to match and emits {@link graphPathChange} when the user navigates.
         */
        this.path = input([], ...(ngDevMode ? [{ debugName: "path" }] : []));
        /**
         * When true, the camera keeps the running ("green") nodes framed as the run
         * progresses. A manual pan/zoom pauses it until the host re-enables follow or
         * the user clicks the re-center chip.
         */
        this.followExecution = input(false, ...(ngDevMode ? [{ debugName: "followExecution" }] : []));
        /** Emits the real node id when a node is clicked. */
        this.nodeSelected = output();
        /** Emits when the user drills into a node's subgraph. */
        this.subgraphEntered = output();
        /** Emits when the user leaves a subgraph (one or more levels up). */
        this.subgraphLeft = output();
        /**
         * Emits the new root→current node-id path whenever the user enters or leaves a
         * subgraph.
         *
         * VALUE: The single output a host wires to its history (push on change, restore
         * via the {@link path} input on back/forward).
         */
        this.graphPathChange = output();
        this.mermaidOptions = DEFAULT_MERMAID_OPTIONS;
        this.internalSelectedNodeId = signal(null, ...(ngDevMode ? [{ debugName: "internalSelectedNodeId" }] : []));
        /**
         * Subgraph navigation stack. Empty = root graph; each frame is one level the
         * user has drilled into. The top frame decides what the viewer renders.
         */
        this.graphStack = signal([], ...(ngDevMode ? [{ debugName: "graphStack" }] : []));
        /** Nodes for the level currently shown — the root input, or the top frame. */
        this.activeNodes = computed(() => {
            const stack = this.graphStack();
            const top = stack[stack.length - 1];
            return top ? top.graph.nodes : this.nodes();
        }, ...(ngDevMode ? [{ debugName: "activeNodes" }] : []));
        /** Transitions for the level currently shown — the root input, or the top frame. */
        this.activeTransitions = computed(() => {
            const stack = this.graphStack();
            const top = stack[stack.length - 1];
            return top ? top.graph.transitions ?? null : this.transitions();
        }, ...(ngDevMode ? [{ debugName: "activeTransitions" }] : []));
        /** True while inside a subgraph (the stack is non-empty). */
        this.inSubgraph = computed(() => this.graphStack().length > 0, ...(ngDevMode ? [{ debugName: "inSubgraph" }] : []));
        /** Breadcrumb trail (root + each entered level); empty at the root graph. */
        this.breadcrumb = computed(() => {
            const stack = this.graphStack();
            if (stack.length === 0)
                return [];
            const crumbs = [{ label: this.rootLabel(), depth: 0 }];
            stack.forEach((frame, index) => crumbs.push({ label: frame.label, depth: index + 1 }));
            return crumbs;
        }, ...(ngDevMode ? [{ debugName: "breadcrumb" }] : []));
        /** Built-in status styles with any host `statusStyles` merged over them. */
        this.effectiveStatusStyles = computed(() => ({
            ...DEFAULT_STATUS_STYLES,
            ...this.statusStyles(),
        }), ...(ngDevMode ? [{ debugName: "effectiveStatusStyles" }] : []));
        /** Every CSS class the status map can apply — stripped before re-applying. */
        this.statusClassNames = computed(() => {
            const names = new Set();
            for (const style of Object.values(this.effectiveStatusStyles())) {
                if (style?.className)
                    names.add(style.className);
            }
            return [...names];
        }, ...(ngDevMode ? [{ debugName: "statusClassNames" }] : []));
        this.aliasMap = computed(() => this.buildAliasMap(this.activeNodes()), ...(ngDevMode ? [{ debugName: "aliasMap" }] : []));
        this.flowMarkdown = computed(() => `\`\`\`mermaid\n${this.buildGraph()}\n\`\`\``, ...(ngDevMode ? [{ debugName: "flowMarkdown" }] : []));
        this.effectiveSelectedNodeId = computed(() => {
            const nodes = this.activeNodes();
            return (this.selectedNodeId() ??
                this.internalSelectedNodeId() ??
                this.currentNodeId() ??
                nodes.find((node) => node.status === 'running')?.id ??
                nodes[0]?.id ??
                null);
        }, ...(ngDevMode ? [{ debugName: "effectiveSelectedNodeId" }] : []));
        /** The resolved selected node — exposed so projected chrome can render its detail. */
        this.selectedNode = computed(() => {
            const selectedId = this.effectiveSelectedNodeId();
            if (!selectedId)
                return null;
            return this.activeNodes().find((node) => node.id === selectedId) ?? null;
        }, ...(ngDevMode ? [{ debugName: "selectedNode" }] : []));
        /** Whether the selected node can be drilled into — exposed for the projected inspector. */
        this.selectedNodeHasSubgraph = computed(() => {
            const node = this.selectedNode();
            return !!node && !!this.resolveSubgraph(node);
        }, ...(ngDevMode ? [{ debugName: "selectedNodeHasSubgraph" }] : []));
        /** Ids of the currently running nodes, joined — drives follow re-framing. */
        this.runningKey = computed(() => this.activeNodes()
            .filter((node) => node.status === 'running')
            .map((node) => node.id)
            .join(','), ...(ngDevMode ? [{ debugName: "runningKey" }] : []));
        /** Joined `id:status` pairs — drives live status-class application (no re-render). */
        this.statusKey = computed(() => this.activeNodes()
            .map((node) => `${node.id}:${node.status}`)
            .join(','), ...(ngDevMode ? [{ debugName: "statusKey" }] : []));
        /** Joined node progress values — drives live progress-bar DOM updates. */
        this.progressKey = computed(() => this.activeNodes()
            .map((node) => `${node.id}:${node.progressPercent ?? ''}:${node.progressLabel ?? ''}`)
            .join(','), ...(ngDevMode ? [{ debugName: "progressKey" }] : []));
        /** Follow temporarily suspended after a manual pan/zoom. */
        this.followPaused = signal(false, ...(ngDevMode ? [{ debugName: "followPaused" }] : []));
        /** Follow is on and not paused — the camera should track the running nodes. */
        this.followActive = computed(() => this.followExecution() && !this.followPaused(), ...(ngDevMode ? [{ debugName: "followActive" }] : []));
        /** Whether to offer the "re-center" chip (follow on, but paused by the user). */
        this.showRecenterChip = computed(() => this.followExecution() && this.followPaused(), ...(ngDevMode ? [{ debugName: "showRecenterChip" }] : []));
        /** True once the first Mermaid node has rendered, so we fit the view once. */
        this.hasFitInitialView = false;
        /** Last seen `followExecution` value, to detect off→on (which resumes follow). */
        this.lastFollowOn = false;
        this.followFramePending = false;
        /**
         * Track previous status of each node.
         *
         * VALUE: Detects real-time state transitions so the component only pulses nodes
         * that changed state while the user is actively watching.
         */
        this.previousStatuses = new Map();
        const host = this.hostElement.nativeElement;
        const clickListener = (event) => this.handleChartClick(event);
        const dblClickListener = (event) => this.handleChartDblClick(event);
        const chartObserver = new MutationObserver(() => this.onChartMutation());
        host.addEventListener('click', clickListener, true);
        host.addEventListener('dblclick', dblClickListener, true);
        chartObserver.observe(host, { childList: true, subtree: true });
        this.destroyRef.onDestroy(() => {
            host.removeEventListener('click', clickListener, true);
            host.removeEventListener('dblclick', dblClickListener, true);
            chartObserver.disconnect();
        });
        effect(() => this.scheduleSelectedNodeClass(this.effectiveSelectedNodeId()));
        // Keep the navigation stack in sync with the host-controlled `path` input so
        // browser back/forward can restore subgraph depth. Reads only `path` (and the
        // resolver) tracked; the graph inputs are read untracked so replay status
        // ticks never rebuild the stack.
        effect(() => this.reconcileStackToPath(this.path()));
        // Status colouring and the "current" highlight live as DOM classes on the
        // rendered nodes, applied whenever a status, the current focus, the style map,
        // or the active level changes. Because this never touches the Mermaid source,
        // the SVG is not re-rendered.
        effect(() => {
            this.statusKey();
            this.currentNodeId();
            this.effectiveStatusStyles();
            this.graphStack();
            this.scheduleStatusClasses();
        });
        effect(() => {
            this.progressKey();
            this.scheduleNodeProgressBars();
        });
        // Re-apply the inline subgraph thumbnails when the toggle flips or the active
        // level changes. A structural re-render already re-applies them via
        // `onChartMutation`; this covers the false→true toggle (no re-render fires).
        effect(() => {
            this.showSubgraphPreview();
            this.graphStack();
            this.scheduleSubgraphPreviews();
        });
        // Re-frame the camera whenever an execution event changes the active node or
        // follow is toggled. The graph layout never changes between status updates,
        // so we only need to re-measure when one of these actually fires.
        effect(() => {
            this.followExecution();
            this.followPaused();
            this.currentNodeId();
            this.runningKey();
            this.scheduleFollow();
        });
    }
    buildAliasMap(nodes) {
        const toAlias = new Map();
        const toReal = new Map();
        nodes.forEach((node, index) => {
            const alias = `tg${index}`;
            toAlias.set(node.id, alias);
            toReal.set(alias, node.id);
        });
        return { toAlias, toReal };
    }
    /**
     * Build the Mermaid source for the graph **structure only** (nodes, edges,
     * shapes, click targets) — never status or current-focus.
     *
     * Status colouring and the live "current" highlight are applied as DOM classes
     * on the rendered `.node` elements (see `applyStatusClasses`). Keeping them out
     * of the source means `flowMarkdown` only changes when the structure changes,
     * so a run that merely advances statuses produces zero Mermaid re-renders.
     */
    buildGraph() {
        const nodes = this.activeNodes();
        const { toAlias } = this.aliasMap();
        const decorations = this.decorations();
        const aliasFor = (id) => toAlias.get(id);
        return [
            'flowchart TD',
            ...nodes.map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id])),
            '',
            ...this.buildEdgeLines(aliasFor),
            '',
            ...nodes.map((node) => this.buildNodeClickLine(node, toAlias.get(node.id) ?? node.id)),
            '',
            `  class ${nodes.map((node) => toAlias.get(node.id)).join(',')} clickable;`,
        ]
            .filter(Boolean)
            .join('\n');
    }
    buildNodeDefinitionLine(node, alias, decoration) {
        const title = this.buildNodeLabel(decoration?.displayTitle ?? node.title);
        return decoration?.shape === 'diamond' ? `  ${alias}{"${title}"}` : `  ${alias}["${title}"]`;
    }
    /**
     * Builds the Mermaid node label.
     *
     * PURPOSE: Keep Mermaid source limited to plain node text.
     *
     * VALUE: Live progress markup is injected after render, so Mermaid cannot
     * parse-fail on HTML controls or changing percentage values.
     */
    buildNodeLabel(title) {
        return this.escapeMermaidString(title);
    }
    /**
     * Reads a safe whole-number progress value from a task-run node.
     *
     * PURPOSE: Avoid pushing null, NaN, or out-of-range progress into Mermaid HTML
     * labels.
     *
     * VALUE: The generated `<progress>` element always receives valid numeric
     * attributes.
     */
    readNodeProgressPercent(progressPercent) {
        if (progressPercent === null ||
            progressPercent === undefined ||
            !Number.isFinite(progressPercent)) {
            return null;
        }
        return Math.max(TASK_GRAPH_PROGRESS_MIN_PERCENT, Math.min(TASK_GRAPH_PROGRESS_MAX_PERCENT, Math.round(progressPercent)));
    }
    buildEdgeLines(aliasFor) {
        return this.resolveEdges()
            .map((edge) => {
            const from = aliasFor(edge.from);
            const to = aliasFor(edge.to);
            if (!from || !to)
                return null;
            return edge.label
                ? `  ${from} -->|${this.escapeMermaidString(edge.label)}| ${to}`
                : `  ${from} --> ${to}`;
        })
            .filter((line) => line !== null);
    }
    /** Prefer explicit transitions, then per-node transitions, then dependencies. */
    resolveEdges() {
        const nodes = this.activeNodes();
        const explicit = this.activeTransitions() ?? [];
        const perNode = nodes.flatMap((node) => node.transitions ?? []);
        const transitions = explicit.length > 0 ? explicit : perNode;
        if (transitions.length > 0) {
            return transitions.map((transition) => ({
                from: transition.from,
                to: transition.to,
                label: transition.label ?? undefined,
            }));
        }
        return nodes.flatMap((node) => (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })));
    }
    buildNodeClickLine(node, alias) {
        const tooltip = this.escapeMermaidString(`View ${node.title}`);
        return `  click ${alias} "?${NODE_HREF_PARAM}=${encodeURIComponent(node.id)}" "${tooltip}"`;
    }
    escapeMermaidString(value) {
        return value.replace(/"/g, '\\"');
    }
    onChartMutation() {
        this.applySelectedNodeClass(this.effectiveSelectedNodeId());
        if (!this.hostElement.nativeElement.querySelector('.mermaid .node'))
            return;
        // A structural re-render produces fresh, class-less nodes; re-apply status.
        this.applyStatusClasses();
        this.applySubgraphPreviews();
        this.applyNodeProgressBars();
        if (this.followActive() && this.activeFocusId()) {
            // First render (or a re-render) with follow on and a focus node: frame it.
            this.requestFrameActiveNode();
        }
        else if (!this.hasFitInitialView) {
            // No focus to follow (idle, or a freshly-entered subgraph): fit the whole
            // level once so the new graph is visible.
            this.hasFitInitialView = true;
            requestAnimationFrame(() => this.cameraRef().fitAll());
        }
    }
    /** Called by the camera when the user manually pans/zooms — pauses follow. */
    onUserInteract() {
        if (this.followExecution())
            this.followPaused.set(true);
    }
    /** Re-center chip handler: resume follow and move to the active node. */
    resumeFollow() {
        this.followPaused.set(false);
        this.scheduleFollow();
    }
    /**
     * Re-frame on the active node when follow is live. Resumes follow if the host
     * just toggled `followExecution` back on.
     */
    scheduleFollow() {
        if (this.followExecution() && !this.lastFollowOn)
            this.followPaused.set(false);
        this.lastFollowOn = this.followExecution();
        if (this.followActive())
            this.requestFrameActiveNode();
    }
    /**
     * Queue a follow re-frame for the next animation frame.
     *
     * A status change fires both the follow effect and a burst of Mermaid DOM
     * mutations; coalescing them to a single frame stops the camera re-animating
     * many times for one execution event.
     */
    requestFrameActiveNode() {
        if (this.followFramePending)
            return;
        this.followFramePending = true;
        requestAnimationFrame(() => {
            this.followFramePending = false;
            this.frameActiveNode();
        });
    }
    /**
     * Move the camera to the active node (plus its 1-hop neighbours, so the
     * previous/upcoming nodes stay visible). Measures the live render: the layout
     * is stable, so even a node from the outgoing SVG yields the right position.
     */
    frameActiveNode() {
        if (!this.followActive())
            return;
        const focusId = this.activeFocusId();
        if (!focusId)
            return;
        const ids = new Set([focusId]);
        for (const neighbour of this.buildNeighbourMap().get(focusId) ?? [])
            ids.add(neighbour);
        const elements = [];
        for (const id of ids) {
            const element = this.findNodeElement(id);
            if (element)
                elements.push(element);
        }
        if (elements.length === 0)
            return;
        this.cameraRef().frameElements(elements, { maxScale: FOLLOW_MAX_ZOOM });
    }
    /** The node the camera should follow: the live focus, else a running node. */
    activeFocusId() {
        const nodes = this.activeNodes();
        const currentId = this.currentNodeId();
        // Only honour `currentNodeId` if it exists at the active level — it addresses
        // the root graph and is meaningless inside a subgraph.
        if (currentId && nodes.some((node) => node.id === currentId))
            return currentId;
        return nodes.find((node) => node.status === 'running')?.id ?? null;
    }
    /** Undirected 1-hop adjacency built from the resolved edges. */
    buildNeighbourMap() {
        const map = new Map();
        const link = (a, b) => {
            const list = map.get(a) ?? [];
            list.push(b);
            map.set(a, list);
        };
        for (const edge of this.resolveEdges()) {
            link(edge.from, edge.to);
            link(edge.to, edge.from);
        }
        return map;
    }
    /** Resolve a real node id to its rendered `.node` element, via the click anchor. */
    findNodeElement(nodeId) {
        const host = this.hostElement.nativeElement;
        const link = Array.from(host.querySelectorAll('.mermaid a')).find((linkElement) => this.readNodeIdFromLink(linkElement) === nodeId);
        if (!link)
            return null;
        // This Mermaid build wraps the node group inside the click `<a>`, so `.node`
        // is a descendant; fall back to an ancestor for other builds.
        return link.querySelector('.node') ?? link.closest('.node');
    }
    handleChartClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target)
            return;
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
            return;
        const linkElement = target.closest('a');
        const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
        if (!nodeId)
            return;
        event.preventDefault();
        event.stopPropagation();
        this.internalSelectedNodeId.set(nodeId);
        this.nodeSelected.emit(nodeId);
    }
    /** Double-click a drillable node to enter its subgraph. */
    handleChartDblClick(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (!target)
            return;
        const linkElement = target.closest('a');
        const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
        if (!nodeId)
            return;
        const node = this.activeNodes().find((candidate) => candidate.id === nodeId);
        if (!node || !this.resolveSubgraph(node))
            return;
        event.preventDefault();
        event.stopPropagation();
        this.enterSubgraph(node);
    }
    readNodeIdFromLink(linkElement) {
        const href = linkElement.getAttribute('href') ?? linkElement.getAttribute('xlink:href');
        if (!href)
            return null;
        try {
            const url = new URL(href, window.location.origin);
            const real = url.searchParams.get(NODE_HREF_PARAM);
            return real && this.aliasMap().toAlias.has(real) ? real : null;
        }
        catch {
            return null;
        }
    }
    scheduleSelectedNodeClass(selectedId) {
        requestAnimationFrame(() => this.applySelectedNodeClass(selectedId));
    }
    /** Defer status-class application to the next frame, after any pending render. */
    scheduleStatusClasses() {
        requestAnimationFrame(() => this.applyStatusClasses());
    }
    /** Defer progress-bar application to the next frame, after any pending render. */
    scheduleNodeProgressBars() {
        requestAnimationFrame(() => this.applyNodeProgressBars());
    }
    /** Defer subgraph-preview application to the next frame, after any pending render. */
    scheduleSubgraphPreviews() {
        requestAnimationFrame(() => this.applySubgraphPreviews());
    }
    /**
     * Apply each node's status colour and the live "current" highlight directly to
     * its rendered `.node` element, replacing the previous classes.
     *
     * PURPOSE: Reflect execution progress without regenerating the Mermaid source.
     *
     * VALUE: The SVG stays put across status updates — no teardown/rebuild — so the
     * camera measures a stable layout and node label sizing never jumps.
     */
    applyStatusClasses() {
        const currentId = this.currentNodeId();
        const styles = this.effectiveStatusStyles();
        const stripClasses = [...this.statusClassNames(), CURRENT_NODE_CLASS, HAS_SUBGRAPH_CLASS];
        // Clean up stale nodes from previousStatuses map (e.g. after subgraph navigation)
        const activeIds = new Set(this.activeNodes().map((n) => n.id));
        for (const key of this.previousStatuses.keys()) {
            if (!activeIds.has(key)) {
                this.previousStatuses.delete(key);
            }
        }
        for (const node of this.activeNodes()) {
            const element = this.findNodeElement(node.id);
            if (!element)
                continue;
            element.classList.remove(...stripClasses);
            const statusClass = styles[node.status]?.className;
            if (statusClass)
                element.classList.add(statusClass);
            if (node.id === currentId)
                element.classList.add(CURRENT_NODE_CLASS);
            if (this.resolveSubgraph(node))
                element.classList.add(HAS_SUBGRAPH_CLASS);
            // Detect transitions and trigger the generic pulse animations
            const prevStatus = this.previousStatuses.get(node.id);
            if (prevStatus !== undefined && prevStatus !== node.status) {
                if (statusClass) {
                    this.triggerNodePulse(node.id);
                    this.triggerIncomingEdgesPulse(node.id, statusClass);
                }
            }
            this.previousStatuses.set(node.id, node.status);
        }
        // Keep connection lines styled based on target node states
        this.applyEdgeStatusClasses();
    }
    /**
     * Temporarily thickens the node border outline.
     *
     * VALUE: Provides immediate visual feedback to the human operator that a specific
     * node has transitioned status (e.g. finished running or encountered an error).
     */
    triggerNodePulse(nodeId) {
        const element = this.findNodeElement(nodeId);
        if (!element)
            return;
        element.classList.add('pulse-active');
        setTimeout(() => element.classList.remove('pulse-active'), NODE_PULSE_DURATION_MS);
    }
    /**
     * Temporarily animates incoming connections as dashed marching ants.
     *
     * VALUE: Visually represents active flow transitions, making it clear to the operator
     * which path triggered the newly active node.
     */
    triggerIncomingEdgesPulse(nodeId, statusClass) {
        const { toAlias } = this.aliasMap();
        const pulseClass = `edge-pulse--${statusClass}`;
        const nodes = this.activeNodes();
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        for (const edge of this.resolveEdges()) {
            if (edge.to !== nodeId)
                continue;
            if (!this.isEdgeActive(edge, nodeMap))
                continue;
            const parentAlias = toAlias.get(edge.from);
            const childAlias = toAlias.get(edge.to);
            if (!parentAlias || !childAlias)
                continue;
            const edgeEl = this.findEdgeElement(parentAlias, childAlias);
            if (!edgeEl)
                continue;
            edgeEl.classList.add(pulseClass);
            setTimeout(() => edgeEl.classList.remove(pulseClass), EDGE_PULSE_DURATION_MS);
        }
    }
    /**
     * Applies status class modifiers to connection lines leading to nodes.
     *
     * VALUE: Styles traversed connection lines based on target node outcomes (e.g., solid
     * green for complete, solid red for failed), highlighting the execution path.
     */
    applyEdgeStatusClasses() {
        const { toAlias } = this.aliasMap();
        const host = this.hostElement.nativeElement;
        const styles = this.effectiveStatusStyles();
        const nodes = this.activeNodes();
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        // Clean up any old edge status classes first from the flowchart link paths
        for (const edgeEl of host.querySelectorAll('.mermaid .flowchart-link')) {
            const toRemove = [];
            for (let i = 0; i < edgeEl.classList.length; i++) {
                const cls = edgeEl.classList[i];
                if (cls.startsWith('edge-status--')) {
                    toRemove.push(cls);
                }
            }
            if (toRemove.length > 0) {
                edgeEl.classList.remove(...toRemove);
            }
        }
        for (const edge of this.resolveEdges()) {
            const parentAlias = toAlias.get(edge.from);
            const childAlias = toAlias.get(edge.to);
            if (!parentAlias || !childAlias)
                continue;
            const childNode = nodeMap.get(edge.to);
            if (!childNode)
                continue;
            if (this.isEdgeActive(edge, nodeMap)) {
                const edgeEl = this.findEdgeElement(parentAlias, childAlias);
                if (!edgeEl)
                    continue;
                const statusClass = styles[childNode.status]?.className;
                if (statusClass) {
                    edgeEl.classList.add(`edge-status--${statusClass}`);
                }
            }
        }
    }
    /**
     * Determine if a connection line should be visually colored/animated based on execution.
     *
     * VALUE: Prevents loop paths from highlighting prematurely, handles failed node recovery pathing,
     * and preserves parallel join animations using endedAt/startedAt timestamps.
     */
    isEdgeActive(edge, nodeMap) {
        const parentNode = nodeMap.get(edge.from);
        const childNode = nodeMap.get(edge.to);
        if (!parentNode || !childNode)
            return false;
        // 1. Parent must have executed (not undone/skipped/running)
        const isParentExecuted = parentNode.status !== 'undone' &&
            parentNode.status !== 'skipped' &&
            parentNode.status !== 'running';
        if (!isParentExecuted)
            return false;
        // 2. Child must be active/completed (not undone/skipped)
        if (childNode.status === 'undone' || childNode.status === 'skipped')
            return false;
        // 3. Resolve multi-parent connections using execution timestamps
        if (childNode.startedAt) {
            const childStart = Date.parse(childNode.startedAt);
            if (!isNaN(childStart)) {
                const candidates = [];
                const edges = this.resolveEdges();
                for (const e of edges) {
                    if (e.to !== childNode.id)
                        continue;
                    const p = nodeMap.get(e.from);
                    if (p && p.endedAt) {
                        const pEnd = Date.parse(p.endedAt);
                        if (!isNaN(pEnd) && pEnd <= childStart) {
                            candidates.push({ id: p.id, endTime: pEnd });
                        }
                    }
                }
                if (candidates.length > 1) {
                    const maxEndTime = Math.max(...candidates.map((c) => c.endTime));
                    const parentCandidate = candidates.find((c) => c.id === parentNode.id);
                    if (parentCandidate) {
                        // Active if it is the closest parent OR completed within parallel join threshold
                        const diff = maxEndTime - parentCandidate.endTime;
                        return diff <= PARALLEL_JOIN_THRESHOLD_MS;
                    }
                }
            }
        }
        return true;
    }
    /**
     * Find a rendered Mermaid edge path element in the DOM.
     *
     * VALUE: Direct query targeting of path elements via data-id and id attributes, bypassing
     * Mermaid's auto-generated unique ID suffixes.
     */
    findEdgeElement(parentAlias, childAlias) {
        const host = this.hostElement.nativeElement;
        return (host.querySelector(`.mermaid [data-id^="L_${parentAlias}_${childAlias}_"]`) ??
            host.querySelector(`.mermaid [id*="-L_${parentAlias}_${childAlias}_"]`) ??
            null);
    }
    /**
     * Apply each node's progress directly to the rendered Mermaid label.
     *
     * PURPOSE: Show live 0-100% node progress without changing the Mermaid source.
     *
     * VALUE: Progress ticks update the bar in place, keeping the camera and
     * selected node stable while long-running work advances.
     */
    applyNodeProgressBars() {
        for (const node of this.activeNodes()) {
            const element = this.findNodeElement(node.id);
            const label = element?.querySelector('.nodeLabel') ?? element?.querySelector('span');
            if (!element || !label)
                continue;
            let progressWrap = element.querySelector('.task-graph-node-progress-wrap');
            if (!progressWrap) {
                progressWrap = document.createElement('div');
                progressWrap.classList.add('task-graph-node-progress-wrap');
                const progressElement = document.createElement('progress');
                progressElement.classList.add('task-graph-node-progress');
                progressElement.value = TASK_GRAPH_PROGRESS_MIN_PERCENT;
                progressElement.max = TASK_GRAPH_PROGRESS_MAX_PERCENT;
                const progressText = document.createElement('small');
                progressWrap.append(progressElement, progressText);
                label.append(progressWrap);
            }
            const progressPercent = this.readNodeProgressPercent(node.progressPercent);
            progressWrap.classList.toggle('has-progress', progressPercent !== null);
            const progressElement = progressWrap.querySelector('progress');
            if (progressElement instanceof HTMLProgressElement) {
                progressElement.value = progressPercent ?? TASK_GRAPH_PROGRESS_MIN_PERCENT;
                progressElement.max = TASK_GRAPH_PROGRESS_MAX_PERCENT;
            }
            const progressText = progressWrap.querySelector('small');
            // Only write when the text actually changes. Writing a non-empty
            // `textContent` replaces the child text node, which is a childList
            // mutation inside the subtree the host MutationObserver watches — an
            // unconditional write would re-trigger `onChartMutation` → this method in
            // an unbounded loop that freezes the page.
            if (progressText) {
                const nextText = progressPercent === null ? '' : `${progressPercent}%`;
                if (progressText.textContent !== nextText)
                    progressText.textContent = nextText;
            }
        }
    }
    applySelectedNodeClass(selectedId) {
        const host = this.hostElement.nativeElement;
        for (const nodeElement of host.querySelectorAll('.mermaid .node.selected')) {
            nodeElement.classList.remove('selected');
        }
        if (!selectedId)
            return;
        const selectedLink = Array.from(host.querySelectorAll('.mermaid a')).find((linkElement) => this.readNodeIdFromLink(linkElement) === selectedId);
        const selectedNode = selectedLink?.querySelector('.node') ?? selectedLink?.closest('.node');
        selectedNode?.classList.add('selected');
    }
    // ── Subgraph inline preview ────────────────────────────────────────
    /**
     * Inject (or refresh) a static thumbnail of each drillable node's child graph
     * into the node label.
     *
     * PURPOSE: Hint a node's subgraph and its rough shape inline, without the host
     * decorating anything.
     *
     * VALUE: Decoration only — it is `pointer-events: none`, cached by structure
     * hash so status/progress ticks never rebuild it, and re-injected idempotently
     * after a structural Mermaid re-render. Never participates in selection,
     * follow, or progress, so it cannot trigger a MutationObserver re-render storm.
     */
    applySubgraphPreviews() {
        if (!this.showSubgraphPreview()) {
            this.removeSubgraphPreviews();
            return;
        }
        for (const node of this.activeNodes()) {
            const element = this.findNodeElement(node.id);
            const label = element?.querySelector('.nodeLabel') ?? element?.querySelector('span');
            if (!element || !label)
                continue;
            const existing = label.querySelector('.task-graph-node-subgraph-preview');
            const graph = this.resolveSubgraph(node);
            if (!graph) {
                existing?.remove();
                continue;
            }
            const { html, hash } = this.buildSubgraphPreview(graph);
            if (existing instanceof HTMLElement) {
                // Skip the DOM write when the structure is unchanged — an unconditional
                // write would be a childList mutation that re-triggers `onChartMutation`.
                if (existing.dataset['sgHash'] === hash)
                    continue;
                existing.innerHTML = html;
                existing.dataset['sgHash'] = hash;
            }
            else {
                const wrap = document.createElement('div');
                wrap.classList.add('task-graph-node-subgraph-preview');
                wrap.dataset['sgHash'] = hash;
                wrap.innerHTML = html;
                label.append(wrap);
            }
        }
    }
    /** Strip every injected subgraph thumbnail (toggle off). */
    removeSubgraphPreviews() {
        for (const preview of this.hostElement.nativeElement.querySelectorAll('.task-graph-node-subgraph-preview')) {
            preview.remove();
        }
    }
    /**
     * Build the static mini-preview SVG for a child graph plus a structure hash.
     *
     * PURPOSE: Lay the child graph out as a tiny dependency-layered dot diagram
     * (columns = depth, terminal nodes accented) that reads as "this node contains
     * a few steps".
     *
     * VALUE: Pure structure — it ignores node status, so the cached SVG only needs
     * rebuilding when the child graph's nodes/edges change.
     */
    buildSubgraphPreview(graph) {
        const allEdges = this.resolveGraphEdges(graph);
        const hash = `${graph.nodes.map((node) => node.id).join('|')}::${allEdges
            .map((edge) => `${edge.from}>${edge.to}`)
            .join('|')}`;
        const nodes = graph.nodes.slice(0, SUBGRAPH_PREVIEW_MAX_NODES);
        const truncated = graph.nodes.length - nodes.length;
        const ids = new Set(nodes.map((node) => node.id));
        const edges = allEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
        const depthById = this.computeGraphDepths(nodes, edges);
        const hasOutgoing = new Set(edges.map((edge) => edge.from));
        // Group nodes into columns by depth, preserving declaration order within each.
        const columns = [];
        for (const node of nodes) {
            const depth = depthById.get(node.id) ?? 0;
            (columns[depth] ??= []).push(node.id);
        }
        const r = SUBGRAPH_PREVIEW_DOT_RADIUS_PX;
        const pad = SUBGRAPH_PREVIEW_PADDING_PX;
        const positionById = new Map();
        columns.forEach((column, depth) => {
            column.forEach((id, row) => {
                positionById.set(id, {
                    x: pad + r + depth * SUBGRAPH_PREVIEW_COLUMN_GAP_PX,
                    y: pad + r + row * SUBGRAPH_PREVIEW_ROW_GAP_PX,
                });
            });
        });
        const columnCount = Math.max(1, columns.length);
        const maxRows = Math.max(1, ...columns.map((column) => column.length));
        let width = pad * 2 + r * 2 + (columnCount - 1) * SUBGRAPH_PREVIEW_COLUMN_GAP_PX;
        const height = pad * 2 + r * 2 + (maxRows - 1) * SUBGRAPH_PREVIEW_ROW_GAP_PX;
        const edgeMarkup = edges
            .map((edge) => {
            const from = positionById.get(edge.from);
            const to = positionById.get(edge.to);
            if (!from || !to)
                return '';
            return `<line class="sg-edge" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
        })
            .join('');
        const dotMarkup = nodes
            .map((node) => {
            const position = positionById.get(node.id);
            if (!position)
                return '';
            const terminalClass = hasOutgoing.has(node.id) ? '' : ' sg-dot--terminal';
            return `<circle class="sg-dot${terminalClass}" cx="${position.x}" cy="${position.y}" r="${r}" />`;
        })
            .join('');
        let overflowMarkup = '';
        if (truncated > 0) {
            const textX = width + 2;
            width += SUBGRAPH_PREVIEW_OVERFLOW_LABEL_WIDTH_PX;
            overflowMarkup = `<text class="sg-more" x="${textX}" y="${height / 2 + 3}">+${truncated}</text>`;
        }
        const html = `<svg class="sg-svg" width="${width}" height="${height}" ` +
            `viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
            `${edgeMarkup}${dotMarkup}${overflowMarkup}</svg>`;
        return { html, hash };
    }
    /**
     * Longest-path depth (column index) for each node in a child graph.
     *
     * VALUE: A topological pass (cycle-safe) that places dependents to the right of
     * their prerequisites, giving the mini-preview a readable left-to-right flow.
     */
    computeGraphDepths(nodes, edges) {
        const depth = new Map();
        const indegree = new Map();
        const adjacency = new Map();
        for (const node of nodes) {
            depth.set(node.id, 0);
            indegree.set(node.id, 0);
            adjacency.set(node.id, []);
        }
        for (const edge of edges) {
            adjacency.get(edge.from)?.push(edge.to);
            indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
        }
        const queue = [...indegree.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
        while (queue.length > 0) {
            const current = queue.shift();
            for (const next of adjacency.get(current) ?? []) {
                depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(current) ?? 0) + 1));
                const remaining = (indegree.get(next) ?? 0) - 1;
                indegree.set(next, remaining);
                if (remaining === 0)
                    queue.push(next);
            }
        }
        return depth;
    }
    /** Resolve a child graph's edges (explicit → per-node → dependencies). */
    resolveGraphEdges(graph) {
        const explicit = graph.transitions ?? [];
        const perNode = graph.nodes.flatMap((node) => node.transitions ?? []);
        const transitions = explicit.length > 0 ? explicit : perNode;
        if (transitions.length > 0) {
            return transitions.map((transition) => ({ from: transition.from, to: transition.to }));
        }
        return graph.nodes.flatMap((node) => (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })));
    }
    // ── Subgraph navigation ────────────────────────────────────────────
    /** Resolve a node's child graph via the host resolver, else its inline graph. */
    resolveSubgraph(node) {
        const resolver = this.subgraphResolver();
        return (resolver ? resolver(node) : null) ?? node.subgraph ?? null;
    }
    /** Drill into a node's subgraph, pushing one level onto the stack. */
    enterSubgraph(node) {
        const graph = this.resolveSubgraph(node);
        if (!graph)
            return;
        const frame = {
            nodeId: node.id,
            label: node.subgraphLabel ?? node.title,
            graph,
        };
        const next = [...this.graphStack(), frame];
        this.graphStack.set(next);
        this.onNavigated(next, 'enter');
    }
    /** Enter the currently-selected node's subgraph (inspector affordance). */
    enterSelectedSubgraph() {
        const node = this.selectedNode();
        if (node)
            this.enterSubgraph(node);
    }
    /** Pop the stack back to `depth` (0 = root). Backs the breadcrumb crumbs. */
    goToDepth(depth) {
        if (depth >= this.graphStack().length)
            return;
        const next = this.graphStack().slice(0, depth);
        this.graphStack.set(next);
        this.onNavigated(next, 'leave');
    }
    /** Leave the current subgraph, one level up. */
    leaveSubgraph() {
        this.goToDepth(Math.max(0, this.graphStack().length - 1));
    }
    /**
     * Shared after-navigation bookkeeping.
     *
     * PURPOSE: Reset per-level selection, re-fit the new level, and tell the host
     * where we are via the nav outputs.
     *
     * VALUE: Enter, leave, and breadcrumb jumps all emit one consistent path so the
     * host's history stays in lockstep with the viewer.
     */
    onNavigated(stack, direction) {
        this.internalSelectedNodeId.set(null);
        this.hasFitInitialView = false;
        const top = stack[stack.length - 1] ?? null;
        const path = stack.map((frame) => frame.nodeId);
        const event = {
            path,
            nodeId: top?.nodeId ?? null,
            label: top?.label ?? null,
        };
        if (direction === 'enter')
            this.subgraphEntered.emit(event);
        else
            this.subgraphLeft.emit(event);
        this.graphPathChange.emit(path);
    }
    /**
     * Rebuild the navigation stack to match a host-supplied node-id path.
     *
     * PURPOSE: Let the host restore subgraph depth from browser history without the
     * viewer and the URL fighting each other.
     *
     * VALUE: A no-op when the stack already matches (so the echo from our own
     * {@link graphPathChange} never loops), and it walks the chain from the root
     * input, resolving each level — so deep links and back/forward land exactly
     * where the user left off.
     */
    reconcileStackToPath(desired) {
        const current = untracked(() => this.graphStack()).map((frame) => frame.nodeId);
        if (this.samePath(current, desired))
            return;
        const frames = [];
        let nodes = untracked(() => this.nodes());
        for (const nodeId of desired) {
            const node = nodes.find((candidate) => candidate.id === nodeId);
            if (!node)
                break;
            const graph = this.resolveSubgraph(node);
            if (!graph)
                break;
            frames.push({ nodeId, label: node.subgraphLabel ?? node.title, graph });
            nodes = graph.nodes;
        }
        this.graphStack.set(frames);
        this.internalSelectedNodeId.set(null);
        this.hasFitInitialView = false;
    }
    /** Shallow ordered equality for two node-id paths. */
    samePath(a, b) {
        return a.length === b.length && a.every((value, index) => value === b[index]);
    }
    static { this.ɵfac = function GraphCanvasComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || GraphCanvasComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: GraphCanvasComponent, selectors: [["app-graph-canvas"]], viewQuery: function GraphCanvasComponent_Query(rf, ctx) { if (rf & 1) {
            i0.ɵɵviewQuerySignal(ctx.cameraRef, GraphCameraComponent, 5);
        } if (rf & 2) {
            i0.ɵɵqueryAdvance();
        } }, hostAttrs: [1, "app-graph-canvas"], inputs: { nodes: [1, "nodes"], transitions: [1, "transitions"], selectedNodeId: [1, "selectedNodeId"], currentNodeId: [1, "currentNodeId"], decorations: [1, "decorations"], statusStyles: [1, "statusStyles"], rootLabel: [1, "rootLabel"], showBreadcrumb: [1, "showBreadcrumb"], showSubgraphPreview: [1, "showSubgraphPreview"], showDetail: [1, "showDetail"], subgraphResolver: [1, "subgraphResolver"], path: [1, "path"], followExecution: [1, "followExecution"] }, outputs: { nodeSelected: "nodeSelected", subgraphEntered: "subgraphEntered", subgraphLeft: "subgraphLeft", graphPathChange: "graphPathChange" }, ngContentSelectors: _c1, decls: 8, vars: 6, consts: [[1, "graph-canvas__layout"], [1, "graph-canvas__viewport"], [1, "graph-canvas__camera", 3, "userInteract"], ["mermaid", "", 1, "graph-canvas__mermaid", 3, "data", "mermaidOptions"], ["type", "button", 1, "graph-canvas__recenter"], ["aria-label", "Subgraph path", 1, "graph-canvas__breadcrumb"], ["type", "button", 1, "graph-canvas__recenter", 3, "click"], ["type", "button", 1, "graph-canvas__crumb", 3, "click", "disabled"], ["aria-hidden", "true", 1, "graph-canvas__crumb-sep"]], template: function GraphCanvasComponent_Template(rf, ctx) { if (rf & 1) {
            i0.ɵɵprojectionDef(_c0);
            i0.ɵɵelementStart(0, "div", 0)(1, "div", 1)(2, "app-graph-camera", 2);
            i0.ɵɵlistener("userInteract", function GraphCanvasComponent_Template_app_graph_camera_userInteract_2_listener() { return ctx.onUserInteract(); });
            i0.ɵɵelement(3, "markdown", 3);
            i0.ɵɵelementEnd();
            i0.ɵɵconditionalCreate(4, GraphCanvasComponent_Conditional_4_Template, 2, 0, "button", 4);
            i0.ɵɵconditionalCreate(5, GraphCanvasComponent_Conditional_5_Template, 3, 0, "nav", 5);
            i0.ɵɵprojection(6);
            i0.ɵɵelementEnd();
            i0.ɵɵprojection(7, 1);
            i0.ɵɵelementEnd();
        } if (rf & 2) {
            i0.ɵɵclassProp("graph-canvas__layout--with-detail", ctx.showDetail());
            i0.ɵɵadvance(3);
            i0.ɵɵproperty("data", ctx.flowMarkdown())("mermaidOptions", ctx.mermaidOptions);
            i0.ɵɵadvance();
            i0.ɵɵconditional(ctx.showRecenterChip() ? 4 : -1);
            i0.ɵɵadvance();
            i0.ɵɵconditional(ctx.showBreadcrumb() && ctx.breadcrumb().length > 0 ? 5 : -1);
        } }, dependencies: [CommonModule, MarkdownModule, i1.MarkdownComponent, GraphCameraComponent], styles: ["[_nghost-%COMP%]{position:relative;display:block;width:100%;height:100%;min-height:inherit;border-radius:6px;background:var(--mat-sys-surface);border:1px solid var(--mat-sys-outline-variant)}.graph-canvas__layout[_ngcontent-%COMP%]{display:grid;grid-template-columns:minmax(0,1fr);width:100%;height:100%;min-height:inherit}.graph-canvas__layout--with-detail[_ngcontent-%COMP%]{grid-template-columns:minmax(0,1fr) minmax(18rem,24rem)}.graph-canvas__viewport[_ngcontent-%COMP%]{position:relative;min-width:0;min-height:inherit}.graph-canvas__camera[_ngcontent-%COMP%]{width:100%;height:100%}.graph-canvas__recenter[_ngcontent-%COMP%]{position:absolute;top:12px;left:50%;transform:translate(-50%);z-index:2;padding:6px 12px;border:1px solid var(--app-color-pass);border-radius:999px;background:var(--app-color-pass-bg);color:var(--mat-sys-on-surface);font-size:.78rem;cursor:pointer;box-shadow:0 2px 8px #00000059}.graph-canvas__recenter[_ngcontent-%COMP%]:hover{background:#ffffff1f}.graph-canvas__mermaid[_ngcontent-%COMP%]{display:block;padding:.75rem}.graph-canvas__breadcrumb[_ngcontent-%COMP%]{position:absolute;top:12px;left:12px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:.25rem;max-width:calc(100% - 24px);padding:.3rem .5rem;border:1px solid var(--mat-sys-outline-variant);border-radius:999px;background:var(--mat-sys-surface-container);box-shadow:0 2px 8px #00000059}.graph-canvas__crumb[_ngcontent-%COMP%]{padding:.15rem .5rem;border:0;border-radius:999px;background:transparent;color:var(--mat-sys-on-surface-variant);font-size:.76rem;cursor:pointer}.graph-canvas__crumb[_ngcontent-%COMP%]:hover:not(:disabled){background:#ffffff1a;color:var(--mat-sys-on-surface)}.graph-canvas__crumb--current[_ngcontent-%COMP%]{color:var(--mat-sys-on-surface);font-weight:600;cursor:default}.graph-canvas__crumb-sep[_ngcontent-%COMP%]{color:var(--mat-sys-outline);font-size:.8rem}@media(max-width:900px){.graph-canvas__layout--with-detail[_ngcontent-%COMP%]{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(20rem,1fr) auto}}[_nghost-%COMP%]     .mermaid{display:flex;justify-content:center}[_nghost-%COMP%]     .mermaid svg{max-width:none;height:auto}[_nghost-%COMP%]     .mermaid .node.clickable{cursor:pointer}[_nghost-%COMP%]     .mermaid .node.has-subgraph .basic, [_nghost-%COMP%]     .mermaid .node.has-subgraph .label-container, [_nghost-%COMP%]     .mermaid .node.has-subgraph polygon, [_nghost-%COMP%]     .mermaid .node.has-subgraph rect{stroke-dasharray:5 3;stroke:var(--mat-sys-primary)!important}[_nghost-%COMP%]     .mermaid .node a{-webkit-user-drag:none}[_nghost-%COMP%]     .mermaid .node a, [_nghost-%COMP%]     .mermaid .node foreignObject, [_nghost-%COMP%]     .mermaid .node .nodeLabel, [_nghost-%COMP%]     .mermaid .node span{user-select:text;-webkit-user-select:text}[_nghost-%COMP%]     .mermaid .node .basic, [_nghost-%COMP%]     .mermaid .node .label-container, [_nghost-%COMP%]     .mermaid .node polygon, [_nghost-%COMP%]     .mermaid .node rect{transition:fill .14s ease,stroke .14s ease,stroke-width .14s ease,filter .14s ease}[_nghost-%COMP%]     .mermaid .node:hover .basic, [_nghost-%COMP%]     .mermaid .node:hover .label-container, [_nghost-%COMP%]     .mermaid .node:hover polygon, [_nghost-%COMP%]     .mermaid .node:hover rect{filter:brightness(1.2);stroke:var(--mat-sys-primary)!important;stroke-width:3px!important}[_nghost-%COMP%]     .mermaid .node:hover span{color:var(--mat-sys-on-surface)!important}[_nghost-%COMP%]     .mermaid foreignObject{overflow:visible}[_nghost-%COMP%]     .mermaid .task-graph-node-progress-wrap{display:flex;flex-direction:column;align-items:center;min-width:7rem;gap:.18rem;margin-top:.28rem;opacity:0;transition:opacity .14s ease}[_nghost-%COMP%]     .mermaid .task-graph-node-progress-wrap small{color:var(--mat-sys-on-surface-variant);font-size:.68rem;line-height:1;min-height:.68rem}[_nghost-%COMP%]     .mermaid .task-graph-node-progress{width:100%;height:.38rem;overflow:hidden;border:0;border-radius:999px;background:#ffffff14;accent-color:var(--app-color-pass)}[_nghost-%COMP%]     .mermaid .task-graph-node-progress-wrap.has-progress{opacity:1}[_nghost-%COMP%]     .mermaid .task-graph-node-progress::-webkit-progress-bar{border-radius:inherit;background:#ffffff14}[_nghost-%COMP%]     .mermaid .task-graph-node-progress::-webkit-progress-value{border-radius:inherit;background:var(--app-color-pass)}[_nghost-%COMP%]     .mermaid .task-graph-node-progress::-moz-progress-bar{border-radius:inherit;background:var(--app-color-pass)}[_nghost-%COMP%]     .mermaid .task-graph-node-subgraph-preview{display:flex;justify-content:center;margin-top:.3rem;pointer-events:none;-webkit-user-select:none;user-select:none;opacity:.85}[_nghost-%COMP%]     .mermaid .task-graph-node-subgraph-preview .sg-svg{overflow:visible}[_nghost-%COMP%]     .mermaid .task-graph-node-subgraph-preview .sg-edge{stroke:var(--mat-sys-outline);stroke-width:1}[_nghost-%COMP%]     .mermaid .task-graph-node-subgraph-preview .sg-dot{fill:var(--mat-sys-surface-container-high);stroke:var(--mat-sys-outline);stroke-width:.75}[_nghost-%COMP%]     .mermaid .task-graph-node-subgraph-preview .sg-dot--terminal{fill:var(--mat-sys-primary);stroke:var(--mat-sys-primary)}[_nghost-%COMP%]     .mermaid .task-graph-node-subgraph-preview .sg-more{fill:var(--mat-sys-on-surface-variant);font-size:7px}[_nghost-%COMP%]     .mermaid .node.current .basic, [_nghost-%COMP%]     .mermaid .node.current .label-container, [_nghost-%COMP%]     .mermaid .node.current polygon, [_nghost-%COMP%]     .mermaid .node.current rect, [_nghost-%COMP%]     .mermaid .node.running .basic, [_nghost-%COMP%]     .mermaid .node.running .label-container, [_nghost-%COMP%]     .mermaid .node.running polygon, [_nghost-%COMP%]     .mermaid .node.running rect{fill:var(--app-color-pass-bg)!important;stroke:var(--app-color-pass)!important;stroke-width:3px!important}[_nghost-%COMP%]     .mermaid .node.done .basic, [_nghost-%COMP%]     .mermaid .node.done .label-container, [_nghost-%COMP%]     .mermaid .node.done polygon, [_nghost-%COMP%]     .mermaid .node.done rect{fill:#ffffff0f!important;stroke:var(--app-color-pass)!important}[_nghost-%COMP%]     .mermaid .node.failed .basic, [_nghost-%COMP%]     .mermaid .node.failed .label-container, [_nghost-%COMP%]     .mermaid .node.failed polygon, [_nghost-%COMP%]     .mermaid .node.failed rect{fill:var(--app-color-fail-bg)!important;stroke:var(--app-color-fail)!important}[_nghost-%COMP%]     .mermaid .node.skipped .basic, [_nghost-%COMP%]     .mermaid .node.skipped .label-container, [_nghost-%COMP%]     .mermaid .node.skipped polygon, [_nghost-%COMP%]     .mermaid .node.skipped rect{fill:var(--app-color-warn-bg)!important;stroke:var(--app-color-warn)!important}[_nghost-%COMP%]     .mermaid .node.current span, [_nghost-%COMP%]     .mermaid .node.running span, [_nghost-%COMP%]     .mermaid .node.done span, [_nghost-%COMP%]     .mermaid .node.failed span, [_nghost-%COMP%]     .mermaid .node.skipped span{color:var(--mat-sys-on-surface)!important}[_nghost-%COMP%]     .mermaid .node.selected .basic, [_nghost-%COMP%]     .mermaid .node.selected .label-container, [_nghost-%COMP%]     .mermaid .node.selected polygon, [_nghost-%COMP%]     .mermaid .node.selected rect{filter:drop-shadow(0 0 .35rem var(--mat-sys-primary));stroke-width:3px!important}[_nghost-%COMP%]     .mermaid .node.pulse-active .basic, [_nghost-%COMP%]     .mermaid .node.pulse-active .label-container, [_nghost-%COMP%]     .mermaid .node.pulse-active polygon, [_nghost-%COMP%]     .mermaid .node.pulse-active rect{stroke-width:6px!important;transition:stroke-width .1s cubic-bezier(.1,.8,.3,1)!important}@keyframes _ngcontent-%COMP%_edge-marching-ants{to{stroke-dashoffset:-20}}[_nghost-%COMP%]     .mermaid path.flowchart-link{transition:stroke .3s ease,stroke-width .3s ease}[_nghost-%COMP%]     .mermaid path.flowchart-link.edge-status--done{stroke:var(--app-color-pass)!important;stroke-width:2px!important}[_nghost-%COMP%]     .mermaid path.flowchart-link.edge-status--failed{stroke:var(--app-color-fail)!important;stroke-width:2px!important}[_nghost-%COMP%]     .mermaid path.flowchart-link.edge-status--running, [_nghost-%COMP%]     .mermaid path.flowchart-link.edge-pulse--done{stroke:var(--app-color-pass)!important;stroke-width:2.5px!important;stroke-dasharray:6 4!important;animation:_ngcontent-%COMP%_edge-marching-ants 1s linear infinite!important}[_nghost-%COMP%]     .mermaid path.flowchart-link.edge-pulse--failed{stroke:var(--app-color-fail)!important;stroke-width:2.5px!important;stroke-dasharray:6 4!important;animation:_ngcontent-%COMP%_edge-marching-ants 1s linear infinite!important}"], changeDetection: 0 }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(GraphCanvasComponent, [{
        type: Component,
        args: [{ selector: 'app-graph-canvas', host: { class: 'app-graph-canvas' }, imports: [CommonModule, MarkdownModule, GraphCameraComponent], changeDetection: ChangeDetectionStrategy.OnPush, template: "<div class=\"graph-canvas__layout\" [class.graph-canvas__layout--with-detail]=\"showDetail()\">\r\n  <div class=\"graph-canvas__viewport\">\r\n    <app-graph-camera class=\"graph-canvas__camera\" (userInteract)=\"onUserInteract()\">\r\n      <markdown\r\n        [data]=\"flowMarkdown()\"\r\n        mermaid\r\n        [mermaidOptions]=\"mermaidOptions\"\r\n        class=\"graph-canvas__mermaid\"\r\n      ></markdown>\r\n    </app-graph-camera>\r\n\r\n    @if (showRecenterChip()) {\r\n      <button type=\"button\" class=\"graph-canvas__recenter\" (click)=\"resumeFollow()\">\r\n        Re-center on running\r\n      </button>\r\n    }\r\n\r\n    @if (showBreadcrumb() && breadcrumb().length > 0) {\r\n      <nav class=\"graph-canvas__breadcrumb\" aria-label=\"Subgraph path\">\r\n        @for (crumb of breadcrumb(); track crumb.depth; let last = $last) {\r\n          <button\r\n            type=\"button\"\r\n            class=\"graph-canvas__crumb\"\r\n            [class.graph-canvas__crumb--current]=\"last\"\r\n            [disabled]=\"last\"\r\n            (click)=\"goToDepth(crumb.depth)\"\r\n          >\r\n            {{ crumb.label }}\r\n          </button>\r\n          @if (!last) {\r\n            <span class=\"graph-canvas__crumb-sep\" aria-hidden=\"true\">\u203A</span>\r\n          }\r\n        }\r\n      </nav>\r\n    }\r\n\r\n    <!-- Host-supplied viewport overlays (extra controls, minimap, legends). -->\r\n    <ng-content select=\"[overlay]\"></ng-content>\r\n  </div>\r\n\r\n  <!-- Host-supplied side detail (inspector/sidebar); reserved only when showDetail. -->\r\n  <ng-content select=\"[detail]\"></ng-content>\r\n</div>\r\n", styles: [":host{position:relative;display:block;width:100%;height:100%;min-height:inherit;border-radius:6px;background:var(--mat-sys-surface);border:1px solid var(--mat-sys-outline-variant)}.graph-canvas__layout{display:grid;grid-template-columns:minmax(0,1fr);width:100%;height:100%;min-height:inherit}.graph-canvas__layout--with-detail{grid-template-columns:minmax(0,1fr) minmax(18rem,24rem)}.graph-canvas__viewport{position:relative;min-width:0;min-height:inherit}.graph-canvas__camera{width:100%;height:100%}.graph-canvas__recenter{position:absolute;top:12px;left:50%;transform:translate(-50%);z-index:2;padding:6px 12px;border:1px solid var(--app-color-pass);border-radius:999px;background:var(--app-color-pass-bg);color:var(--mat-sys-on-surface);font-size:.78rem;cursor:pointer;box-shadow:0 2px 8px #00000059}.graph-canvas__recenter:hover{background:#ffffff1f}.graph-canvas__mermaid{display:block;padding:.75rem}.graph-canvas__breadcrumb{position:absolute;top:12px;left:12px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:.25rem;max-width:calc(100% - 24px);padding:.3rem .5rem;border:1px solid var(--mat-sys-outline-variant);border-radius:999px;background:var(--mat-sys-surface-container);box-shadow:0 2px 8px #00000059}.graph-canvas__crumb{padding:.15rem .5rem;border:0;border-radius:999px;background:transparent;color:var(--mat-sys-on-surface-variant);font-size:.76rem;cursor:pointer}.graph-canvas__crumb:hover:not(:disabled){background:#ffffff1a;color:var(--mat-sys-on-surface)}.graph-canvas__crumb--current{color:var(--mat-sys-on-surface);font-weight:600;cursor:default}.graph-canvas__crumb-sep{color:var(--mat-sys-outline);font-size:.8rem}@media(max-width:900px){.graph-canvas__layout--with-detail{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(20rem,1fr) auto}}:host ::ng-deep .mermaid{display:flex;justify-content:center}:host ::ng-deep .mermaid svg{max-width:none;height:auto}:host ::ng-deep .mermaid .node.clickable{cursor:pointer}:host ::ng-deep .mermaid .node.has-subgraph .basic,:host ::ng-deep .mermaid .node.has-subgraph .label-container,:host ::ng-deep .mermaid .node.has-subgraph polygon,:host ::ng-deep .mermaid .node.has-subgraph rect{stroke-dasharray:5 3;stroke:var(--mat-sys-primary)!important}:host ::ng-deep .mermaid .node a{-webkit-user-drag:none}:host ::ng-deep .mermaid .node a,:host ::ng-deep .mermaid .node foreignObject,:host ::ng-deep .mermaid .node .nodeLabel,:host ::ng-deep .mermaid .node span{user-select:text;-webkit-user-select:text}:host ::ng-deep .mermaid .node .basic,:host ::ng-deep .mermaid .node .label-container,:host ::ng-deep .mermaid .node polygon,:host ::ng-deep .mermaid .node rect{transition:fill .14s ease,stroke .14s ease,stroke-width .14s ease,filter .14s ease}:host ::ng-deep .mermaid .node:hover .basic,:host ::ng-deep .mermaid .node:hover .label-container,:host ::ng-deep .mermaid .node:hover polygon,:host ::ng-deep .mermaid .node:hover rect{filter:brightness(1.2);stroke:var(--mat-sys-primary)!important;stroke-width:3px!important}:host ::ng-deep .mermaid .node:hover span{color:var(--mat-sys-on-surface)!important}:host ::ng-deep .mermaid foreignObject{overflow:visible}:host ::ng-deep .mermaid .task-graph-node-progress-wrap{display:flex;flex-direction:column;align-items:center;min-width:7rem;gap:.18rem;margin-top:.28rem;opacity:0;transition:opacity .14s ease}:host ::ng-deep .mermaid .task-graph-node-progress-wrap small{color:var(--mat-sys-on-surface-variant);font-size:.68rem;line-height:1;min-height:.68rem}:host ::ng-deep .mermaid .task-graph-node-progress{width:100%;height:.38rem;overflow:hidden;border:0;border-radius:999px;background:#ffffff14;accent-color:var(--app-color-pass)}:host ::ng-deep .mermaid .task-graph-node-progress-wrap.has-progress{opacity:1}:host ::ng-deep .mermaid .task-graph-node-progress::-webkit-progress-bar{border-radius:inherit;background:#ffffff14}:host ::ng-deep .mermaid .task-graph-node-progress::-webkit-progress-value{border-radius:inherit;background:var(--app-color-pass)}:host ::ng-deep .mermaid .task-graph-node-progress::-moz-progress-bar{border-radius:inherit;background:var(--app-color-pass)}:host ::ng-deep .mermaid .task-graph-node-subgraph-preview{display:flex;justify-content:center;margin-top:.3rem;pointer-events:none;-webkit-user-select:none;user-select:none;opacity:.85}:host ::ng-deep .mermaid .task-graph-node-subgraph-preview .sg-svg{overflow:visible}:host ::ng-deep .mermaid .task-graph-node-subgraph-preview .sg-edge{stroke:var(--mat-sys-outline);stroke-width:1}:host ::ng-deep .mermaid .task-graph-node-subgraph-preview .sg-dot{fill:var(--mat-sys-surface-container-high);stroke:var(--mat-sys-outline);stroke-width:.75}:host ::ng-deep .mermaid .task-graph-node-subgraph-preview .sg-dot--terminal{fill:var(--mat-sys-primary);stroke:var(--mat-sys-primary)}:host ::ng-deep .mermaid .task-graph-node-subgraph-preview .sg-more{fill:var(--mat-sys-on-surface-variant);font-size:7px}:host ::ng-deep .mermaid .node.current .basic,:host ::ng-deep .mermaid .node.current .label-container,:host ::ng-deep .mermaid .node.current polygon,:host ::ng-deep .mermaid .node.current rect,:host ::ng-deep .mermaid .node.running .basic,:host ::ng-deep .mermaid .node.running .label-container,:host ::ng-deep .mermaid .node.running polygon,:host ::ng-deep .mermaid .node.running rect{fill:var(--app-color-pass-bg)!important;stroke:var(--app-color-pass)!important;stroke-width:3px!important}:host ::ng-deep .mermaid .node.done .basic,:host ::ng-deep .mermaid .node.done .label-container,:host ::ng-deep .mermaid .node.done polygon,:host ::ng-deep .mermaid .node.done rect{fill:#ffffff0f!important;stroke:var(--app-color-pass)!important}:host ::ng-deep .mermaid .node.failed .basic,:host ::ng-deep .mermaid .node.failed .label-container,:host ::ng-deep .mermaid .node.failed polygon,:host ::ng-deep .mermaid .node.failed rect{fill:var(--app-color-fail-bg)!important;stroke:var(--app-color-fail)!important}:host ::ng-deep .mermaid .node.skipped .basic,:host ::ng-deep .mermaid .node.skipped .label-container,:host ::ng-deep .mermaid .node.skipped polygon,:host ::ng-deep .mermaid .node.skipped rect{fill:var(--app-color-warn-bg)!important;stroke:var(--app-color-warn)!important}:host ::ng-deep .mermaid .node.current span,:host ::ng-deep .mermaid .node.running span,:host ::ng-deep .mermaid .node.done span,:host ::ng-deep .mermaid .node.failed span,:host ::ng-deep .mermaid .node.skipped span{color:var(--mat-sys-on-surface)!important}:host ::ng-deep .mermaid .node.selected .basic,:host ::ng-deep .mermaid .node.selected .label-container,:host ::ng-deep .mermaid .node.selected polygon,:host ::ng-deep .mermaid .node.selected rect{filter:drop-shadow(0 0 .35rem var(--mat-sys-primary));stroke-width:3px!important}:host ::ng-deep .mermaid .node.pulse-active .basic,:host ::ng-deep .mermaid .node.pulse-active .label-container,:host ::ng-deep .mermaid .node.pulse-active polygon,:host ::ng-deep .mermaid .node.pulse-active rect{stroke-width:6px!important;transition:stroke-width .1s cubic-bezier(.1,.8,.3,1)!important}@keyframes edge-marching-ants{to{stroke-dashoffset:-20}}:host ::ng-deep .mermaid path.flowchart-link{transition:stroke .3s ease,stroke-width .3s ease}:host ::ng-deep .mermaid path.flowchart-link.edge-status--done{stroke:var(--app-color-pass)!important;stroke-width:2px!important}:host ::ng-deep .mermaid path.flowchart-link.edge-status--failed{stroke:var(--app-color-fail)!important;stroke-width:2px!important}:host ::ng-deep .mermaid path.flowchart-link.edge-status--running,:host ::ng-deep .mermaid path.flowchart-link.edge-pulse--done{stroke:var(--app-color-pass)!important;stroke-width:2.5px!important;stroke-dasharray:6 4!important;animation:edge-marching-ants 1s linear infinite!important}:host ::ng-deep .mermaid path.flowchart-link.edge-pulse--failed{stroke:var(--app-color-fail)!important;stroke-width:2.5px!important;stroke-dasharray:6 4!important;animation:edge-marching-ants 1s linear infinite!important}\n"] }]
    }], () => [], { cameraRef: [{ type: i0.ViewChild, args: [i0.forwardRef(() => GraphCameraComponent), { isSignal: true }] }], nodes: [{ type: i0.Input, args: [{ isSignal: true, alias: "nodes", required: true }] }], transitions: [{ type: i0.Input, args: [{ isSignal: true, alias: "transitions", required: false }] }], selectedNodeId: [{ type: i0.Input, args: [{ isSignal: true, alias: "selectedNodeId", required: false }] }], currentNodeId: [{ type: i0.Input, args: [{ isSignal: true, alias: "currentNodeId", required: false }] }], decorations: [{ type: i0.Input, args: [{ isSignal: true, alias: "decorations", required: false }] }], statusStyles: [{ type: i0.Input, args: [{ isSignal: true, alias: "statusStyles", required: false }] }], rootLabel: [{ type: i0.Input, args: [{ isSignal: true, alias: "rootLabel", required: false }] }], showBreadcrumb: [{ type: i0.Input, args: [{ isSignal: true, alias: "showBreadcrumb", required: false }] }], showSubgraphPreview: [{ type: i0.Input, args: [{ isSignal: true, alias: "showSubgraphPreview", required: false }] }], showDetail: [{ type: i0.Input, args: [{ isSignal: true, alias: "showDetail", required: false }] }], subgraphResolver: [{ type: i0.Input, args: [{ isSignal: true, alias: "subgraphResolver", required: false }] }], path: [{ type: i0.Input, args: [{ isSignal: true, alias: "path", required: false }] }], followExecution: [{ type: i0.Input, args: [{ isSignal: true, alias: "followExecution", required: false }] }], nodeSelected: [{ type: i0.Output, args: ["nodeSelected"] }], subgraphEntered: [{ type: i0.Output, args: ["subgraphEntered"] }], subgraphLeft: [{ type: i0.Output, args: ["subgraphLeft"] }], graphPathChange: [{ type: i0.Output, args: ["graphPathChange"] }] }); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(GraphCanvasComponent, { className: "GraphCanvasComponent", filePath: "lib/graph-canvas/graph-canvas.component.ts", lineNumber: 225 }); })();

/**
 * Inspector data seam for the task-graph viewer.
 *
 * PURPOSE: Let the viewer load a node ref's preview (input/output/context/log/
 * artifact) without knowing *how* — the host plugs an implementation in.
 *
 * VALUE: This is the viewer's last runtime tie to any backend, inverted into a
 * token. The daemon provides a loader wrapping its HTTP route; a different
 * project provides its own; a host that omits the inspector provides nothing and
 * the dependency vanishes. Nothing here imports the daemon API — it travels with
 * the library (see `docs/draft/033_task-graph-library-extraction.md`).
 */
/**
 * DI token the viewer reads (optionally) to resolve a {@link TaskGraphRefLoader}.
 *
 * VALUE: Optional injection — when no loader is provided, the inspector simply
 * reports that previews are unavailable instead of pulling in a backend.
 */
const TASK_GRAPH_REF_LOADER = new InjectionToken('TASK_GRAPH_REF_LOADER');

const _forTrack0 = ($index, $item) => $item.kind;
const _forTrack1 = ($index, $item) => $item.id;
function GraphInspectorComponent_Conditional_0_Conditional_13_Template(rf, ctx) { if (rf & 1) {
    const _r4 = i0.ɵɵgetCurrentView();
    i0.ɵɵelementStart(0, "button", 13);
    i0.ɵɵlistener("click", function GraphInspectorComponent_Conditional_0_Conditional_13_Template_button_click_0_listener() { i0.ɵɵrestoreView(_r4); const ctx_r2 = i0.ɵɵnextContext(2); return i0.ɵɵresetView(ctx_r2.enterSubgraph.emit()); });
    i0.ɵɵelementStart(1, "mat-icon");
    i0.ɵɵtext(2, "account_tree");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "span");
    i0.ɵɵtext(4, "Enter subgraph");
    i0.ɵɵelementEnd()();
} }
function GraphInspectorComponent_Conditional_0_Conditional_15_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div")(1, "dt");
    i0.ɵɵtext(2, "Type");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "dd");
    i0.ɵɵtext(4);
    i0.ɵɵelementEnd()();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance(4);
    i0.ɵɵtextInterpolate(node_r2.type);
} }
function GraphInspectorComponent_Conditional_0_Conditional_16_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div")(1, "dt");
    i0.ɵɵtext(2, "Started");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "dd");
    i0.ɵɵtext(4);
    i0.ɵɵpipe(5, "date");
    i0.ɵɵelementEnd()();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance(4);
    i0.ɵɵtextInterpolate(i0.ɵɵpipeBind2(5, 1, node_r2.startedAt, "mediumTime"));
} }
function GraphInspectorComponent_Conditional_0_Conditional_17_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div")(1, "dt");
    i0.ɵɵtext(2, "Ended");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "dd");
    i0.ɵɵtext(4);
    i0.ɵɵpipe(5, "date");
    i0.ɵɵelementEnd()();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance(4);
    i0.ɵɵtextInterpolate(i0.ɵɵpipeBind2(5, 1, node_r2.endedAt, "mediumTime"));
} }
function GraphInspectorComponent_Conditional_0_Conditional_18_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div")(1, "dt");
    i0.ɵɵtext(2, "Duration");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "dd");
    i0.ɵɵtext(4);
    i0.ɵɵpipe(5, "number");
    i0.ɵɵelementEnd()();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance(4);
    i0.ɵɵtextInterpolate1("", i0.ɵɵpipeBind2(5, 1, node_r2.durationMs / 1000, "1.1-2"), "s");
} }
function GraphInspectorComponent_Conditional_0_Conditional_19_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div")(1, "dt");
    i0.ɵɵtext(2, "Progress");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "dd");
    i0.ɵɵtext(4);
    i0.ɵɵpipe(5, "number");
    i0.ɵɵelementEnd()();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance(4);
    i0.ɵɵtextInterpolate1("", i0.ɵɵpipeBind2(5, 1, node_r2.progressPercent, "1.0-0"), "%");
} }
function GraphInspectorComponent_Conditional_0_Conditional_20_Conditional_2_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "p", 16);
    i0.ɵɵtext(1);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext(2);
    i0.ɵɵadvance();
    i0.ɵɵtextInterpolate(node_r2.progressLabel);
} }
function GraphInspectorComponent_Conditional_0_Conditional_20_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div", 14);
    i0.ɵɵelement(1, "div", 15);
    i0.ɵɵelementEnd();
    i0.ɵɵconditionalCreate(2, GraphInspectorComponent_Conditional_0_Conditional_20_Conditional_2_Template, 2, 1, "p", 16);
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance();
    i0.ɵɵstyleProp("width", node_r2.progressPercent, "%");
    i0.ɵɵadvance();
    i0.ɵɵconditional(node_r2.progressLabel ? 2 : -1);
} }
function GraphInspectorComponent_Conditional_0_Conditional_21_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "pre", 8);
    i0.ɵɵtext(1);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance();
    i0.ɵɵtextInterpolate(node_r2.detail || node_r2.error);
} }
function GraphInspectorComponent_Conditional_0_Conditional_22_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "p", 0);
    i0.ɵɵtext(1, "No detail has been published for this node yet.");
    i0.ɵɵelementEnd();
} }
function GraphInspectorComponent_Conditional_0_For_24_For_4_Conditional_5_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "small");
    i0.ɵɵtext(1);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    i0.ɵɵadvance();
    i0.ɵɵtextInterpolate(ctx);
} }
function GraphInspectorComponent_Conditional_0_For_24_For_4_Template(rf, ctx) { if (rf & 1) {
    const _r5 = i0.ɵɵgetCurrentView();
    i0.ɵɵelementStart(0, "button", 18);
    i0.ɵɵlistener("click", function GraphInspectorComponent_Conditional_0_For_24_For_4_Template_button_click_0_listener() { const ref_r6 = i0.ɵɵrestoreView(_r5).$implicit; const group_r7 = i0.ɵɵnextContext().$implicit; const node_r2 = i0.ɵɵnextContext(); const ctx_r2 = i0.ɵɵnextContext(); return i0.ɵɵresetView(ctx_r2.openNodeRef(node_r2.id, group_r7.kind, ref_r6)); });
    i0.ɵɵelementStart(1, "code");
    i0.ɵɵtext(2);
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "span");
    i0.ɵɵtext(4);
    i0.ɵɵelementEnd();
    i0.ɵɵconditionalCreate(5, GraphInspectorComponent_Conditional_0_For_24_For_4_Conditional_5_Template, 2, 1, "small");
    i0.ɵɵelementEnd();
} if (rf & 2) {
    let tmp_25_0;
    const ref_r6 = ctx.$implicit;
    const group_r7 = i0.ɵɵnextContext().$implicit;
    const node_r2 = i0.ɵɵnextContext();
    const ctx_r2 = i0.ɵɵnextContext();
    i0.ɵɵclassProp("selected", ctx_r2.isSelectedRef(node_r2.id, group_r7.kind, ref_r6.id));
    i0.ɵɵadvance(2);
    i0.ɵɵtextInterpolate(ctx_r2.readRefLabel(ref_r6));
    i0.ɵɵadvance(2);
    i0.ɵɵtextInterpolate(ctx_r2.readRefSummary(ref_r6));
    i0.ɵɵadvance();
    i0.ɵɵconditional((tmp_25_0 = ctx_r2.readRefPath(ref_r6)) ? 5 : -1, tmp_25_0);
} }
function GraphInspectorComponent_Conditional_0_For_24_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div", 9)(1, "h5");
    i0.ɵɵtext(2);
    i0.ɵɵelementEnd();
    i0.ɵɵrepeaterCreate(3, GraphInspectorComponent_Conditional_0_For_24_For_4_Template, 6, 5, "button", 17, _forTrack1);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const group_r7 = ctx.$implicit;
    i0.ɵɵadvance(2);
    i0.ɵɵtextInterpolate(group_r7.title);
    i0.ɵɵadvance();
    i0.ɵɵrepeater(group_r7.refs);
} }
function GraphInspectorComponent_Conditional_0_ForEmpty_25_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "p", 0);
    i0.ɵɵtext(1, "No refs have been published for this node yet.");
    i0.ɵɵelementEnd();
} }
function GraphInspectorComponent_Conditional_0_Conditional_26_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div", 10)(1, "h5");
    i0.ɵɵtext(2, "Preview");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "p");
    i0.ɵɵtext(4, "Loading ref...");
    i0.ɵɵelementEnd()();
} }
function GraphInspectorComponent_Conditional_0_Conditional_27_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div", 11)(1, "h5");
    i0.ɵɵtext(2, "Preview");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(3, "p");
    i0.ɵɵtext(4);
    i0.ɵɵelementEnd()();
} if (rf & 2) {
    const ctx_r2 = i0.ɵɵnextContext(2);
    i0.ɵɵadvance(4);
    i0.ɵɵtextInterpolate(ctx_r2.selectedRefError());
} }
function GraphInspectorComponent_Conditional_0_Conditional_28_Conditional_4_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "span");
    i0.ɵɵtext(1, "truncated");
    i0.ɵɵelementEnd();
} }
function GraphInspectorComponent_Conditional_0_Conditional_28_Conditional_5_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "small");
    i0.ɵɵtext(1);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const refContent_r8 = i0.ɵɵnextContext();
    i0.ɵɵadvance();
    i0.ɵɵtextInterpolate(refContent_r8.path);
} }
function GraphInspectorComponent_Conditional_0_Conditional_28_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div", 10)(1, "div", 19)(2, "h5");
    i0.ɵɵtext(3);
    i0.ɵɵelementEnd();
    i0.ɵɵconditionalCreate(4, GraphInspectorComponent_Conditional_0_Conditional_28_Conditional_4_Template, 2, 0, "span");
    i0.ɵɵelementEnd();
    i0.ɵɵconditionalCreate(5, GraphInspectorComponent_Conditional_0_Conditional_28_Conditional_5_Template, 2, 1, "small");
    i0.ɵɵelementStart(6, "pre");
    i0.ɵɵtext(7);
    i0.ɵɵelementEnd()();
} if (rf & 2) {
    const refContent_r8 = ctx;
    const ctx_r2 = i0.ɵɵnextContext(2);
    i0.ɵɵadvance(3);
    i0.ɵɵtextInterpolate(ctx_r2.readRefLabel(refContent_r8.ref));
    i0.ɵɵadvance();
    i0.ɵɵconditional(refContent_r8.truncated ? 4 : -1);
    i0.ɵɵadvance();
    i0.ɵɵconditional(refContent_r8.path ? 5 : -1);
    i0.ɵɵadvance(2);
    i0.ɵɵtextInterpolate(ctx_r2.selectedRefDisplayText());
} }
function GraphInspectorComponent_Conditional_0_Conditional_29_For_4_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "code");
    i0.ɵɵtext(1);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const dependency_r9 = ctx.$implicit;
    i0.ɵɵadvance();
    i0.ɵɵtextInterpolate(dependency_r9);
} }
function GraphInspectorComponent_Conditional_0_Conditional_29_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "div", 12)(1, "span");
    i0.ɵɵtext(2, "Depends on");
    i0.ɵɵelementEnd();
    i0.ɵɵrepeaterCreate(3, GraphInspectorComponent_Conditional_0_Conditional_29_For_4_Template, 2, 1, "code", null, i0.ɵɵrepeaterTrackByIdentity);
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const node_r2 = i0.ɵɵnextContext();
    i0.ɵɵadvance(3);
    i0.ɵɵrepeater(node_r2.dependencies);
} }
function GraphInspectorComponent_Conditional_0_Template(rf, ctx) { if (rf & 1) {
    const _r1 = i0.ɵɵgetCurrentView();
    i0.ɵɵelementStart(0, "div", 1)(1, "div", 2);
    i0.ɵɵelement(2, "span", 3);
    i0.ɵɵelementStart(3, "div")(4, "h4");
    i0.ɵɵtext(5);
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(6, "p");
    i0.ɵɵtext(7);
    i0.ɵɵelementEnd()()();
    i0.ɵɵelementStart(8, "button", 4);
    i0.ɵɵlistener("click", function GraphInspectorComponent_Conditional_0_Template_button_click_8_listener() { const node_r2 = i0.ɵɵrestoreView(_r1); const ctx_r2 = i0.ɵɵnextContext(); return i0.ɵɵresetView(ctx_r2.copyNodeForAgent(node_r2)); });
    i0.ɵɵelementStart(9, "mat-icon", 5);
    i0.ɵɵtext(10, "content_copy");
    i0.ɵɵelementEnd();
    i0.ɵɵelementStart(11, "span");
    i0.ɵɵtext(12);
    i0.ɵɵelementEnd()()();
    i0.ɵɵconditionalCreate(13, GraphInspectorComponent_Conditional_0_Conditional_13_Template, 5, 0, "button", 6);
    i0.ɵɵelementStart(14, "dl", 7);
    i0.ɵɵconditionalCreate(15, GraphInspectorComponent_Conditional_0_Conditional_15_Template, 5, 1, "div");
    i0.ɵɵconditionalCreate(16, GraphInspectorComponent_Conditional_0_Conditional_16_Template, 6, 4, "div");
    i0.ɵɵconditionalCreate(17, GraphInspectorComponent_Conditional_0_Conditional_17_Template, 6, 4, "div");
    i0.ɵɵconditionalCreate(18, GraphInspectorComponent_Conditional_0_Conditional_18_Template, 6, 4, "div");
    i0.ɵɵconditionalCreate(19, GraphInspectorComponent_Conditional_0_Conditional_19_Template, 6, 4, "div");
    i0.ɵɵelementEnd();
    i0.ɵɵconditionalCreate(20, GraphInspectorComponent_Conditional_0_Conditional_20_Template, 3, 3);
    i0.ɵɵconditionalCreate(21, GraphInspectorComponent_Conditional_0_Conditional_21_Template, 2, 1, "pre", 8)(22, GraphInspectorComponent_Conditional_0_Conditional_22_Template, 2, 0, "p", 0);
    i0.ɵɵrepeaterCreate(23, GraphInspectorComponent_Conditional_0_For_24_Template, 5, 1, "div", 9, _forTrack0, false, GraphInspectorComponent_Conditional_0_ForEmpty_25_Template, 2, 0, "p", 0);
    i0.ɵɵconditionalCreate(26, GraphInspectorComponent_Conditional_0_Conditional_26_Template, 5, 0, "div", 10)(27, GraphInspectorComponent_Conditional_0_Conditional_27_Template, 5, 1, "div", 11)(28, GraphInspectorComponent_Conditional_0_Conditional_28_Template, 8, 4, "div", 10);
    i0.ɵɵconditionalCreate(29, GraphInspectorComponent_Conditional_0_Conditional_29_Template, 5, 0, "div", 12);
} if (rf & 2) {
    let tmp_16_0;
    const node_r2 = ctx;
    const ctx_r2 = i0.ɵɵnextContext();
    i0.ɵɵattribute("data-status", node_r2.status);
    i0.ɵɵadvance(5);
    i0.ɵɵtextInterpolate(node_r2.title);
    i0.ɵɵadvance(2);
    i0.ɵɵtextInterpolate2("", node_r2.id, " - ", node_r2.status);
    i0.ɵɵadvance();
    i0.ɵɵproperty("matTooltip", ctx_r2.copiedNodeId() === node_r2.id ? "Copied!" : "Copy node details for Agent");
    i0.ɵɵadvance(4);
    i0.ɵɵtextInterpolate(ctx_r2.copiedNodeId() === node_r2.id ? "Copied!" : "Copy for Agent");
    i0.ɵɵadvance();
    i0.ɵɵconditional(ctx_r2.hasSubgraph() ? 13 : -1);
    i0.ɵɵadvance(2);
    i0.ɵɵconditional(node_r2.type ? 15 : -1);
    i0.ɵɵadvance();
    i0.ɵɵconditional(node_r2.startedAt ? 16 : -1);
    i0.ɵɵadvance();
    i0.ɵɵconditional(node_r2.endedAt ? 17 : -1);
    i0.ɵɵadvance();
    i0.ɵɵconditional(node_r2.durationMs != null ? 18 : -1);
    i0.ɵɵadvance();
    i0.ɵɵconditional(node_r2.progressPercent != null ? 19 : -1);
    i0.ɵɵadvance();
    i0.ɵɵconditional(node_r2.progressPercent != null ? 20 : -1);
    i0.ɵɵadvance();
    i0.ɵɵconditional(node_r2.detail || node_r2.error ? 21 : 22);
    i0.ɵɵadvance(2);
    i0.ɵɵrepeater(ctx_r2.selectedNodeRefGroups());
    i0.ɵɵadvance(3);
    i0.ɵɵconditional(ctx_r2.selectedRefLoading() ? 26 : ctx_r2.selectedRefError() ? 27 : (tmp_16_0 = ctx_r2.selectedRefContent()) ? 28 : -1, tmp_16_0);
    i0.ɵɵadvance(3);
    i0.ɵɵconditional(node_r2.dependencies && node_r2.dependencies.length > 0 ? 29 : -1);
} }
function GraphInspectorComponent_Conditional_1_Template(rf, ctx) { if (rf & 1) {
    i0.ɵɵelementStart(0, "p", 0);
    i0.ɵɵtext(1, "Select a node to inspect it.");
    i0.ɵɵelementEnd();
} }
/**
 * Number of milliseconds the "Copied!" confirmation stays visible.
 *
 * VALUE: Long enough to read, short enough not to linger past the next action.
 */
const COPY_FEEDBACK_DURATION_MS = 2000;
/**
 * JSON indentation used in node-ref previews.
 *
 * Value: Structured context snapshots stay readable in the compact inspector
 * without hiding a bare formatting number.
 */
const TASK_RUN_REF_JSON_INDENT_SPACES = 2;
/**
 * Selected-node detail sidebar for the graph canvas.
 *
 * PURPOSE: Render the selected node's metadata, progress, detail/error, and
 * inspectable refs (inputs/outputs/context/logs/artifacts), loading each ref's
 * preview lazily through the host-supplied {@link TASK_GRAPH_REF_LOADER}.
 *
 * VALUE: A default, optional sibling the host projects into the canvas's
 * `[detail]` slot and feeds from the canvas's exposed `selectedNode` signal — so
 * the canvas owns no inspector chrome and the only backend tie (ref loading)
 * stays a pluggable token, not a daemon import.
 */
class GraphInspectorComponent {
    constructor() {
        this.destroyRef = inject(DestroyRef);
        /** Host-supplied loader for node-ref previews; absent when no inspector backend. */
        this.refLoader = inject(TASK_GRAPH_REF_LOADER, { optional: true });
        /** The node to inspect — the canvas's `selectedNode`, or null for the empty state. */
        this.node = input(null, ...(ngDevMode ? [{ debugName: "node" }] : []));
        /** Durable run id used for loading ref previews. */
        this.runId = input(null, ...(ngDevMode ? [{ debugName: "runId" }] : []));
        /** Whether the inspected node can be drilled into (drives the enter-subgraph button). */
        this.hasSubgraph = input(false, ...(ngDevMode ? [{ debugName: "hasSubgraph" }] : []));
        /** Emits when the user asks to drill into the inspected node's subgraph. */
        this.enterSubgraph = output();
        this.copiedNodeId = signal(null, ...(ngDevMode ? [{ debugName: "copiedNodeId" }] : []));
        this.selectedNodeRefGroups = computed(() => {
            const node = this.node();
            if (!node)
                return [];
            return this.buildRefGroups(node);
        }, ...(ngDevMode ? [{ debugName: "selectedNodeRefGroups" }] : []));
        this.selectedRef = signal(null, ...(ngDevMode ? [{ debugName: "selectedRef" }] : []));
        this.selectedRefContent = signal(null, ...(ngDevMode ? [{ debugName: "selectedRefContent" }] : []));
        this.selectedRefLoading = signal(false, ...(ngDevMode ? [{ debugName: "selectedRefLoading" }] : []));
        this.selectedRefError = signal(null, ...(ngDevMode ? [{ debugName: "selectedRefError" }] : []));
        this.selectedRefDisplayText = computed(() => {
            const content = this.selectedRefContent();
            return content ? this.formatTaskRunRefContent(content) : '';
        }, ...(ngDevMode ? [{ debugName: "selectedRefDisplayText" }] : []));
        /** Id of the node whose ref preview is currently shown — guards stale clears. */
        this.lastInspectedNodeId = null;
        // Clear the ref preview only when the selected node's *id* changes — not on
        // every status tick (which hands us a fresh node object with the same id).
        effect(() => {
            const id = this.node()?.id ?? null;
            if (id === this.lastInspectedNodeId)
                return;
            this.lastInspectedNodeId = id;
            untracked(() => this.clearSelectedRef());
        });
    }
    /**
     * Copy a compact, agent-friendly summary of the node to the clipboard.
     *
     * PURPOSE: Let the Human hand a node's status/progress/detail to a coding agent
     * in one click.
     *
     * VALUE: No manual transcription of run id, node id, status, and error text.
     */
    copyNodeForAgent(node) {
        const lines = [];
        const runId = this.runId();
        if (runId) {
            lines.push(`Run ID: ${runId}`);
        }
        lines.push(`Node: ${node.title} (${node.id})`);
        lines.push(`Status: ${node.status}`);
        if (node.progressPercent != null || node.progressLabel) {
            const pct = node.progressPercent != null ? `${node.progressPercent}%` : '';
            const label = node.progressLabel || '';
            lines.push(`Progress: ${label}${pct ? ` (${pct})` : ''}`);
        }
        if (node.detail) {
            lines.push(`Detail: ${node.detail}`);
        }
        if (node.error) {
            lines.push(`Error: ${node.error}`);
        }
        const text = lines.join('\n');
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.copiedNodeId.set(node.id);
                setTimeout(() => {
                    if (this.copiedNodeId() === node.id) {
                        this.copiedNodeId.set(null);
                    }
                }, COPY_FEEDBACK_DURATION_MS);
            });
        }
    }
    /**
     * Build non-empty ref groups for the selected node.
     *
     * PURPOSE: Present all evidence types through one inspector path while keeping
     * the persisted node shape separated by ref purpose.
     *
     * VALUE: Any task that publishes refs gets clickable inputs, outputs, context,
     * logs, and artifacts without a task-specific component.
     */
    buildRefGroups(node) {
        const groups = [
            { title: 'Inputs', kind: 'input', refs: node.inputRefs ?? [] },
            { title: 'Outputs', kind: 'output', refs: node.outputRefs ?? [] },
            { title: 'Context', kind: 'context', refs: node.contextRefs ?? [] },
            { title: 'Logs', kind: 'log', refs: node.logRefs ?? [] },
            { title: 'Artifacts', kind: 'artifact', refs: node.artifactRefs ?? [] },
        ];
        return groups.filter((group) => group.refs.length > 0);
    }
    /**
     * Load a clicked node ref through the host-supplied {@link TASK_GRAPH_REF_LOADER}.
     *
     * PURPOSE: Turn published node refs into inspectable evidence without the
     * inspector knowing how the host fetches them.
     *
     * VALUE: Inputs, outputs, context, logs, and artifacts become reviewable from
     * the same reusable component, while the backend (daemon HTTP route, a
     * different API, or in-memory data) stays a pluggable seam.
     */
    openNodeRef(nodeId, refKind, ref) {
        const runId = this.runId();
        this.selectedRef.set({ nodeId, refKind, ref });
        this.selectedRefContent.set(null);
        this.selectedRefError.set(null);
        const loader = this.refLoader;
        if (!loader) {
            this.selectedRefError.set('No ref loader is configured for this graph.');
            return;
        }
        if (!runId) {
            this.selectedRefError.set('No task run id is available for this ref.');
            return;
        }
        this.selectedRefLoading.set(true);
        from(loader.loadRef({ runId, nodeId, refKind, refId: ref.id, ref }))
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
            next: (content) => {
                if (!this.isSelectedRef(nodeId, refKind, ref.id))
                    return;
                this.selectedRefContent.set(content);
                this.selectedRefLoading.set(false);
            },
            error: (error) => {
                if (!this.isSelectedRef(nodeId, refKind, ref.id))
                    return;
                this.selectedRefError.set(error instanceof Error ? error.message : 'Could not load this ref.');
                this.selectedRefLoading.set(false);
            },
        });
    }
    /**
     * Check whether a ref row is currently selected.
     *
     * PURPOSE: Keep row highlighting aligned with the preview block.
     *
     * VALUE: The Human can see exactly which published ref produced the visible
     * content below the node details.
     */
    isSelectedRef(nodeId, refKind, refId) {
        const selected = this.selectedRef();
        return selected?.nodeId === nodeId && selected.refKind === refKind && selected.ref.id === refId;
    }
    /**
     * Read a concise label from any task-run ref.
     *
     * PURPOSE: Normalize data, log, and artifact refs for compact row rendering.
     *
     * VALUE: The template stays readable while preserving each ref's original shape.
     */
    readRefLabel(ref) {
        return 'label' in ref && ref.label ? ref.label : ref.id;
    }
    /**
     * Read the main summary line from any task-run ref.
     *
     * PURPOSE: Prefer human-authored summaries and fall back to the stored path or event id.
     *
     * VALUE: Ref rows remain useful even when a task only publishes a file pointer.
     */
    readRefSummary(ref) {
        const pathValue = this.readRefPath(ref);
        return ref.summary || pathValue || ('eventId' in ref && ref.eventId ? ref.eventId : '');
    }
    /**
     * Read the path display value from any task-run ref.
     *
     * PURPOSE: Hide optional-path branching from the template.
     *
     * VALUE: Event-only refs can render without showing an empty path row.
     */
    readRefPath(ref) {
        return 'path' in ref && typeof ref.path === 'string' && ref.path.trim().length > 0
            ? ref.path
            : null;
    }
    /**
     * Format loaded ref content for display.
     *
     * PURPOSE: Pretty-print JSON snapshots while leaving logs and text artifacts untouched.
     *
     * VALUE: Structured node context is easier to inspect without changing how refs are stored.
     */
    formatTaskRunRefContent(content) {
        if (content.contentType !== 'application/json') {
            return content.content;
        }
        try {
            return JSON.stringify(JSON.parse(content.content), null, TASK_RUN_REF_JSON_INDENT_SPACES);
        }
        catch {
            return content.content;
        }
    }
    /**
     * Clear the current ref preview when the selected node changes.
     *
     * PURPOSE: Avoid showing stale evidence for a node that is no longer selected.
     *
     * VALUE: The side panel always reads as one coherent node inspection.
     */
    clearSelectedRef() {
        this.selectedRef.set(null);
        this.selectedRefContent.set(null);
        this.selectedRefLoading.set(false);
        this.selectedRefError.set(null);
    }
    static { this.ɵfac = function GraphInspectorComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || GraphInspectorComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: GraphInspectorComponent, selectors: [["app-graph-inspector"]], hostAttrs: [1, "app-graph-inspector"], inputs: { node: [1, "node"], runId: [1, "runId"], hasSubgraph: [1, "hasSubgraph"] }, outputs: { enterSubgraph: "enterSubgraph" }, decls: 2, vars: 1, consts: [[1, "graph-inspector__empty-detail"], [1, "graph-inspector__node-heading", 2, "display", "flex", "align-items", "center", "justify-content", "space-between", "gap", "8px"], [2, "display", "flex", "align-items", "center", "gap", "8px", "flex", "1"], [1, "graph-inspector__status-dot"], ["type", "button", 1, "graph-inspector__copy-agent", 2, "display", "inline-flex", "align-items", "center", "justify-content", "center", "gap", "4px", "padding", "4px 8px", "background", "rgba(255, 255, 255, 0.05)", "border", "1px solid rgba(255, 255, 255, 0.1)", "border-radius", "4px", "color", "rgba(255, 255, 255, 0.8)", "cursor", "pointer", "font-size", "11px", "height", "26px", 3, "click", "matTooltip"], [2, "font-size", "14px", "width", "14px", "height", "14px", "line-height", "14px"], ["type", "button", 1, "graph-inspector__enter-subgraph"], [1, "graph-inspector__node-meta"], [1, "graph-inspector__node-detail"], [1, "graph-inspector__ref-section"], [1, "graph-inspector__ref-preview"], [1, "graph-inspector__ref-preview", "error"], [1, "graph-inspector__dependencies"], ["type", "button", 1, "graph-inspector__enter-subgraph", 3, "click"], [1, "graph-inspector__progress"], [1, "graph-inspector__progress-bar"], [1, "graph-inspector__progress-label"], ["type", "button", 1, "graph-inspector__ref-row", 3, "selected"], ["type", "button", 1, "graph-inspector__ref-row", 3, "click"], [1, "graph-inspector__ref-preview-heading"]], template: function GraphInspectorComponent_Template(rf, ctx) { if (rf & 1) {
            i0.ɵɵconditionalCreate(0, GraphInspectorComponent_Conditional_0_Template, 30, 17)(1, GraphInspectorComponent_Conditional_1_Template, 2, 0, "p", 0);
        } if (rf & 2) {
            let tmp_0_0;
            i0.ɵɵconditional((tmp_0_0 = ctx.node()) ? 0 : 1, tmp_0_0);
        } }, dependencies: [CommonModule, MatIconModule, i1$1.MatIcon, MatTooltipModule, i2.MatTooltip, i3.DecimalPipe, i3.DatePipe], styles: ["[_nghost-%COMP%]{display:flex;flex-direction:column;gap:.85rem;min-width:0;max-height:100%;padding:1rem;overflow:auto;border-left:1px solid var(--mat-sys-outline-variant);background:var(--mat-sys-surface-container)}.graph-inspector__enter-subgraph[_ngcontent-%COMP%]{display:inline-flex;align-items:center;gap:.35rem;align-self:flex-start;padding:.35rem .7rem;border:1px solid var(--mat-sys-primary);border-radius:6px;background:var(--app-color-running-bg);color:var(--mat-sys-on-surface);font-size:.78rem;cursor:pointer}.graph-inspector__enter-subgraph[_ngcontent-%COMP%]:hover{background:#ffffff1f}.graph-inspector__enter-subgraph[_ngcontent-%COMP%]   mat-icon[_ngcontent-%COMP%]{width:1rem;height:1rem;font-size:1rem;line-height:1rem}.graph-inspector__node-heading[_ngcontent-%COMP%]{display:flex;align-items:flex-start;gap:.65rem}.graph-inspector__node-heading[_ngcontent-%COMP%]   h4[_ngcontent-%COMP%]{margin:0;color:var(--mat-sys-on-surface);font-size:1rem;line-height:1.25}.graph-inspector__node-heading[_ngcontent-%COMP%]   p[_ngcontent-%COMP%]{margin:.15rem 0 0;color:var(--mat-sys-on-surface-variant);font-family:ui-monospace,Cascadia Code,Consolas,monospace;font-size:.72rem;word-break:break-word}.graph-inspector__node-heading[data-status=complete][_ngcontent-%COMP%]   .graph-inspector__status-dot[_ngcontent-%COMP%]{background:var(--app-color-pass)}.graph-inspector__node-heading[data-status=failed][_ngcontent-%COMP%]   .graph-inspector__status-dot[_ngcontent-%COMP%]{background:var(--app-color-fail)}.graph-inspector__node-heading[data-status=running][_ngcontent-%COMP%]   .graph-inspector__status-dot[_ngcontent-%COMP%]{background:var(--app-color-pass);box-shadow:0 0 .45rem var(--app-color-pass)}.graph-inspector__node-heading[data-status=skipped][_ngcontent-%COMP%]   .graph-inspector__status-dot[_ngcontent-%COMP%]{background:var(--app-color-warn)}.graph-inspector__status-dot[_ngcontent-%COMP%]{flex:0 0 auto;width:.7rem;height:.7rem;margin-top:.3rem;border-radius:999px;background:var(--mat-sys-outline)}.graph-inspector__node-meta[_ngcontent-%COMP%]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin:0}.graph-inspector__node-meta[_ngcontent-%COMP%]   div[_ngcontent-%COMP%]{min-width:0;padding:.5rem;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface-container-high)}.graph-inspector__node-meta[_ngcontent-%COMP%]   dt[_ngcontent-%COMP%]{color:var(--mat-sys-outline);font-size:.68rem;text-transform:uppercase}.graph-inspector__node-meta[_ngcontent-%COMP%]   dd[_ngcontent-%COMP%]{margin:.15rem 0 0;color:var(--mat-sys-on-surface);font-size:.78rem;word-break:break-word}.graph-inspector__progress[_ngcontent-%COMP%]{height:.4rem;overflow:hidden;border-radius:999px;background:#ffffff14}.graph-inspector__progress-bar[_ngcontent-%COMP%]{height:100%;border-radius:inherit;background:var(--app-color-pass)}.graph-inspector__progress-label[_ngcontent-%COMP%], .graph-inspector__empty-detail[_ngcontent-%COMP%]{margin:0;color:var(--mat-sys-on-surface-variant);font-size:.82rem}.graph-inspector__node-detail[_ngcontent-%COMP%]{margin:0;max-height:11rem;padding:.7rem;overflow:auto;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface);color:var(--mat-sys-on-surface);font-size:.78rem;line-height:1.45;white-space:pre-wrap;word-break:break-word}.graph-inspector__ref-section[_ngcontent-%COMP%]{display:flex;flex-direction:column;gap:.4rem}.graph-inspector__ref-section[_ngcontent-%COMP%]   h5[_ngcontent-%COMP%]{margin:0;color:var(--mat-sys-on-surface);font-size:.76rem;text-transform:uppercase}.graph-inspector__ref-row[_ngcontent-%COMP%]{display:grid;grid-template-columns:minmax(0,1fr);gap:.15rem;width:100%;padding:.55rem;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface-container-high);color:var(--mat-sys-on-surface);text-align:left;cursor:pointer}.graph-inspector__ref-row[_ngcontent-%COMP%]:hover{background:#ffffff14;border-color:var(--mat-sys-primary)}.graph-inspector__ref-row.selected[_ngcontent-%COMP%]{background:var(--app-color-running-bg);border-color:var(--mat-sys-primary)}.graph-inspector__ref-row[_ngcontent-%COMP%]   code[_ngcontent-%COMP%], .graph-inspector__ref-row[_ngcontent-%COMP%]   small[_ngcontent-%COMP%], .graph-inspector__ref-row[_ngcontent-%COMP%]   span[_ngcontent-%COMP%]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.graph-inspector__ref-row[_ngcontent-%COMP%]   code[_ngcontent-%COMP%]{color:var(--mat-sys-primary);font-size:.74rem}.graph-inspector__ref-row[_ngcontent-%COMP%]   span[_ngcontent-%COMP%]{color:var(--mat-sys-on-surface);font-size:.78rem}.graph-inspector__ref-row[_ngcontent-%COMP%]   small[_ngcontent-%COMP%]{color:var(--mat-sys-outline);font-size:.68rem}.graph-inspector__ref-preview[_ngcontent-%COMP%]{display:flex;flex-direction:column;gap:.4rem;padding:.7rem;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface)}.graph-inspector__ref-preview.error[_ngcontent-%COMP%]{border-color:var(--app-color-fail);background:var(--app-color-fail-bg)}.graph-inspector__ref-preview[_ngcontent-%COMP%]   h5[_ngcontent-%COMP%], .graph-inspector__ref-preview[_ngcontent-%COMP%]   p[_ngcontent-%COMP%]{margin:0}.graph-inspector__ref-preview[_ngcontent-%COMP%]   h5[_ngcontent-%COMP%]{color:var(--mat-sys-on-surface);font-size:.82rem}.graph-inspector__ref-preview[_ngcontent-%COMP%]   p[_ngcontent-%COMP%], .graph-inspector__ref-preview[_ngcontent-%COMP%]   small[_ngcontent-%COMP%]{color:var(--mat-sys-on-surface-variant);font-size:.76rem}.graph-inspector__ref-preview[_ngcontent-%COMP%]   pre[_ngcontent-%COMP%]{margin:0;max-height:18rem;padding:.65rem;overflow:auto;border-radius:4px;background:var(--mat-sys-surface-container-high);color:var(--mat-sys-on-surface);font-size:.74rem;line-height:1.45;white-space:pre-wrap;word-break:break-word}.graph-inspector__ref-preview-heading[_ngcontent-%COMP%]{display:flex;align-items:center;justify-content:space-between;gap:.5rem}.graph-inspector__ref-preview-heading[_ngcontent-%COMP%]   span[_ngcontent-%COMP%]{padding:.12rem .4rem;border-radius:999px;background:var(--app-color-warn-bg);color:var(--app-color-warn);font-size:.68rem;text-transform:uppercase}.graph-inspector__dependencies[_ngcontent-%COMP%]{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;color:var(--mat-sys-on-surface-variant);font-size:.75rem}.graph-inspector__dependencies[_ngcontent-%COMP%]   code[_ngcontent-%COMP%]{padding:.12rem .35rem;border-radius:4px;background:#ffffff14;color:var(--mat-sys-on-surface)}@media(max-width:900px){[_nghost-%COMP%]{max-height:24rem;border-top:1px solid var(--mat-sys-outline-variant);border-left:none}}"], changeDetection: 0 }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(GraphInspectorComponent, [{
        type: Component,
        args: [{ selector: 'app-graph-inspector', host: { class: 'app-graph-inspector' }, imports: [CommonModule, MatIconModule, MatTooltipModule], changeDetection: ChangeDetectionStrategy.OnPush, template: "@if (node(); as node) {\r\n  <div\r\n    class=\"graph-inspector__node-heading\"\r\n    [attr.data-status]=\"node.status\"\r\n    style=\"display: flex; align-items: center; justify-content: space-between; gap: 8px;\"\r\n  >\r\n    <div style=\"display: flex; align-items: center; gap: 8px; flex: 1;\">\r\n      <span class=\"graph-inspector__status-dot\"></span>\r\n      <div>\r\n        <h4>{{ node.title }}</h4>\r\n        <p>{{ node.id }} - {{ node.status }}</p>\r\n      </div>\r\n    </div>\r\n    <button\r\n      type=\"button\"\r\n      class=\"graph-inspector__copy-agent\"\r\n      (click)=\"copyNodeForAgent(node)\"\r\n      [matTooltip]=\"copiedNodeId() === node.id ? 'Copied!' : 'Copy node details for Agent'\"\r\n      style=\"display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 8px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; color: rgba(255, 255, 255, 0.8); cursor: pointer; font-size: 11px; height: 26px;\"\r\n    >\r\n      <mat-icon style=\"font-size: 14px; width: 14px; height: 14px; line-height: 14px;\">content_copy</mat-icon>\r\n      <span>{{ copiedNodeId() === node.id ? 'Copied!' : 'Copy for Agent' }}</span>\r\n    </button>\r\n  </div>\r\n\r\n  @if (hasSubgraph()) {\r\n    <button type=\"button\" class=\"graph-inspector__enter-subgraph\" (click)=\"enterSubgraph.emit()\">\r\n      <mat-icon>account_tree</mat-icon>\r\n      <span>Enter subgraph</span>\r\n    </button>\r\n  }\r\n\r\n  <dl class=\"graph-inspector__node-meta\">\r\n    @if (node.type) {\r\n      <div>\r\n        <dt>Type</dt>\r\n        <dd>{{ node.type }}</dd>\r\n      </div>\r\n    }\r\n    @if (node.startedAt) {\r\n      <div>\r\n        <dt>Started</dt>\r\n        <dd>{{ node.startedAt | date : 'mediumTime' }}</dd>\r\n      </div>\r\n    }\r\n    @if (node.endedAt) {\r\n      <div>\r\n        <dt>Ended</dt>\r\n        <dd>{{ node.endedAt | date : 'mediumTime' }}</dd>\r\n      </div>\r\n    }\r\n    @if (node.durationMs != null) {\r\n      <div>\r\n        <dt>Duration</dt>\r\n        <dd>{{ node.durationMs / 1000 | number : '1.1-2' }}s</dd>\r\n      </div>\r\n    }\r\n    @if (node.progressPercent != null) {\r\n      <div>\r\n        <dt>Progress</dt>\r\n        <dd>{{ node.progressPercent | number : '1.0-0' }}%</dd>\r\n      </div>\r\n    }\r\n  </dl>\r\n\r\n  @if (node.progressPercent != null) {\r\n    <div class=\"graph-inspector__progress\">\r\n      <div class=\"graph-inspector__progress-bar\" [style.width.%]=\"node.progressPercent\"></div>\r\n    </div>\r\n    @if (node.progressLabel) {\r\n      <p class=\"graph-inspector__progress-label\">{{ node.progressLabel }}</p>\r\n    }\r\n  }\r\n\r\n  @if (node.detail || node.error) {\r\n    <pre class=\"graph-inspector__node-detail\">{{ node.detail || node.error }}</pre>\r\n  } @else {\r\n    <p class=\"graph-inspector__empty-detail\">No detail has been published for this node yet.</p>\r\n  }\r\n\r\n  @for (group of selectedNodeRefGroups(); track group.kind) {\r\n    <div class=\"graph-inspector__ref-section\">\r\n      <h5>{{ group.title }}</h5>\r\n      @for (ref of group.refs; track ref.id) {\r\n        <button\r\n          type=\"button\"\r\n          class=\"graph-inspector__ref-row\"\r\n          [class.selected]=\"isSelectedRef(node.id, group.kind, ref.id)\"\r\n          (click)=\"openNodeRef(node.id, group.kind, ref)\"\r\n        >\r\n          <code>{{ readRefLabel(ref) }}</code>\r\n          <span>{{ readRefSummary(ref) }}</span>\r\n          @if (readRefPath(ref); as refPath) {\r\n            <small>{{ refPath }}</small>\r\n          }\r\n        </button>\r\n      }\r\n    </div>\r\n  } @empty {\r\n    <p class=\"graph-inspector__empty-detail\">No refs have been published for this node yet.</p>\r\n  }\r\n\r\n  @if (selectedRefLoading()) {\r\n    <div class=\"graph-inspector__ref-preview\">\r\n      <h5>Preview</h5>\r\n      <p>Loading ref...</p>\r\n    </div>\r\n  } @else if (selectedRefError()) {\r\n    <div class=\"graph-inspector__ref-preview error\">\r\n      <h5>Preview</h5>\r\n      <p>{{ selectedRefError() }}</p>\r\n    </div>\r\n  } @else if (selectedRefContent(); as refContent) {\r\n    <div class=\"graph-inspector__ref-preview\">\r\n      <div class=\"graph-inspector__ref-preview-heading\">\r\n        <h5>{{ readRefLabel(refContent.ref) }}</h5>\r\n        @if (refContent.truncated) {\r\n          <span>truncated</span>\r\n        }\r\n      </div>\r\n      @if (refContent.path) {\r\n        <small>{{ refContent.path }}</small>\r\n      }\r\n      <pre>{{ selectedRefDisplayText() }}</pre>\r\n    </div>\r\n  }\r\n\r\n  @if (node.dependencies && node.dependencies.length > 0) {\r\n    <div class=\"graph-inspector__dependencies\">\r\n      <span>Depends on</span>\r\n      @for (dependency of node.dependencies; track dependency) {\r\n        <code>{{ dependency }}</code>\r\n      }\r\n    </div>\r\n  }\r\n} @else {\r\n  <p class=\"graph-inspector__empty-detail\">Select a node to inspect it.</p>\r\n}\r\n", styles: [":host{display:flex;flex-direction:column;gap:.85rem;min-width:0;max-height:100%;padding:1rem;overflow:auto;border-left:1px solid var(--mat-sys-outline-variant);background:var(--mat-sys-surface-container)}.graph-inspector__enter-subgraph{display:inline-flex;align-items:center;gap:.35rem;align-self:flex-start;padding:.35rem .7rem;border:1px solid var(--mat-sys-primary);border-radius:6px;background:var(--app-color-running-bg);color:var(--mat-sys-on-surface);font-size:.78rem;cursor:pointer}.graph-inspector__enter-subgraph:hover{background:#ffffff1f}.graph-inspector__enter-subgraph mat-icon{width:1rem;height:1rem;font-size:1rem;line-height:1rem}.graph-inspector__node-heading{display:flex;align-items:flex-start;gap:.65rem}.graph-inspector__node-heading h4{margin:0;color:var(--mat-sys-on-surface);font-size:1rem;line-height:1.25}.graph-inspector__node-heading p{margin:.15rem 0 0;color:var(--mat-sys-on-surface-variant);font-family:ui-monospace,Cascadia Code,Consolas,monospace;font-size:.72rem;word-break:break-word}.graph-inspector__node-heading[data-status=complete] .graph-inspector__status-dot{background:var(--app-color-pass)}.graph-inspector__node-heading[data-status=failed] .graph-inspector__status-dot{background:var(--app-color-fail)}.graph-inspector__node-heading[data-status=running] .graph-inspector__status-dot{background:var(--app-color-pass);box-shadow:0 0 .45rem var(--app-color-pass)}.graph-inspector__node-heading[data-status=skipped] .graph-inspector__status-dot{background:var(--app-color-warn)}.graph-inspector__status-dot{flex:0 0 auto;width:.7rem;height:.7rem;margin-top:.3rem;border-radius:999px;background:var(--mat-sys-outline)}.graph-inspector__node-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin:0}.graph-inspector__node-meta div{min-width:0;padding:.5rem;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface-container-high)}.graph-inspector__node-meta dt{color:var(--mat-sys-outline);font-size:.68rem;text-transform:uppercase}.graph-inspector__node-meta dd{margin:.15rem 0 0;color:var(--mat-sys-on-surface);font-size:.78rem;word-break:break-word}.graph-inspector__progress{height:.4rem;overflow:hidden;border-radius:999px;background:#ffffff14}.graph-inspector__progress-bar{height:100%;border-radius:inherit;background:var(--app-color-pass)}.graph-inspector__progress-label,.graph-inspector__empty-detail{margin:0;color:var(--mat-sys-on-surface-variant);font-size:.82rem}.graph-inspector__node-detail{margin:0;max-height:11rem;padding:.7rem;overflow:auto;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface);color:var(--mat-sys-on-surface);font-size:.78rem;line-height:1.45;white-space:pre-wrap;word-break:break-word}.graph-inspector__ref-section{display:flex;flex-direction:column;gap:.4rem}.graph-inspector__ref-section h5{margin:0;color:var(--mat-sys-on-surface);font-size:.76rem;text-transform:uppercase}.graph-inspector__ref-row{display:grid;grid-template-columns:minmax(0,1fr);gap:.15rem;width:100%;padding:.55rem;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface-container-high);color:var(--mat-sys-on-surface);text-align:left;cursor:pointer}.graph-inspector__ref-row:hover{background:#ffffff14;border-color:var(--mat-sys-primary)}.graph-inspector__ref-row.selected{background:var(--app-color-running-bg);border-color:var(--mat-sys-primary)}.graph-inspector__ref-row code,.graph-inspector__ref-row small,.graph-inspector__ref-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.graph-inspector__ref-row code{color:var(--mat-sys-primary);font-size:.74rem}.graph-inspector__ref-row span{color:var(--mat-sys-on-surface);font-size:.78rem}.graph-inspector__ref-row small{color:var(--mat-sys-outline);font-size:.68rem}.graph-inspector__ref-preview{display:flex;flex-direction:column;gap:.4rem;padding:.7rem;border:1px solid var(--mat-sys-outline-variant);border-radius:6px;background:var(--mat-sys-surface)}.graph-inspector__ref-preview.error{border-color:var(--app-color-fail);background:var(--app-color-fail-bg)}.graph-inspector__ref-preview h5,.graph-inspector__ref-preview p{margin:0}.graph-inspector__ref-preview h5{color:var(--mat-sys-on-surface);font-size:.82rem}.graph-inspector__ref-preview p,.graph-inspector__ref-preview small{color:var(--mat-sys-on-surface-variant);font-size:.76rem}.graph-inspector__ref-preview pre{margin:0;max-height:18rem;padding:.65rem;overflow:auto;border-radius:4px;background:var(--mat-sys-surface-container-high);color:var(--mat-sys-on-surface);font-size:.74rem;line-height:1.45;white-space:pre-wrap;word-break:break-word}.graph-inspector__ref-preview-heading{display:flex;align-items:center;justify-content:space-between;gap:.5rem}.graph-inspector__ref-preview-heading span{padding:.12rem .4rem;border-radius:999px;background:var(--app-color-warn-bg);color:var(--app-color-warn);font-size:.68rem;text-transform:uppercase}.graph-inspector__dependencies{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;color:var(--mat-sys-on-surface-variant);font-size:.75rem}.graph-inspector__dependencies code{padding:.12rem .35rem;border-radius:4px;background:#ffffff14;color:var(--mat-sys-on-surface)}@media(max-width:900px){:host{max-height:24rem;border-top:1px solid var(--mat-sys-outline-variant);border-left:none}}\n"] }]
    }], () => [], { node: [{ type: i0.Input, args: [{ isSignal: true, alias: "node", required: false }] }], runId: [{ type: i0.Input, args: [{ isSignal: true, alias: "runId", required: false }] }], hasSubgraph: [{ type: i0.Input, args: [{ isSignal: true, alias: "hasSubgraph", required: false }] }], enterSubgraph: [{ type: i0.Output, args: ["enterSubgraph"] }] }); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(GraphInspectorComponent, { className: "GraphInspectorComponent", filePath: "lib/graph-inspector/graph-inspector.component.ts", lineNumber: 81 }); })();

function TaskGraphComponent_Conditional_2_Template(rf, ctx) { if (rf & 1) {
    const _r2 = i0.ɵɵgetCurrentView();
    i0.ɵɵelementStart(0, "app-graph-inspector", 3);
    i0.ɵɵlistener("enterSubgraph", function TaskGraphComponent_Conditional_2_Template_app_graph_inspector_enterSubgraph_0_listener() { i0.ɵɵrestoreView(_r2); i0.ɵɵnextContext(); const canvas_r3 = i0.ɵɵreference(1); return i0.ɵɵresetView(canvas_r3.enterSelectedSubgraph()); });
    i0.ɵɵelementEnd();
} if (rf & 2) {
    const ctx_r3 = i0.ɵɵnextContext();
    const canvas_r3 = i0.ɵɵreference(1);
    i0.ɵɵproperty("node", canvas_r3.selectedNode())("runId", ctx_r3.runId())("hasSubgraph", canvas_r3.selectedNodeHasSubgraph());
} }
/**
 * Default composition of the graph canvas + projected inspector.
 *
 * PURPOSE: Preserve the original `<app-task-graph>` API — one component a host
 * drops in with `[nodes]`, `[showInspector]`, etc. — by wiring the new
 * {@link GraphCanvasComponent} (rendering/interaction) to the optional
 * {@link GraphInspectorComponent} projected into its `[detail]` slot.
 *
 * VALUE: Existing consumers (task-live page, the workflows demo) keep working
 * unchanged, while projects that want a custom layout can compose the canvas and
 * their own chrome directly. The inspector binds to the canvas's exposed
 * `selectedNode` via a template ref, so selection state lives in one place.
 */
class TaskGraphComponent {
    constructor() {
        /** Execution nodes to render. The host owns their lifecycle and status. */
        this.nodes = input.required(...(ngDevMode ? [{ debugName: "nodes" }] : []));
        /**
         * Runtime/story edges. When omitted, edges fall back to per-node
         * `transitions`, then to `dependencies` so a dependency-only graph still draws.
         */
        this.transitions = input(null, ...(ngDevMode ? [{ debugName: "transitions" }] : []));
        /** Currently selected node id (highlight only; host owns the value). */
        this.selectedNodeId = input(null, ...(ngDevMode ? [{ debugName: "selectedNodeId" }] : []));
        /** Durable run id used for loading ref previews from the local daemon. */
        this.runId = input(null, ...(ngDevMode ? [{ debugName: "runId" }] : []));
        /** Whether to render the selected-node detail inspector beside the graph. */
        this.showInspector = input(false, ...(ngDevMode ? [{ debugName: "showInspector" }] : []));
        /** The node to mark as the live "current" focus, if any. */
        this.currentNodeId = input(null, ...(ngDevMode ? [{ debugName: "currentNodeId" }] : []));
        /** Per-node display overrides, keyed by real node id. */
        this.decorations = input({}, ...(ngDevMode ? [{ debugName: "decorations" }] : []));
        /**
         * Status → visual-treatment overrides, merged over the canvas defaults.
         *
         * VALUE: A host defines its own status vocabulary/colours (and can add states
         * beyond the built-in five) without forking the component.
         */
        this.statusStyles = input({}, ...(ngDevMode ? [{ debugName: "statusStyles" }] : []));
        /** Breadcrumb label for the root (top-level) graph. */
        this.rootLabel = input('Main', ...(ngDevMode ? [{ debugName: "rootLabel" }] : []));
        /** Whether to render the breadcrumb overlay while inside a subgraph. */
        this.showBreadcrumb = input(true, ...(ngDevMode ? [{ debugName: "showBreadcrumb" }] : []));
        /**
         * Whether drillable nodes show a small, static thumbnail of their child graph.
         *
         * VALUE: Decorative only; set false to drop the inline subgraph previews.
         */
        this.showSubgraphPreview = input(true, ...(ngDevMode ? [{ debugName: "showSubgraphPreview" }] : []));
        /**
         * Resolves a node's child graph. When omitted, the node's inline
         * `subgraph` is used.
         */
        this.subgraphResolver = input(null, ...(ngDevMode ? [{ debugName: "subgraphResolver" }] : []));
        /**
         * Externally-controlled subgraph path (root node ids drilled into) — the
         * history seam a host drives from its router for browser back/forward.
         */
        this.path = input([], ...(ngDevMode ? [{ debugName: "path" }] : []));
        /**
         * When true, the camera keeps the running ("green") nodes framed as the run
         * progresses.
         */
        this.followExecution = input(false, ...(ngDevMode ? [{ debugName: "followExecution" }] : []));
        /** Emits the real node id when a node is clicked. */
        this.nodeSelected = output();
        /** Emits when the user drills into a node's subgraph. */
        this.subgraphEntered = output();
        /** Emits when the user leaves a subgraph (one or more levels up). */
        this.subgraphLeft = output();
        /** Emits the new root→current node-id path whenever the user navigates subgraphs. */
        this.graphPathChange = output();
    }
    static { this.ɵfac = function TaskGraphComponent_Factory(__ngFactoryType__) { return new (__ngFactoryType__ || TaskGraphComponent)(); }; }
    static { this.ɵcmp = /*@__PURE__*/ i0.ɵɵdefineComponent({ type: TaskGraphComponent, selectors: [["app-task-graph"]], hostAttrs: [1, "app-task-graph"], inputs: { nodes: [1, "nodes"], transitions: [1, "transitions"], selectedNodeId: [1, "selectedNodeId"], runId: [1, "runId"], showInspector: [1, "showInspector"], currentNodeId: [1, "currentNodeId"], decorations: [1, "decorations"], statusStyles: [1, "statusStyles"], rootLabel: [1, "rootLabel"], showBreadcrumb: [1, "showBreadcrumb"], showSubgraphPreview: [1, "showSubgraphPreview"], subgraphResolver: [1, "subgraphResolver"], path: [1, "path"], followExecution: [1, "followExecution"] }, outputs: { nodeSelected: "nodeSelected", subgraphEntered: "subgraphEntered", subgraphLeft: "subgraphLeft", graphPathChange: "graphPathChange" }, decls: 3, vars: 14, consts: [["canvas", ""], [3, "nodeSelected", "subgraphEntered", "subgraphLeft", "graphPathChange", "nodes", "transitions", "selectedNodeId", "currentNodeId", "decorations", "statusStyles", "rootLabel", "showBreadcrumb", "showSubgraphPreview", "subgraphResolver", "path", "followExecution", "showDetail"], ["detail", "", 3, "node", "runId", "hasSubgraph"], ["detail", "", 3, "enterSubgraph", "node", "runId", "hasSubgraph"]], template: function TaskGraphComponent_Template(rf, ctx) { if (rf & 1) {
            const _r1 = i0.ɵɵgetCurrentView();
            i0.ɵɵelementStart(0, "app-graph-canvas", 1, 0);
            i0.ɵɵlistener("nodeSelected", function TaskGraphComponent_Template_app_graph_canvas_nodeSelected_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.nodeSelected.emit($event)); })("subgraphEntered", function TaskGraphComponent_Template_app_graph_canvas_subgraphEntered_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.subgraphEntered.emit($event)); })("subgraphLeft", function TaskGraphComponent_Template_app_graph_canvas_subgraphLeft_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.subgraphLeft.emit($event)); })("graphPathChange", function TaskGraphComponent_Template_app_graph_canvas_graphPathChange_0_listener($event) { i0.ɵɵrestoreView(_r1); return i0.ɵɵresetView(ctx.graphPathChange.emit($event)); });
            i0.ɵɵconditionalCreate(2, TaskGraphComponent_Conditional_2_Template, 1, 3, "app-graph-inspector", 2);
            i0.ɵɵelementEnd();
        } if (rf & 2) {
            i0.ɵɵproperty("nodes", ctx.nodes())("transitions", ctx.transitions())("selectedNodeId", ctx.selectedNodeId())("currentNodeId", ctx.currentNodeId())("decorations", ctx.decorations())("statusStyles", ctx.statusStyles())("rootLabel", ctx.rootLabel())("showBreadcrumb", ctx.showBreadcrumb())("showSubgraphPreview", ctx.showSubgraphPreview())("subgraphResolver", ctx.subgraphResolver())("path", ctx.path())("followExecution", ctx.followExecution())("showDetail", ctx.showInspector());
            i0.ɵɵadvance(2);
            i0.ɵɵconditional(ctx.showInspector() ? 2 : -1);
        } }, dependencies: [GraphCanvasComponent, GraphInspectorComponent], styles: ["[_nghost-%COMP%]{display:block;width:100%;height:100%;min-height:16rem}app-graph-canvas[_ngcontent-%COMP%]{width:100%;height:100%}"], changeDetection: 0 }); }
}
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassMetadata(TaskGraphComponent, [{
        type: Component,
        args: [{ selector: 'app-task-graph', host: { class: 'app-task-graph' }, imports: [GraphCanvasComponent, GraphInspectorComponent], changeDetection: ChangeDetectionStrategy.OnPush, template: "<app-graph-canvas\r\n  #canvas\r\n  [nodes]=\"nodes()\"\r\n  [transitions]=\"transitions()\"\r\n  [selectedNodeId]=\"selectedNodeId()\"\r\n  [currentNodeId]=\"currentNodeId()\"\r\n  [decorations]=\"decorations()\"\r\n  [statusStyles]=\"statusStyles()\"\r\n  [rootLabel]=\"rootLabel()\"\r\n  [showBreadcrumb]=\"showBreadcrumb()\"\r\n  [showSubgraphPreview]=\"showSubgraphPreview()\"\r\n  [subgraphResolver]=\"subgraphResolver()\"\r\n  [path]=\"path()\"\r\n  [followExecution]=\"followExecution()\"\r\n  [showDetail]=\"showInspector()\"\r\n  (nodeSelected)=\"nodeSelected.emit($event)\"\r\n  (subgraphEntered)=\"subgraphEntered.emit($event)\"\r\n  (subgraphLeft)=\"subgraphLeft.emit($event)\"\r\n  (graphPathChange)=\"graphPathChange.emit($event)\"\r\n>\r\n  @if (showInspector()) {\r\n    <app-graph-inspector\r\n      detail\r\n      [node]=\"canvas.selectedNode()\"\r\n      [runId]=\"runId()\"\r\n      [hasSubgraph]=\"canvas.selectedNodeHasSubgraph()\"\r\n      (enterSubgraph)=\"canvas.enterSelectedSubgraph()\"\r\n    />\r\n  }\r\n</app-graph-canvas>\r\n", styles: [":host{display:block;width:100%;height:100%;min-height:16rem}app-graph-canvas{width:100%;height:100%}\n"] }]
    }], null, { nodes: [{ type: i0.Input, args: [{ isSignal: true, alias: "nodes", required: true }] }], transitions: [{ type: i0.Input, args: [{ isSignal: true, alias: "transitions", required: false }] }], selectedNodeId: [{ type: i0.Input, args: [{ isSignal: true, alias: "selectedNodeId", required: false }] }], runId: [{ type: i0.Input, args: [{ isSignal: true, alias: "runId", required: false }] }], showInspector: [{ type: i0.Input, args: [{ isSignal: true, alias: "showInspector", required: false }] }], currentNodeId: [{ type: i0.Input, args: [{ isSignal: true, alias: "currentNodeId", required: false }] }], decorations: [{ type: i0.Input, args: [{ isSignal: true, alias: "decorations", required: false }] }], statusStyles: [{ type: i0.Input, args: [{ isSignal: true, alias: "statusStyles", required: false }] }], rootLabel: [{ type: i0.Input, args: [{ isSignal: true, alias: "rootLabel", required: false }] }], showBreadcrumb: [{ type: i0.Input, args: [{ isSignal: true, alias: "showBreadcrumb", required: false }] }], showSubgraphPreview: [{ type: i0.Input, args: [{ isSignal: true, alias: "showSubgraphPreview", required: false }] }], subgraphResolver: [{ type: i0.Input, args: [{ isSignal: true, alias: "subgraphResolver", required: false }] }], path: [{ type: i0.Input, args: [{ isSignal: true, alias: "path", required: false }] }], followExecution: [{ type: i0.Input, args: [{ isSignal: true, alias: "followExecution", required: false }] }], nodeSelected: [{ type: i0.Output, args: ["nodeSelected"] }], subgraphEntered: [{ type: i0.Output, args: ["subgraphEntered"] }], subgraphLeft: [{ type: i0.Output, args: ["subgraphLeft"] }], graphPathChange: [{ type: i0.Output, args: ["graphPathChange"] }] }); })();
(() => { (typeof ngDevMode === "undefined" || ngDevMode) && i0.ɵsetClassDebugInfo(TaskGraphComponent, { className: "TaskGraphComponent", filePath: "lib/task-graph.component.ts", lineNumber: 48 }); })();

/**
 * Generated bundle index. Do not edit.
 */

export { GraphCameraComponent, GraphCanvasComponent, GraphInspectorComponent, TASK_GRAPH_REF_LOADER, TaskGraphComponent };
//# sourceMappingURL=daxur-studios-mermaid-runtime.mjs.map
