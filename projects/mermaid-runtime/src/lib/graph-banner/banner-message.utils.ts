import { formatDurationMs, type RunSummary } from "../graph-canvas/run-summary.utils";

/**
 * Look of a banner message.
 *
 * VALUE: Lets a host's own message match the library's: neutral for a hint,
 * green for a good result, red for a bad one.
 */
export type BannerKind = "info" | "success" | "failure";

/**
 * What the banner's button does when pressed.
 *
 * VALUE: `fit` brings the whole graph back into view, `resume-follow` goes back to
 * the running steps, and `dismiss` just hides a run result.
 */
export type BannerAction = "fit" | "resume-follow" | "dismiss";

/**
 * One message for the banner at the top centre of the canvas.
 *
 * PURPOSE: The banner shows one message at a time, so a run result, a "back to
 * graph" prompt and a host's own text can share one slot.
 */
export interface BannerMessage {
  /** Stable key; a change of id replays the slide-in. */
  id: string;
  kind: BannerKind;
  text: string;
  /** Short call to action shown after the text, such as "Back to graph". */
  actionLabel?: string;
  action: BannerAction;
}

/** Message a host can hand to the canvas to show in the same banner slot. */
export interface HostBannerMessage {
  kind?: BannerKind;
  text: string;
}

/** Separator between parts of a banner line. */
const BANNER_SEPARATOR = " · ";

/** Builds the text of a run result, such as `Run complete · 10 of 12 steps · 2 skipped · 48 s`. */
export function describeRunResult(summary: RunSummary): string {
  const parts: string[] = [summary.state === "failed" ? "Run failed" : "Run complete"];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  parts.push(`${summary.complete} of ${summary.total} steps${summary.state === "failed" ? " complete" : ""}`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
  const time = formatDurationMs(summary.durationMs);
  if (time) parts.push(time);
  return parts.join(BANNER_SEPARATOR);
}

/** The state the banner is chosen from. */
export interface BannerInputs {
  run: RunSummary;
  /** True during the few seconds after a run settles. */
  runResultVisible: boolean;
  hostMessage: HostBannerMessage | null;
  /** Little or none of the graph is on screen. */
  outOfView: boolean;
  /** Follow-running is on but the viewer moved the camera. */
  followPaused: boolean;
}

/**
 * Picks the one message the banner shows.
 *
 * VALUE: Priority is a failed run, a completed run, the host's message, "back to
 * graph", then "re-center on running". A result always outranks a navigation
 * hint, because the viewer cares more that the run finished than that the graph
 * is off screen.
 */
export function pickBannerMessage(inputs: BannerInputs): BannerMessage | null {
  const { run, runResultVisible, hostMessage, outOfView, followPaused } = inputs;
  if (runResultVisible && run.state === "failed") return { id: "run-failed", kind: "failure", text: describeRunResult(run), action: "dismiss" };
  if (runResultVisible && run.state === "complete") return { id: "run-complete", kind: "success", text: describeRunResult(run), action: "dismiss" };
  if (hostMessage) return { id: `host:${hostMessage.text}`, kind: hostMessage.kind ?? "info", text: hostMessage.text, action: "dismiss" };
  if (outOfView) return { id: "back-to-graph", kind: "info", text: "The graph is out of view", actionLabel: "Back to graph", action: "fit" };
  if (followPaused) return { id: "recenter-running", kind: "info", text: "Following paused", actionLabel: "Re-center on running", action: "resume-follow" };
  return null;
}
