import { buildRoundedRoutePath, pickRouteLabelPoint, routeGroupCrossing, type Box, type RouteEndpoint, type RouteGroup } from './group-route-geometry.utils';

/** A box from its top-left corner and size. */
function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height };
}

/** Two phases stacked top to bottom, three steps across each (like the lab in TD). */
const PHASE_ONE: RouteGroup = { box: box(0, 0, 800, 140), contentBox: box(40, 40, 720, 60) };
const PHASE_TWO: RouteGroup = { box: box(0, 190, 800, 140), contentBox: box(40, 230, 720, 60) };

const firstOfPhaseOne = endpoint(box(40, 40, 120, 60), PHASE_ONE);
const lastOfPhaseOne = endpoint(box(640, 40, 120, 60), PHASE_ONE);
const firstOfPhaseTwoLeft = endpoint(box(40, 230, 120, 60), PHASE_TWO);
const firstOfPhaseTwoRight = endpoint(box(640, 230, 120, 60), PHASE_TWO);

function endpoint(node: Box, group: RouteGroup | null): RouteEndpoint {
  return { node, group };
}

/** The same endpoint with x and y swapped, for left-to-right checks. */
function transposeFor(source: RouteEndpoint): RouteEndpoint {
  const swap = (b: Box): Box => ({ left: b.top, top: b.left, right: b.bottom, bottom: b.right });
  return { node: swap(source.node), group: source.group ? { box: swap(source.group.box), contentBox: swap(source.group.contentBox) } : null };
}

describe('routeGroupCrossing', () => {
  it('hands off straight down one lane when both steps are on the same side (snake)', () => {
    const route = routeGroupCrossing('TD', lastOfPhaseOne, firstOfPhaseTwoRight)!;
    // right edge of the step, out to the lane, down, back in to the right edge of the next step
    expect(route[0]).toEqual({ x: 760, y: 70 });
    expect(route[route.length - 1]).toEqual({ x: 760, y: 260 });
    expect(route.length).toBe(4);
    expect(route[1].x).toBe(route[2].x);
    expect(route[1].x).toBeGreaterThan(760);
    expect(route[1].x).toBeLessThan(800);
  });

  it('drops into the gap and across to the other side when the steps are on opposite sides', () => {
    const route = routeGroupCrossing('TD', lastOfPhaseOne, firstOfPhaseTwoLeft)!;
    expect(route[0]).toEqual({ x: 760, y: 70 });
    expect(route[route.length - 1]).toEqual({ x: 40, y: 260 });
    const gapY = (140 + 190) / 2;
    expect(route.some((point) => point.y === gapY)).toBeTrue();
    // every segment is horizontal or vertical
    for (let index = 1; index < route.length; index++) {
      expect(route[index].x === route[index - 1].x || route[index].y === route[index - 1].y).toBeTrue();
    }
  });

  it('never runs a shared lane through a step when the groups are different widths', () => {
    // Narrow phase above a wide one: the margins on the right do not overlap.
    const narrow: RouteGroup = { box: box(0, 0, 400, 140), contentBox: box(40, 40, 320, 60) };
    const wide: RouteGroup = { box: box(0, 190, 800, 140), contentBox: box(40, 230, 720, 60) };
    const from = endpoint(box(240, 40, 120, 60), narrow);
    const to = endpoint(box(640, 230, 120, 60), wide);
    const route = routeGroupCrossing('TD', from, to)!;
    expect(route[0]).toEqual({ x: 360, y: 70 });
    expect(route[route.length - 1]).toEqual({ x: 760, y: 260 });
    // the last run goes into the step from outside it, so the arrow points inward
    expect(route[route.length - 2].x).toBeGreaterThan(760);
    expect(route[route.length - 2].y).toBe(260);
    // and the same turned on its side
    const turned = routeGroupCrossing('LR', transposeFor(from), transposeFor(to))!;
    expect(turned[turned.length - 2].y).toBeGreaterThan(760);
  });

  it('does not squeeze the lane into a sliver of shared margin', () => {
    // Left edges only 2px apart past the narrower border: a shared lane would hug the step.
    const upper: RouteGroup = { box: box(65, 0, 735, 140), contentBox: box(98, 40, 640, 60) };
    const lower: RouteGroup = { box: box(33, 190, 800, 140), contentBox: box(67, 230, 720, 60) };
    const from = endpoint(box(98, 40, 120, 60), upper);
    const to = endpoint(box(67, 230, 120, 60), lower);
    const route = routeGroupCrossing('TD', from, to)!;
    expect(route[0]).toEqual({ x: 98, y: 70 });
    expect(route[route.length - 1]).toEqual({ x: 67, y: 260 });
    // the last run is long enough to read as an elbow, not a notch
    expect(67 - route[route.length - 2].x).toBeGreaterThanOrEqual(12);
    const turned = routeGroupCrossing('LR', transposeFor(from), transposeFor(to))!;
    expect(67 - turned[turned.length - 2].y).toBeGreaterThanOrEqual(12);
  });

  it('shares one lane between arrows from the same group (fan-out)', () => {
    const second = endpoint(box(640, 300 - 30, 120, 30), PHASE_TWO);
    const a = routeGroupCrossing('TD', lastOfPhaseOne, firstOfPhaseTwoRight)!;
    const b = routeGroupCrossing('TD', lastOfPhaseOne, second)!;
    expect(a[1].x).toBe(b[1].x);
  });

  it('shares one lane between arrows into the same group (fan-in)', () => {
    const otherSource = endpoint(box(640, 100, 120, 30), PHASE_ONE);
    const a = routeGroupCrossing('TD', lastOfPhaseOne, firstOfPhaseTwoRight)!;
    const b = routeGroupCrossing('TD', otherSource, firstOfPhaseTwoRight)!;
    expect(a[1].x).toBe(b[1].x);
  });

  it('leaves and enters by the flow-facing side for steps in the middle', () => {
    const middleOne = endpoint(box(340, 40, 120, 60), PHASE_ONE);
    const middleTwo = endpoint(box(340, 230, 120, 60), PHASE_TWO);
    expect(routeGroupCrossing('TD', middleOne, middleTwo)).toEqual([
      { x: 400, y: 100 },
      { x: 400, y: 230 },
    ]);
  });

  it('routes ungrouped steps by their own flow-facing side', () => {
    const above = endpoint(box(100, -100, 80, 40), null);
    const route = routeGroupCrossing('TD', above, firstOfPhaseOne)!;
    expect(route[0]).toEqual({ x: 140, y: -60 });
    expect(route[route.length - 1].y).toBe(70);
  });

  it('is the same route turned on its side for left-to-right flows', () => {
    const transpose = (b: Box): Box => ({ left: b.top, top: b.left, right: b.bottom, bottom: b.right });
    const group = (g: RouteGroup): RouteGroup => ({ box: transpose(g.box), contentBox: transpose(g.contentBox) });
    const topDown = routeGroupCrossing('TD', lastOfPhaseOne, firstOfPhaseTwoLeft)!;
    const leftToRight = routeGroupCrossing('LR', endpoint(transpose(lastOfPhaseOne.node), group(PHASE_ONE)), endpoint(transpose(firstOfPhaseTwoLeft.node), group(PHASE_TWO)))!;
    expect(leftToRight).toEqual(topDown.map((point) => ({ x: point.y, y: point.x })));
  });

  it('routes backwards when the target group is before the source group', () => {
    const route = routeGroupCrossing('TD', firstOfPhaseTwoLeft, lastOfPhaseOne)!;
    expect(route[0]).toEqual({ x: 40, y: 260 });
    expect(route[route.length - 1]).toEqual({ x: 760, y: 70 });
  });

  it('leaves the arrow to Mermaid when the groups overlap along the flow', () => {
    const beside: RouteGroup = { box: box(900, 20, 400, 140), contentBox: box(940, 60, 320, 60) };
    expect(routeGroupCrossing('TD', lastOfPhaseOne, endpoint(box(940, 60, 120, 60), beside))).toBeNull();
  });
});

