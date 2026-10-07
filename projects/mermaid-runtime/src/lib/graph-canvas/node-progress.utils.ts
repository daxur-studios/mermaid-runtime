import type { MermaidRuntime } from "../task-graph-model";
import type { OffsetShapeGeometry } from "./shape-offset.utils";

/**
 * Statuses that mean a node has finished, whatever the outcome.
 *
 * PURPOSE: A finished node's status colour already says how it ended, so its
 * progress ring is redundant there and reads as a second border.
 *
 * VALUE: Matches the daemon's roll-up rule, where failed and skipped nodes
 * count as settled alongside complete ones.
 */
const SETTLED_NODE_STATUSES: ReadonlySet<MermaidRuntime.NodeStatus> = new Set(["complete", "failed", "skipped"]);

/**
 * Horizontal inset (px) of the progress badge's right edge from the node shape's right edge.
 *
 * VALUE: Keeps the badge on the straight part of the bottom border, clear of
 * the rounded corner and of Mermaid's `subroutine` side bars.
 */
const PROGRESS_BADGE_INSET_X_PX = 10;

/**
 * How far (px) below the node's bottom border the badge's vertical centre sits.
 *
 * VALUE: Mermaid sizes nodes tightly around their title, so a badge centred
 * exactly on the border would touch the title's last line; nudging it down
 * keeps it clear while it still reads as attached to the node.
 */
const PROGRESS_BADGE_DROP_PX = 2;

/** Height (px) of the progress badge pill. */
const PROGRESS_BADGE_HEIGHT_PX = 12;

/** Horizontal padding (px) inside the progress badge on each side of the text. */
const PROGRESS_BADGE_PADDING_X_PX = 4;

/**
 * Estimated width (px) of one character of the badge text (tabular digits at
 * the badge font size).
 *
 * PURPOSE: Size the pill without measuring text, which would force a
 * synchronous layout on every progress tick (see computeOutlinePerimeterLength).
 */
const PROGRESS_BADGE_CHAR_WIDTH_PX = 6;

/** The progress values a node should actually draw. */
export interface VisibleNodeProgress {
  /** The overall ring's percent, or `null` for no overall ring. */
  readonly percent: number | null;
  /** One fainter ring per running child node. */
  readonly childPercents: readonly number[];
}

/**
 * Whether `status` means the node has finished (complete, failed or skipped).
 *
 * VALUE: Host-defined statuses (e.g. `queued`, `blocked`) count as unsettled,
 * so they keep their ring.
 */
export function isSettledNodeStatus(status: MermaidRuntime.NodeStatus): boolean {
  return SETTLED_NODE_STATUSES.has(status);
}

/**
 * Picks which of a node's progress values are drawn as rings.
 *
 * PURPOSE: Hide rings that add noise: on finished nodes (they look
 * double-bordered) and at 0% (a label with nothing to show), and optionally
 * the per-running-node rings.
 *
 * VALUE: The canvas draws exactly what this returns, so the rule is one
 * unit-tested function rather than conditions spread through DOM code.
 */
export function selectVisibleNodeProgress(
  status: MermaidRuntime.NodeStatus,
  percent: number | null,
  childPercents: readonly number[],
  visibility: MermaidRuntime.ProgressRingVisibility,
  showChildRings: boolean,
): VisibleNodeProgress {
  const children = showChildRings ? childPercents : [];
  if (visibility === "always") return { percent, childPercents: children };
  if (isSettledNodeStatus(status)) return { percent: null, childPercents: [] };
  return {
    percent: percent !== null && percent > 0 ? percent : null,
    childPercents: children.filter((child) => child > 0),
  };
}

/** Text between the percentage and the time in a node's readout (for example `42% · 1m 05s`). */
const READOUT_SEPARATOR = " · ";

/**
 * Joins a node's percentage and time into the one line its badge shows.
 *
 * VALUE: A running step shows both (`42% · 1m 05s`), a finished one just its time, and
 * one with neither gets an empty string, which means "draw no badge".
 */
export function composeNodeReadout(percent: number | null, timeText: string): string {
  const parts: string[] = [];
  if (percent !== null) parts.push(`${percent}%`);
  if (timeText) parts.push(timeText);
  return parts.join(READOUT_SEPARATOR);
}

/** The progress badge's box, in the node shape's local coordinates. */
export interface ProgressBadgeBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Places the progress badge (a small pill showing `NN%`) on the node's own border.
 *
 * PURPOSE: Text drawn above the node collided with edges and group titles,
 * and text inside the node collided with the title, because Mermaid sizes
 * nodes tightly around it. The bottom-right border is free: edges attach at
 * side or top/bottom midpoints, and the drill-down badge uses the top-right corner.
 *
 * VALUE: Rects (and the `subroutine` envelope) get the badge on the bottom
 * border near the right corner; diamonds get it on the midpoint of the
 * lower-right side, away from the vertices where edges attach.
 */
export function computeProgressBadgeBox(geometry: OffsetShapeGeometry, text: string): ProgressBadgeBox {
  const width = text.length * PROGRESS_BADGE_CHAR_WIDTH_PX + 2 * PROGRESS_BADGE_PADDING_X_PX;
  const height = PROGRESS_BADGE_HEIGHT_PX;

  if (geometry.kind === "rect") {
    const right = geometry.x + geometry.width - PROGRESS_BADGE_INSET_X_PX;
    const centerY = geometry.y + geometry.height + PROGRESS_BADGE_DROP_PX;
    return { x: right - width, y: centerY - height / 2, width, height };
  }

  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  const rightX = Math.max(...xs);
  const bottomY = Math.max(...ys);
  const centerX = (Math.min(...xs) + rightX) / 2;
  const centerY = (Math.min(...ys) + bottomY) / 2;
  const midX = (rightX + centerX) / 2;
  const midY = (centerY + bottomY) / 2;
  return { x: midX - width / 2, y: midY - height / 2, width, height };
}
