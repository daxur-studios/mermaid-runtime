import type { MermaidRuntime } from '../task-graph-model';

/** Rendered (or estimated) size of one group's cluster box, in scene pixels. */
export interface GroupFootprint {
  readonly width: number;
  readonly height: number;
}

/** Viewport size the arrangement is optimised for. */
export interface ArrangementViewport {
  readonly width: number;
  readonly height: number;
}

/** Overall flow direction of the graph, as the canvas exposes it. */
export type GraphFlowDirection = 'TD' | 'LR';

/**
 * Gap (px) assumed between neighbouring group boxes when predicting the
 * arranged size.
 *
 * VALUE: Approximates Mermaid's default `nodeSpacing`/`rankSpacing` (50px),
 * which is what separates top-level clusters, so predicted aspect ratios match
 * the rendered SVG closely enough to rank candidate arrangements.
 */
export const GROUP_ARRANGEMENT_GAP_PX = 50;

/**
 * Estimated node box size along the cross axis of the flow (width in TD,
 * height in LR) before a group has been measured.
 *
 * VALUE: Lets the first render pick a sensible wrap before any real cluster
 * size is known; the measured size replaces it after that render.
 */
const ESTIMATED_NODE_CROSS_PX = { TD: 200, LR: 60 } as const;

/**
 * Estimated node box size along the flow axis (height in TD, width in LR),
 * including the spacing to the next node in the chain.
 *
 * VALUE: Same purpose as {@link ESTIMATED_NODE_CROSS_PX}.
 */
const ESTIMATED_NODE_ALONG_PX = { TD: 110, LR: 250 } as const;

/**
 * Minimum relative change in viewport aspect ratio before the automatic
 * arrangement is reconsidered.
 *
 * VALUE: Resizing a window a few pixels must not re-layout the whole graph; a
 * 30% aspect change (e.g. opening a side panel, rotating, going fullscreen) can.
 */
export const ARRANGEMENT_ASPECT_HYSTERESIS = 0.3;

/**
 * Ids of groups with no edges to nodes outside themselves.
 *
 * PURPOSE: Only these groups are free to be arranged — Mermaid honours their
 * `direction` and lays them out as independent units.
 *
 * VALUE: Groups that are wired into the rest of the graph are left exactly as
 * before, so hosts with connected groups see no layout change.
 */
export function findIndependentGroupIds(
  groups: readonly MermaidRuntime.NodeGroup[],
  edges: readonly { from: string; to: string }[],
): Set<string> {
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (!groupOf.has(nodeId)) groupOf.set(nodeId, group.id);
    }
  }
  const independent = new Set(groups.map((group) => group.id));
  for (const edge of edges) {
    const fromGroup = groupOf.get(edge.from);
    const toGroup = groupOf.get(edge.to);
    if (fromGroup === toGroup) continue;
    if (fromGroup) independent.delete(fromGroup);
    if (toGroup) independent.delete(toGroup);
  }
  return independent;
}

/**
 * Inner direction that compacts a group wired into a chain of groups.
 *
 * PURPOSE: A chain of connected groups has no free placement (each group sits
 * after the previous one along the flow), so the only way to shorten it is to
 * run the steps *inside* each group across the flow.
 *
 * `level` is the group's position in its chain (see
 * {@link computeGroupChainLevels}); with `groupFlow` `'alternate'`, odd levels
 * run the opposite way to even ones, which makes the chain a snake.
 *
 * VALUE: A top-to-bottom flow becomes a stack of short rows, and a
 * left-to-right flow a row of short columns, instead of one long strip.
 */
export function connectedGroupDirection(flow: GraphFlowDirection, level = 0, groupFlow: MermaidRuntime.GroupFlow = 'same'): 'LR' | 'RL' | 'TB' | 'BT' {
  const reversed = groupFlow === 'alternate' && level % 2 === 1;
  if (flow === 'TD') return reversed ? 'RL' : 'LR';
  return reversed ? 'BT' : 'TB';
}

/**
 * Position of each group along its chain: 0 for a group nothing feeds, one more
 * than the furthest group that feeds it otherwise.
 *
 * PURPOSE: Lets {@link connectedGroupDirection} alternate by chain position,
 * so each group runs the opposite way to the one before it, whichever order the
 * host listed the groups in. Parallel groups at the same position run the same way.
 *
 * VALUE: Safe on cyclic graphs (positions stop growing after one pass per
 * group), so a loop in the flow never hangs the renderer.
 */