describe('buildRoundedRoutePath', () => {
  it('draws a straight route as one line', () => {
    expect(buildRoundedRoutePath([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toBe('M0,0 L0,100');
  });

  it('rounds each corner with a curve that stops short of the corner', () => {
    const path = buildRoundedRoutePath([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }], 10);
    expect(path).toBe('M0,0 L0,90 Q0,100 10,100 L100,100');
  });

  it('shrinks the radius on short segments', () => {
    const path = buildRoundedRoutePath([{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 100, y: 6 }], 10);
    expect(path).toBe('M0,0 L0,3 Q0,6 3,6 L100,6');
  });
});

describe('pickRouteLabelPoint', () => {
  it('uses the middle of the longest segment', () => {
    expect(pickRouteLabelPoint([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 }])).toEqual({ x: 50, y: 10 });
  });
});

describe('routeGroupCrossing with slanted steps', () => {
  const lean = { left: 15, right: 15, top: 0, bottom: 0 };

  it('ends on the slanted side, not on the bounding box', () => {
    const slantedLast = endpoint({ ...box(640, 40, 120, 60), inset: lean }, PHASE_ONE);
    const slantedTarget = endpoint({ ...box(640, 230, 120, 60), inset: lean }, PHASE_TWO);
    const route = routeGroupCrossing('TD', slantedLast, slantedTarget)!;
    expect(route[0]).toEqual({ x: 745, y: 70 });
    expect(route[route.length - 1]).toEqual({ x: 745, y: 260 });
  });

  it('applies a top or bottom inset on the face an arrow leaves by', () => {
    const source = endpoint({ ...box(340, 40, 120, 60), inset: { left: 0, right: 0, top: 0, bottom: 10 } }, null);
    const target = endpoint(box(340, 230, 120, 60), null);
    const route = routeGroupCrossing('TD', source, target)!;
    expect(route[0]).toEqual({ x: 400, y: 90 });
  });

  it('turns the side insets of a left-to-right flow into top and bottom insets', () => {
    const source = endpoint({ ...box(40, 40, 60, 120), inset: { left: 0, right: 0, top: 15, bottom: 15 } }, null);
    const target = endpoint(box(300, 40, 60, 120), null);
    const route = routeGroupCrossing('LR', source, target)!;
    expect(route[0].y).toBe(100);
  });
});
