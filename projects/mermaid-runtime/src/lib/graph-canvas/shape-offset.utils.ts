/** A point in a node shape's local (pre-`transform`) coordinate space. */
export interface ShapePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A node shape's outline, offset outward by a fixed distance, in the same
 * local coordinate space as the source `<rect>`/`<polygon>` it was read from.
 *
 * VALUE: `kind` tells the caller which SVG element to draw (`<rect>` or
 * `<polygon>`) — callers never need to know which Mermaid shape produced it.
 */
export type OffsetShapeGeometry =
  | { readonly kind: "rect"; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx: number }
  | { readonly kind: "polygon"; readonly points: readonly ShapePoint[] };

/**
 * Offsets an axis-aligned rect outward by `offsetPx` on every side.
 *
 * VALUE: Covers Mermaid's plain `rect` shape, and (via {@link offsetPolygonGeometry}'s
 * bounding-box fallback) the outer envelope of shapes like `subroutine` whose
 * decorative bars sit outside the shape's own label box.
 */
export function offsetRectGeometry(x: number, y: number, width: number, height: number, rx: number, offsetPx: number): OffsetShapeGeometry {
  return {
    kind: "rect",
    x: x - offsetPx,
    y: y - offsetPx,
    width: width + 2 * offsetPx,
    height: height + 2 * offsetPx,
    rx: rx > 0 ? rx + offsetPx : 0,
  };
}

/**
 * Offsets a Mermaid node polygon outward by `offsetPx`, producing a similar
 * (same-shape) polygon when the source is an axis-aligned rhombus (Mermaid's
 * `diamond` shape), or a bounding-box rect otherwise.
 *
 * PURPOSE: Mermaid's `diamond` shape is always an axis-aligned rhombus (one
 * vertex pair directly left/right of centre, the other directly above/below),
 * never an arbitrary polygon — so a closed-form offset is exact, not an
 * approximation. Any other polygon this library draws today (`subroutine`'s
 * shape, which traces its label box plus two external decorative bars) isn't
 * a simple convex boundary, so a general per-vertex offset would be wrong;
 * its *outer envelope* is what a "bigger outline of the same shape" should
 * trace, and a bounding box is exactly that envelope.
 *
 * VALUE: Growing a rhombus by a uniform outward distance `d` scales its two
 * half-diagonals `a` (horizontal) and `b` (vertical) to `a + d*L/b` and
 * `b + d*L/a` (`L = hypot(a, b)`) — derived from offsetting each edge's line
 * equation `bx + ay = ab` outward by `d` along its normal. Verified against
 * real rendered node coordinates.
 */
export function offsetPolygonGeometry(points: readonly ShapePoint[], offsetPx: number): OffsetShapeGeometry {
  const rhombus = tryReadAxisAlignedRhombus(points);
  if (rhombus) {
    const { center, a, b } = rhombus;
    const hypotenuse = Math.hypot(a, b);
    const newA = a + (offsetPx * hypotenuse) / b;
    const newB = b + (offsetPx * hypotenuse) / a;
    const offsetPoints = points.map((point) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      return Math.abs(dy) < Math.abs(dx) ? { x: center.x + Math.sign(dx) * newA, y: center.y } : { x: center.x, y: center.y + Math.sign(dy) * newB };
    });
    return { kind: "polygon", points: offsetPoints };
  }

  const convex = tryOffsetConvexPolygon(points, offsetPx);
  if (convex) return { kind: "polygon", points: convex };

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return offsetRectGeometry(minX, minY, maxX - minX, maxY - minY, 0, offsetPx);
}

/** Distance (px) under which two polygon vertices count as the same vertex. */
const POLYGON_VERTEX_EPSILON_PX = 0.01;

/** Cross product (px²) under which two edges count as parallel. */
const PARALLEL_EDGE_EPSILON = 1e-6;

