import { offsetPolygonGeometry, readPolygonCentreInsets, type ShapePoint } from './shape-offset.utils';

/** Mermaid's hexagon: flat top and bottom, a vertex at the middle of each side. */
const HEXAGON: ShapePoint[] = [
  { x: 20, y: 0 },
  { x: 120, y: 0 },
  { x: 140, y: 40 },
  { x: 120, y: 80 },
  { x: 20, y: 80 },
  { x: 0, y: 40 },
];

/** Mermaid's `lean-r` parallelogram: top edge shifted right by the lean. */
const PARALLELOGRAM: ShapePoint[] = [
  { x: 30, y: 0 },
  { x: 150, y: 0 },
  { x: 120, y: 80 },
  { x: 0, y: 80 },
];

/** Largest distance from `point` to any edge of the polygon, which for an exact offset equals the offset on every edge. */
function distanceToPolygon(point: ShapePoint, polygon: readonly ShapePoint[]): number {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}

describe('offsetPolygonGeometry', () => {
  for (const [name, polygon] of [['hexagon', HEXAGON], ['parallelogram', PARALLELOGRAM]] as const) {
    it(`follows a ${name}'s outline instead of boxing it`, () => {
      const geometry = offsetPolygonGeometry(polygon, 4);
      expect(geometry.kind).toBe('polygon');
      if (geometry.kind !== 'polygon') return;
      expect(geometry.points.length).toBe(polygon.length);
      // each moved edge lies exactly 4px outside its original: the midpoint of every ring edge is 4px from the shape
      for (let i = 0; i < geometry.points.length; i++) {
        const a = geometry.points[i];
        const b = geometry.points[(i + 1) % geometry.points.length];
        expect(distanceToPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, polygon)).toBeCloseTo(4, 5);
      }
    });
  }

  it('also handles polygons listed anticlockwise', () => {
    const geometry = offsetPolygonGeometry([...HEXAGON].reverse(), 4);
    expect(geometry.kind).toBe('polygon');
    if (geometry.kind !== 'polygon') return;
    const xs = geometry.points.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(140);
  });

  it('falls back to a box for a shape that is not convex', () => {
    const notched: ShapePoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 50, y: 40 }, { x: 0, y: 80 }];
    expect(offsetPolygonGeometry(notched, 4)).toEqual({ kind: 'rect', x: -4, y: -4, width: 108, height: 88, rx: 0 });
  });
});

describe('readPolygonCentreInsets', () => {
  it('is zero where a hexagon touches its box', () => {
    expect(readPolygonCentreInsets(HEXAGON)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('measures how far a parallelogram sits inside its box at mid-height', () => {
    // at mid-height the left edge is at x=15 and the right edge at x=135 of a 0..150 box
    expect(readPolygonCentreInsets(PARALLELOGRAM)).toEqual({ left: 15, right: 15, top: 0, bottom: 0 });
  });

  it('is zero for a diamond', () => {
    const diamond: ShapePoint[] = [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }];
    expect(readPolygonCentreInsets(diamond)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });
});
