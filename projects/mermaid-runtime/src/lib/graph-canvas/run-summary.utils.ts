import type { MermaidRuntime } from "../task-graph-model";

/**
 * Where a run stands, read from its steps' statuses.
 *
 * VALUE: One word a banner, a pill or a host can switch on, instead of each
 * re-deriving it from the node list.
 */
export type RunState = "idle" | "running" | "complete" | "failed";

/**
 * Counts and timing of a run.
 *
 * PURPOSE: Feeds the "run complete" banner and pill, and the `runSettled` event.
 *
 * VALUE: `durationMs` is null when the steps carry no timing, so a host that
 * sends none sees no invented time.
 */
export interface RunSummary {
  state: RunState;
  total: number;
  complete: number;
  skipped: number;
  failed: number;
  running: number;
  /** Steps that have not started, including any status the library does not know. */
  pending: number;
  durationMs: number | null;
}

/**
 * What `runSettled` carries when a run finishes.
 *
 * VALUE: A host can react (notify, archive, start the next run) without reading
 * the node list itself.
 */
export interface RunSettledEvent {
  state: "complete" | "failed";
  summary: RunSummary;
}

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000;

/** Seconds in one minute. */
const SECONDS_PER_MINUTE = 60;

/** Minutes in one hour. */
const MINUTES_PER_HOUR = 60;

/**
 * Durations at or above this many seconds are shown without a decimal.
 *
 * VALUE: `2.3 s` is useful, `48.0 s` is noise.
 */
const WHOLE_SECONDS_FROM = 10;

/**
 * Formats a duration for a badge, a title or a banner.
 *
 * VALUE: Short enough for a node's right edge (`850 ms`, `2.3 s`, `48 s`,
 * `1m 05s`, `1h 02m`). Null, negative and non-finite values give an empty string.
 */
export function formatDurationMs(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return "";
  if (durationMs < MS_PER_SECOND) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / MS_PER_SECOND;
  if (seconds < WHOLE_SECONDS_FROM) return `${seconds.toFixed(1)} s`;
  if (seconds < SECONDS_PER_MINUTE) return `${Math.round(seconds)} s`;
  const totalMinutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const restSeconds = Math.round(seconds - totalMinutes * SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) return `${totalMinutes}m ${String(restSeconds).padStart(2, "0")}s`;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  return `${hours}h ${String(totalMinutes - hours * MINUTES_PER_HOUR).padStart(2, "0")}m`;
}

/** Parses an ISO timestamp to epoch milliseconds, or null when it is absent or invalid. */
function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The timing fields of a step. */
type NodeTiming = Pick<MermaidRuntime.Node, "durationMs" | "startedAt" | "endedAt">;

/**
 * How long a step took.
 *
 * VALUE: Prefers the host's `durationMs`, and falls back to `endedAt - startedAt`,
 * so a host may send either. Null when neither is usable.
 */
export function getNodeDurationMs(node: NodeTiming): number | null {
  if (typeof node.durationMs === "number" && Number.isFinite(node.durationMs) && node.durationMs >= 0) return node.durationMs;
  const started = parseTimestampMs(node.startedAt);
  const ended = parseTimestampMs(node.endedAt);
  if (started === null || ended === null || ended < started) return null;
  return ended - started;
}

/**
 * Wall-clock time from the first start to the last end across a set of steps.
 *
 * PURPOSE: A group or a whole run took as long as its steps overlapped, not as
 * long as their times add up.
 *
 * VALUE: Falls back to the sum of step durations when the steps have no
 * timestamps. Null when no step has any timing.
 */
export function measureSpanMs(nodes: ReadonlyArray<NodeTiming>): number | null {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let summed = 0;
  let hasDuration = false;
  for (const node of nodes) {
    const started = parseTimestampMs(node.startedAt);
    const ended = parseTimestampMs(node.endedAt);
    if (started !== null && ended !== null && ended >= started) {
      earliest = Math.min(earliest, started);
      latest = Math.max(latest, ended);
    }
    const duration = getNodeDurationMs(node);
    if (duration !== null) {
      summed += duration;
      hasDuration = true;
    }
  }
  if (latest >= earliest) return latest - earliest;
  return hasDuration ? summed : null;
}

/** The timing fields of a step, plus the status that says whether the time is final or still counting. */
type LiveNodeTiming = NodeTiming & Pick<MermaidRuntime.Node, "status">;

/**
 * The time to show on a step: its final time, or a counting-up time while it runs.
 *
 * VALUE: A step shows nothing until it starts. A running step with a start time
 * counts up from it, a finished one shows its recorded time, and a step that is
 * waiting or skipped shows nothing even if the host sent a duration.
 */
export function getLiveNodeTimeMs(node: LiveNodeTiming, nowMs: number): number | null {
  if (node.status === "running") {
    const recorded = getNodeDurationMs(node);
    if (recorded !== null) return recorded;
    const started = parseTimestampMs(node.startedAt);
    return started === null ? null : Math.max(0, nowMs - started);
  }
  if (node.status === "complete" || node.status === "failed") return getNodeDurationMs(node);
  return null;
}

/**
 * The time to show on a group of steps.
 *
 * PURPOSE: A group took as long as its steps overlapped, so it uses the first
 * start and the last end rather than adding the step times up.
 *
 * VALUE: While any member still runs it counts up from the first start; once all
 * are done it is the final span. Null when no member has timing.
 */
export function measureGroupTimeMs(nodes: ReadonlyArray<LiveNodeTiming>, nowMs: number): number | null {
  if (!nodes.some((node) => node.status === "running")) return measureSpanMs(nodes.filter((node) => node.status === "complete" || node.status === "failed"));
  let earliest = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const started = parseTimestampMs(node.startedAt);
    if (started !== null) earliest = Math.min(earliest, started);
  }
  return Number.isFinite(earliest) ? Math.max(0, nowMs - earliest) : null;
}

/**
 * Reads a run's state, counts and time from its steps.
 *
 * VALUE: A run is `complete` when nothing is running or waiting and nothing
 * failed (skipped steps count as done), `failed` when something failed and
 * nothing is still running, and `idle` while nothing has started. Any status
 * the library does not know counts as waiting, so a host's `queued` never
 * reads as finished.
 */
export function summariseRun(nodes: ReadonlyArray<MermaidRuntime.Node>): RunSummary {
  const summary: RunSummary = { state: "idle", total: nodes.length, complete: 0, skipped: 0, failed: 0, running: 0, pending: 0, durationMs: null };
  for (const node of nodes) {
    if (node.status === "complete") summary.complete++;
    else if (node.status === "skipped") summary.skipped++;
    else if (node.status === "failed") summary.failed++;
    else if (node.status === "running") summary.running++;
    else summary.pending++;
  }
  const started = summary.complete + summary.skipped + summary.failed + summary.running > 0;
  if (!started) return summary;
  if (summary.running > 0) summary.state = "running";
  else if (summary.failed > 0) summary.state = "failed";
  else summary.state = summary.pending > 0 ? "running" : "complete";
  summary.durationMs = measureSpanMs(nodes);
  return summary;
}
