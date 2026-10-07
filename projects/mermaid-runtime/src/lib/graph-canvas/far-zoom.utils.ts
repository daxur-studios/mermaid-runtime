import type { MermaidRuntime } from "../task-graph-model";
import { formatDurationMs, getLiveNodeTimeMs } from "./run-summary.utils";

/** How close the viewer is: `near` shows full node text, `far` shows one short line per node. */
export type ZoomBand = "near" | "far";

/**
 * Zoom (scale) below which nodes switch to their far text, unless the host sets another.
 *
 * VALUE: Node text is about 12 px at scale 1; below this it is about 7 px, already
 * hard to read, which is the point where a time or percentage helps more. Near text
 * returns above this times {@link FAR_ZOOM_EXIT_FACTOR}.
 */
export const DEFAULT_FAR_ZOOM_SCALE = 0.6;

/**
 * How much the zoom must rise above the far threshold before near text returns.
 *
 * VALUE: A gap between going far and coming back, so a viewer hovering at the
 * threshold does not see the text flicker between the two.
 */
export const FAR_ZOOM_EXIT_FACTOR = 1.2;

/** Picks the band for a zoom, keeping the current band inside the gap around the threshold. A null threshold means always near. */
export function nextZoomBand(current: ZoomBand, scale: number, farBelowScale: number | null): ZoomBand {
  if (farBelowScale === null) return "near";
  if (current === "near") return scale < farBelowScale ? "far" : "near";
  return scale > farBelowScale * FAR_ZOOM_EXIT_FACTOR ? "near" : "far";
}

/**
 * The text a step shows when zoomed far out.
 *
 * VALUE: A host's `farLabel` wins when it returns a string (an empty string means
 * "show nothing"); null or undefined falls back to the default. The default is
 * `NN%` while a step reports progress, a counting-up time while it runs without
 * progress, its time once done or failed, and nothing before it starts.
 */
export function resolveFarLabel(
  node: MermaidRuntime.Node,
  nowMs: number,
  override?: ((node: MermaidRuntime.Node) => string | null | undefined) | null,
): string {
  const custom = override?.(node);
  if (typeof custom === "string") return custom;
  if (node.status === "running" && typeof node.progressPercent === "number") return `${Math.round(node.progressPercent)}%`;
  return formatDurationMs(getLiveNodeTimeMs(node, nowMs));
}
