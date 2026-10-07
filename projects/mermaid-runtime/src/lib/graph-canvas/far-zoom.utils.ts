import type { MermaidRuntime } from "../task-graph-model";

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

/**
 * Most characters of a node's name shown in the middle of it when zoomed far out and it has
 * nothing else to show (no icon, chip, percentage or time).
 *
 * VALUE: Keeps such a step from being a blank box, while short enough to be drawn large.
 */
export const FAR_NAME_MAX_CHARS = 10;

/** Picks the band for a zoom, keeping the current band inside the gap around the threshold. A null threshold means always near. */
export function nextZoomBand(current: ZoomBand, scale: number, farBelowScale: number | null): ZoomBand {
  if (farBelowScale === null) return "near";
  if (current === "near") return scale < farBelowScale ? "far" : "near";
  return scale > farBelowScale * FAR_ZOOM_EXIT_FACTOR ? "near" : "far";
}

/** Cuts a node's name to {@link FAR_NAME_MAX_CHARS} characters, ending in an ellipsis when it was cut. */
export function shortenNodeName(title: string): string {
  const name = title.trim();
  if (name.length <= FAR_NAME_MAX_CHARS) return name;
  return `${name.slice(0, FAR_NAME_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * The percentage and time line a step shows in the middle of its node when zoomed far out.
 *
 * VALUE: A host's `farLabel` wins when it returns a string (an empty string means
 * "show no line"); null or undefined falls back to `readout`, the node's own
 * percentage and time (see `composeNodeReadout`).
 */
export function resolveFarLabel(node: MermaidRuntime.Node, readout: string, override?: ((node: MermaidRuntime.Node) => string | null | undefined) | null): string {
  const custom = override?.(node);
  return typeof custom === "string" ? custom : readout;
}