/**
 * Offsets a convex polygon outward by `offsetPx`, moving every edge along its
 * outward normal and joining the moved edges at their intersections.
 *
 * PURPOSE: Hexagon and parallelogram nodes should get a ring that follows their
 * outline, not a rectangle around their bounding box.
 *
 * VALUE: Exact for any convex polygon (the rhombus formula above is the
 * four-point case). Returns `null` for a polygon that is not convex, has fewer
 * than three distinct vertices, or has parallel neighbouring edges after
 * dropping straight-through vertices, so the caller can fall back to a box.
 */
function tryOffsetConvexPolygon(points: readonly ShapePoint[], offsetPx: number): ShapePoint[] | null {
  const distinct = points.filter((point, i) => i === 0 || Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y) > POLYGON_VERTEX_EPSILON_PX);
  if (distinct.length > 1 && Math.hypot(distinct[0].x - distinct[distinct.length - 1].x, distinct[0].y - distinct[distinct.length - 1].y) <= POLYGON_VERTEX_EPSILON_PX) distinct.pop();
  const count = distinct.length;
  if (count < 3) return null;

  let signedArea = 0;
  for (let i = 0; i < count; i++) {
    const a = distinct[i];
    const b = distinct[(i + 1) % count];
    signedArea += a.x * b.y - b.x * a.y;
  }
  if (signedArea === 0) return null;
  const orientation = Math.sign(signedArea);

  for (let i = 0; i < count; i++) {
    const a = distinct[i];
    const b = distinct[(i + 1) % count];
    const c = distinct[(i + 2) % count];
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(turn) <= PARALLEL_EDGE_EPSILON) return null;
    if (Math.sign(turn) !== orientation) return null;
  }

  // Each edge's line, moved outward: point `origin` plus direction `dir`.
  const lines = distinct.map((a, i) => {
    const b = distinct[(i + 1) % count];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const outward = { x: dir.y * orientation, y: -dir.x * orientation };
    return { origin: { x: a.x + outward.x * offsetPx, y: a.y + outward.y * offsetPx }, dir };
  });
  const result: ShapePoint[] = [];
  for (let i = 0; i < count; i++) {
    const previous = lines[(i + count - 1) % count];
    const next = lines[i];
    const denominator = previous.dir.x * next.dir.y - previous.dir.y * next.dir.x;
    const along = ((next.origin.x - previous.origin.x) * next.dir.y - (next.origin.y - previous.origin.y) * next.dir.x) / denominator;
    result.push({ x: previous.origin.x + previous.dir.x * along, y: previous.origin.y + previous.dir.y * along });
  }
  return result;
}

/**
 * How far a node's real outline sits inside its bounding box where an arrow
 * meets it: on each side, along the line through the outline's centre.
 *
 * PURPOSE: A slanted side (parallelogram) leaves its bounding box edge empty
 * at mid-height, so an arrow ending on the box stops short of the shape.
 *
 * VALUE: Insets are 0 for rectangles, diamonds and hexagons, whose outline
 * touches the box at the centre of each side, so only slanted shapes change.
 */
export interface CentreInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Insets of `points` (a closed polygon) from its own bounding box, measured through the bounding box's centre. */
export function readPolygonCentreInsets(points: readonly ShapePoint[]): CentreInsets | null {
  if (points.length < 3) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  const hitsAtY: number[] = [];
  const hitsAtX: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a.y !== b.y && Math.min(a.y, b.y) <= centreY && centreY <= Math.max(a.y, b.y)) hitsAtY.push(a.x + ((centreY - a.y) / (b.y - a.y)) * (b.x - a.x));
    if (a.x !== b.x && Math.min(a.x, b.x) <= centreX && centreX <= Math.max(a.x, b.x)) hitsAtX.push(a.y + ((centreX - a.x) / (b.x - a.x)) * (b.y - a.y));
  }
  if (hitsAtY.length === 0 || hitsAtX.length === 0) return null;
  return {
    left: Math.min(...hitsAtY) - minX,
    right: maxX - Math.max(...hitsAtY),
    top: Math.min(...hitsAtX) - minY,
    bottom: maxY - Math.max(...hitsAtX),
  };
}

/** Tolerance (px) for treating a vertex as lying exactly on a rhombus's horizontal or vertical axis through its centre. */
const RHOMBUS_AXIS_TOLERANCE_PX = 0.5;

