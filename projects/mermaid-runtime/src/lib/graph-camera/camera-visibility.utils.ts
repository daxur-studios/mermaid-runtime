import type { GraphCameraState, GraphRect } from "./graph-camera.component";

/** Size of the camera's viewport in pixels. */
export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Share of the graph that must stay in view for the viewer not to count as lost.
 *
 * VALUE: Panning to look at one corner of a big graph never triggers the "back
 * to graph" prompt, because the viewport is then full of graph. Only a sliver
 * left at the edge, or nothing at all, does.
 */
export const LOST_VISIBLE_FRACTION = 0.1;

/**
 * How much of the graph is on screen, from 0 (none) to 1 (as much as can fit).
 *
 * PURPOSE: Tell "panned far away" from "looking at part of a big graph" without
 * measuring the DOM on every frame.
 *
 * VALUE: The overlap of the graph and the viewport, divided by the smaller of
 * the two areas. A small graph fully in view and a big graph filling the viewport
 * both score 1; a graph panned off screen scores 0. Zooming far out scores 1 as
 * well, so a far-zoom overview is never flagged.
 */
export function computeVisibleContentFraction(content: GraphRect, camera: GraphCameraState, viewport: ViewportSize): number {
  const left = content.x * camera.scale + camera.x;
  const top = content.y * camera.scale + camera.y;
  const right = left + content.width * camera.scale;
  const bottom = top + content.height * camera.scale;
  const overlapWidth = Math.min(right, viewport.width) - Math.max(left, 0);
  const overlapHeight = Math.min(bottom, viewport.height) - Math.max(top, 0);
  if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
  const contentArea = (right - left) * (bottom - top);
  const viewportArea = viewport.width * viewport.height;
  const reference = Math.min(contentArea, viewportArea);
  return reference > 0 ? Math.min(1, (overlapWidth * overlapHeight) / reference) : 0;
}

/** True when so little of the graph is on screen that the viewer should be offered a way back. */
export function isGraphOutOfView(content: GraphRect, camera: GraphCameraState, viewport: ViewportSize): boolean {
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return false;
  return computeVisibleContentFraction(content, camera, viewport) < LOST_VISIBLE_FRACTION;
}