export function computeGroupChainLevels(
  groups: readonly MermaidRuntime.NodeGroup[],
  edges: readonly { from: string; to: string }[],
): Map<string, number> {
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      if (!groupOf.has(nodeId)) groupOf.set(nodeId, group.id);
    }
  }
  const links = new Set<string>();
  for (const edge of edges) {
    const from = groupOf.get(edge.from);
    const to = groupOf.get(edge.to);
    if (from && to && from !== to) links.add(`${from}\u0000${to}`);
  }

  const levels = new Map<string, number>(groups.map((group) => [group.id, 0]));
  for (let pass = 0; pass < groups.length; pass++) {
    let changed = false;
    for (const link of links) {
      const [from, to] = link.split('\u0000');
      const next = (levels.get(from) ?? 0) + 1;
      if (next > (levels.get(to) ?? 0) && next < groups.length) {
        levels.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return levels;
}

/** Rough footprint for a not-yet-measured group of `memberCount` chained nodes. */
export function estimateGroupFootprint(memberCount: number, flow: GraphFlowDirection): GroupFootprint {
  const along = Math.max(1, memberCount) * ESTIMATED_NODE_ALONG_PX[flow];
  const cross = ESTIMATED_NODE_CROSS_PX[flow];
  return flow === 'TD' ? { width: cross, height: along } : { width: along, height: cross };
}

/**
 * Predicts the overall size when groups are laid out `perLine` to a line.
 *
 * In TD, a line runs left→right and lines stack downward; in LR, a line runs
 * top→bottom and lines stack rightward — i.e. groups always line up across the
 * flow, perpendicular to the direction their own nodes run.
 */
export function predictArrangedSize(
  footprints: readonly GroupFootprint[],
  perLine: number,
  flow: GraphFlowDirection,
  gap = GROUP_ARRANGEMENT_GAP_PX,
): GroupFootprint {
  let across = 0;
  let along = 0;
  for (let start = 0; start < footprints.length; start += perLine) {
    const line = footprints.slice(start, start + perLine);
    const lineAcross = line.reduce((sum, f) => sum + (flow === 'TD' ? f.width : f.height), 0) + gap * (line.length - 1);
    const lineAlong = Math.max(...line.map((f) => (flow === 'TD' ? f.height : f.width)));
    across = Math.max(across, lineAcross);
    along += lineAlong + (start > 0 ? gap : 0);
  }
  return flow === 'TD' ? { width: across, height: along } : { width: along, height: across };
}

/**
 * Picks how many groups to place per line so the whole arrangement fits the
 * viewport at the largest zoom.
 *
 * PURPOSE: "Most nodes readable on screen" is the fit-to-viewport scale,
 * `min(viewportW / graphW, viewportH / graphH)`; the best arrangement is the
 * one whose shape matches the viewport's.
 *
 * VALUE: Hosts get a screen-filling grid without choosing a column count; ties
 * prefer fewer lines (closer to the unwrapped reading order), and lines are
 * balanced so the last one isn't left nearly empty.
 */
export function chooseGroupsPerLine(
  footprints: readonly GroupFootprint[],
  flow: GraphFlowDirection,
  viewport: ArrangementViewport,
): number {
  const count = footprints.length;
  if (count <= 1) return Math.max(1, count);
  if (viewport.width <= 0 || viewport.height <= 0) return Math.ceil(Math.sqrt(count));

  let best = count;
  let bestScale = -1;
  for (let perLine = count; perLine >= 1; perLine--) {
    const size = predictArrangedSize(footprints, perLine, flow);
    const scale = Math.min(viewport.width / size.width, viewport.height / size.height);
    if (scale > bestScale + Number.EPSILON) {
      best = perLine;
      bestScale = scale;
    }
  }
  // Same number of lines, but balanced: 10 groups in 2 lines → 5 + 5, not 6 + 4.
  // Fewer groups per line never widens a line, so the fit scale can only improve.
  const lineCount = Math.ceil(count / best);
  return Math.ceil(count / lineCount);
}

/**
 * Invisible Mermaid links that wrap groups into lines of `perLine`.
 *
 * VALUE: Linking group *i* to group *i + perLine* pushes the latter one rank
 * further along the flow, which is exactly "start a new line" — Mermaid lays
 * out the grid itself, no manual positioning needed.
 */
export function buildGroupWrapLinks(groupAliases: readonly string[], perLine: number): string[] {
  if (perLine < 1 || perLine >= groupAliases.length) return [];
  const links: string[] = [];
  for (let index = 0; index + perLine < groupAliases.length; index++) {
    links.push(`  ${groupAliases[index]} ~~~ ${groupAliases[index + perLine]}`);
  }
  return links;
}

/**
 * Whether the viewport changed shape enough to reconsider the arrangement.
 *
 * VALUE: Implements {@link ARRANGEMENT_ASPECT_HYSTERESIS} so live resizes don't
 * thrash Mermaid re-layouts.
 */
export function viewportAspectChanged(previous: ArrangementViewport | null, next: ArrangementViewport): boolean {
  if (next.width <= 0 || next.height <= 0) return false;
  if (!previous || previous.width <= 0 || previous.height <= 0) return true;
  const previousAspect = previous.width / previous.height;
  const nextAspect = next.width / next.height;
  return Math.abs(nextAspect / previousAspect - 1) > ARRANGEMENT_ASPECT_HYSTERESIS;
}
