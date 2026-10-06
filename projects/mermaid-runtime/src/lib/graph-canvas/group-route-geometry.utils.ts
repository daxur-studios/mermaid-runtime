import type { GraphFlowDirection } from './group-arrangement.utils';

/** A point in scene pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned box in scene pixels. */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A group's border box and the box around its member steps. */
export interface RouteGroup {
  readonly box: Box;
  readonly contentBox: Box;
}

/** One end of an arrow: the step, and the group it sits in (if any). */
export interface RouteEndpoint {
  readonly node: Box;
  readonly group: RouteGroup | null;
}

/**
 * How far from a group's centre a step may sit and still count as "in the
 * middle" of it, as a share of the group's width (height in a left-to-right flow).
 *
 * VALUE: A single column of steps, or the middle step of a row, leaves and
 * enters by its flow-facing side; only steps clearly to one side use that
 * side's lane.
 */
const CENTRE_TOLERANCE_RATIO = 0.15;

/**
 * Corner radius (px) of a routed arrow.
 *
 * VALUE: Small enough to read as an elbow, large enough to match the soft
 * corners Mermaid's own arrows have.
 */
export const ROUTE_CORNER_RADIUS_PX = 8;

/** Distance (px) under which two route points count as the same point. */
const ROUTE_POINT_EPSILON_PX = 0.01;

type Side = 'left' | 'right' | 'centre';

/**
 * Elbow route for an arrow that crosses between two groups, from the real step
 * it leaves to the real step it enters.
 *
 * PURPOSE: Mermaid draws such an arrow from group border to group border (and
 * sometimes loops at the border), not between the steps.
 *
 * Steps to one side of their group leave and enter by that side, through a lane
 * in the group's margin, so stacked parallel steps are never crossed. Arrows
 * between the same two groups share that lane, so fan-out and fan-in read as one
 * line that branches. Steps in the middle leave by their flow-facing side.
 *
 * VALUE: One router serves both group flows (alternating or same direction),
 * both graph directions, and fan-out/fan-in.
 *
 * Returns `null` when the groups are not one after the other along the flow
 * (the arrow is then left as Mermaid drew it).
 */
export function routeGroupCrossing(flow: GraphFlowDirection, source: RouteEndpoint, target: RouteEndpoint): Point[] | null {
  if (flow === 'TD') return routeTopDown(source, target);
  const route = routeTopDown(transposeEndpoint(source), transposeEndpoint(target));
  return route ? route.map(transposePoint) : null;
}

/** Midpoint of the longest segment of a route: a good spot for an arrow's label. */
export function pickRouteLabelPoint(points: readonly Point[]): Point {
  let best = points[0];
  let bestLength = -1;
  for (let index = 1; index < points.length; index++) {
    const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    if (length > bestLength) {
      bestLength = length;
      best = { x: (points[index].x + points[index - 1].x) / 2, y: (points[index].y + points[index - 1].y) / 2 };
    }
  }
  return best;
}

/** SVG path data for a polyline with rounded corners. */
export function buildRoundedRoutePath(points: readonly Point[], radius = ROUTE_CORNER_RADIUS_PX): string {
  if (points.length === 0) return '';
  const format = (point: Point) => `${round(point.x)},${round(point.y)}`;
  let path = `M${format(points[0])}`;
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1];
    const corner = points[index];
    const after = points[index + 1];
    const r = Math.min(radius, distance(before, corner) / 2, distance(corner, after) / 2);
    path += ` L${format(moveTowards(corner, before, r))} Q${format(corner)} ${format(moveTowards(corner, after, r))}`;
  }
  return `${path} L${format(points[points.length - 1])}`;
}