function tryReadAxisAlignedRhombus(points: readonly ShapePoint[]): { center: ShapePoint; a: number; b: number } | null {
  if (points.length !== 4) return null;

  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / 4,
    y: points.reduce((sum, point) => sum + point.y, 0) / 4,
  };

  let a = 0;
  let b = 0;
  let horizontalCount = 0;
  let verticalCount = 0;
  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    if (Math.abs(dy) <= RHOMBUS_AXIS_TOLERANCE_PX) {
      a = Math.abs(dx);
      horizontalCount++;
    } else if (Math.abs(dx) <= RHOMBUS_AXIS_TOLERANCE_PX) {
      b = Math.abs(dy);
      verticalCount++;
    } else {
      return null;
    }
  }
  if (horizontalCount !== 2 || verticalCount !== 2 || a === 0 || b === 0) return null;
  return { center, a, b };
}

/**
 * Builds an SVG path `d` string tracing `geometry`'s full perimeter starting
 * at its topmost point (smallest local-space `y`, the Mermaid/SVG convention
 * this library's node shapes already use) and closing back to that same point.
 *
 * PURPOSE: A progress trace needs a fixed, known start point so
 * `stroke-dasharray`/`stroke-dashoffset` reveal it growing from "the top"
 * round to where it began — a plain `<rect>`/`<polygon>` element gives no
 * control over where its implicit path starts.
 */
export function buildTopStartOutlinePath(geometry: OffsetShapeGeometry): string {
  if (geometry.kind === "rect") {
    const { x, y, width, height, rx } = geometry;
    const topMidX = x + width / 2;
    if (rx > 0) {
      return [
        `M ${topMidX} ${y}`,
        `L ${x + width - rx} ${y}`,
        `A ${rx} ${rx} 0 0 1 ${x + width} ${y + rx}`,
        `L ${x + width} ${y + height - rx}`,
        `A ${rx} ${rx} 0 0 1 ${x + width - rx} ${y + height}`,
        `L ${x + rx} ${y + height}`,
        `A ${rx} ${rx} 0 0 1 ${x} ${y + height - rx}`,
        `L ${x} ${y + rx}`,
        `A ${rx} ${rx} 0 0 1 ${x + rx} ${y}`,
        "Z",
      ].join(" ");
    }
    return [`M ${topMidX} ${y}`, `L ${x + width} ${y}`, `L ${x + width} ${y + height}`, `L ${x} ${y + height}`, `L ${x} ${y}`, "Z"].join(" ");
  }

  const topIndex = geometry.points.reduce((topI, point, i) => (point.y < geometry.points[topI].y ? i : topI), 0);
  const ordered = [...geometry.points.slice(topIndex), ...geometry.points.slice(0, topIndex)];
  const [first, ...rest] = ordered;
  return [`M ${first.x} ${first.y}`, ...rest.map((point) => `L ${point.x} ${point.y}`), "Z"].join(" ");
}

/**
 * Computes `geometry`'s exact perimeter length, matching
 * {@link buildTopStartOutlinePath}'s path precisely (straight edges, plus a
 * full circle's circumference — `2π·rx` — for a rounded rect's four corner
 * arcs, since each quarter-arc's length sums to that regardless of start
 * angle).
 *
 * PURPOSE: The progress trace needs its total length every time progress
 * changes, to size `stroke-dasharray`. Reading it off the live element via
 * `SVGPathElement.getTotalLength()` forces a synchronous layout on every
 * call — on a graph with many progressing nodes updating frequently, that
 * becomes layout thrashing severe enough to freeze the tab. Since the exact
 * geometry is already known analytically, computing the length in plain JS
 * needs no DOM read-back at all.
 */
export function computeOutlinePerimeterLength(geometry: OffsetShapeGeometry): number {
  if (geometry.kind === "rect") {
    const { width, height, rx } = geometry;
    if (rx > 0) {
      return 2 * (width - 2 * rx) + 2 * (height - 2 * rx) + 2 * Math.PI * rx;
    }
    return 2 * (width + height);
  }

  const points = geometry.points;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