function routeTopDown(source: RouteEndpoint, target: RouteEndpoint): Point[] | null {
  const sourceFrame = source.group?.box ?? source.node;
  const targetFrame = target.group?.box ?? target.node;
  let forward: boolean;
  if (targetFrame.top >= sourceFrame.bottom) forward = true;
  else if (targetFrame.bottom <= sourceFrame.top) forward = false;
  else return null;

  const gapY = forward ? (sourceFrame.bottom + targetFrame.top) / 2 : (sourceFrame.top + targetFrame.bottom) / 2;
  const sourceFaceY = forward ? source.node.bottom : source.node.top;
  const targetFaceY = forward ? target.node.top : target.node.bottom;
  const sourceSide = readSide(source);
  const targetSide = readSide(target);
  const sourceY = centreY(source.node);
  const targetY = centreY(target.node);

  const sharedLane = sourceSide !== 'centre' && sourceSide === targetSide && source.group && target.group ? readSharedLaneX(source.group, target.group, sourceSide) : null;
  if (sharedLane !== null && sourceSide !== 'centre') {
    return simplify([
      { x: edgeX(source.node, sourceSide), y: sourceY },
      { x: sharedLane, y: sourceY },
      { x: sharedLane, y: targetY },
      { x: edgeX(target.node, sourceSide), y: targetY },
    ]);
  }

  const points: Point[] = [];
  let x: number;
  if (sourceSide === 'centre' || !source.group) {
    x = centreX(source.node);
    points.push({ x, y: sourceFaceY });
  } else {
    x = readLaneX(source.group, sourceSide);
    points.push({ x: edgeX(source.node, sourceSide), y: sourceY }, { x, y: sourceY });
  }
  points.push({ x, y: gapY });
  if (targetSide === 'centre' || !target.group) {
    const targetX = centreX(target.node);
    points.push({ x: targetX, y: gapY }, { x: targetX, y: targetFaceY });
  } else {
    const lane = readLaneX(target.group, targetSide);
    points.push({ x: lane, y: gapY }, { x: lane, y: targetY }, { x: edgeX(target.node, targetSide), y: targetY });
  }
  return simplify(points);
}

/** Which side of its group a step sits on, or `centre` when it is in the middle or ungrouped. */
function readSide(endpoint: RouteEndpoint): Side {
  const group = endpoint.group;
  if (!group) return 'centre';
  const tolerance = (group.box.right - group.box.left) * CENTRE_TOLERANCE_RATIO;
  const offset = centreX(endpoint.node) - centreX(group.box);
  if (offset > tolerance) return 'right';
  if (offset < -tolerance) return 'left';
  return 'centre';
}

/** X of the lane halfway between a group's outermost steps and its border, on `side`. */
function readLaneX(group: RouteGroup, side: 'left' | 'right'): number {
  return side === 'right' ? (group.contentBox.right + group.box.right) / 2 : (group.box.left + group.contentBox.left) / 2;
}

/** X of a lane that clears the steps of both groups and stays inside both borders, or `null` if there is none. */
function readSharedLaneX(a: RouteGroup, b: RouteGroup, side: 'left' | 'right'): number | null {
  const clear = side === 'right' ? Math.max(a.contentBox.right, b.contentBox.right) : Math.min(a.contentBox.left, b.contentBox.left);
  const border = side === 'right' ? Math.min(a.box.right, b.box.right) : Math.max(a.box.left, b.box.left);
  const low = Math.min(clear, border);
  const high = Math.max(clear, border);
  return high - low > ROUTE_POINT_EPSILON_PX ? (low + high) / 2 : null;
}

function edgeX(node: Box, side: 'left' | 'right'): number {
  return side === 'right' ? node.right : node.left;
}

/** Drops repeated points and middle points of straight runs. */
function simplify(points: Point[]): Point[] {
  const distinct = points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > ROUTE_POINT_EPSILON_PX);
  return distinct.filter((point, index) => {
    if (index === 0 || index === distinct.length - 1) return true;
    const before = distinct[index - 1];
    const after = distinct[index + 1];
    const straightX = Math.abs(before.x - point.x) < ROUTE_POINT_EPSILON_PX && Math.abs(point.x - after.x) < ROUTE_POINT_EPSILON_PX;
    const straightY = Math.abs(before.y - point.y) < ROUTE_POINT_EPSILON_PX && Math.abs(point.y - after.y) < ROUTE_POINT_EPSILON_PX;
    return !straightX && !straightY;
  });
}

function transposePoint(point: Point): Point {
  return { x: point.y, y: point.x };
}

function transposeBox(box: Box): Box {
  return { left: box.top, top: box.left, right: box.bottom, bottom: box.right };
}

function transposeEndpoint(endpoint: RouteEndpoint): RouteEndpoint {
  return {
    node: transposeBox(endpoint.node),
    group: endpoint.group ? { box: transposeBox(endpoint.group.box), contentBox: transposeBox(endpoint.group.contentBox) } : null,
  };
}

function centreX(box: Box): number {
  return (box.left + box.right) / 2;
}

function centreY(box: Box): number {
  return (box.top + box.bottom) / 2;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function moveTowards(from: Point, to: Point, amount: number): Point {
  const total = distance(from, to);
  if (total === 0) return from;
  return { x: from.x + ((to.x - from.x) * amount) / total, y: from.y + ((to.y - from.y) * amount) / total };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
