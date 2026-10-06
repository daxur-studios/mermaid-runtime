import type { GraphFlowDirection } from './group-arrangement.utils';
import { readPolygonCentreInsets } from './shape-offset.utils';
import { buildRoundedRoutePath, pickRouteLabelPoint, routeGroupCrossing, type Box, type Point, type RouteGroup } from './group-route-geometry.utils';

/**
 * Attribute set on an edge path whose geometry was redrawn between its real steps.
 *
 * VALUE: Lets tests and hosts tell a redrawn arrow from one Mermaid routed.
 */
export const ROUTED_EDGE_ATTRIBUTE = 'data-mr-routed';

/** What to redraw: arrows between groups, by Mermaid alias. */
export interface GroupCrossingPlan {
  readonly flow: GraphFlowDirection;
  /** Alias of the group each grouped step belongs to, keyed by step alias. */
  readonly groupOfNode: ReadonlyMap<string, string>;
  /** Aliases of the groups whose arrows are redrawn; an arrow is redrawn if either end is in one. */
  readonly routedGroups: ReadonlySet<string>;
  /** Arrows between steps, by step alias. */
  readonly edges: readonly { from: string; to: string }[];
}

/**
 * Redraws every arrow that crosses a group border so it runs from the step it
 * leaves to the step it enters.
 *
 * PURPOSE: Mermaid draws such an arrow from group border to group border once
 * a group's direction differs from the graph's, and sometimes loops it at the
 * border. The steps are already placed where we want them; only the arrow is wrong.
 *
 * The existing path element is kept (same `id`, `data-id`, classes and markers),
 * and only its `d` changes, so status colours, pulses and hit-testing keep
 * working. A label on the arrow moves to the middle of its longest run.
 *
 * VALUE: Compact group layouts keep exact step-to-step arrows. Run it in the
 * hidden render sandbox, before the graph is shown.
 */
export function routeGroupCrossings(container: Element, plan: GroupCrossingPlan): void {
  const svg = container.querySelector('svg');
  if (!svg || plan.routedGroups.size === 0) return;

  const nodeBoxes = new Map<string, Box | null>();
  const readNodeBox = (alias: string): Box | null => {
    if (!nodeBoxes.has(alias)) nodeBoxes.set(alias, measureNode(svg.querySelector<SVGGraphicsElement>(`g.node[id*="flowchart-${alias}-"]`)));
    return nodeBoxes.get(alias) ?? null;
  };

  const groups = new Map<string, RouteGroup | null>();
  const readGroup = (alias: string): RouteGroup | null => {
    if (groups.has(alias)) return groups.get(alias) ?? null;
    const cluster = Array.from(svg.querySelectorAll<SVGGElement>('g.cluster')).find((element) => element.id === alias || element.id.endsWith(`-${alias}`));
    const box = measure(cluster?.querySelector<SVGGraphicsElement>(':scope > rect') ?? null);
    const memberBoxes = [...plan.groupOfNode].filter(([, group]) => group === alias).map(([node]) => readNodeBox(node)).filter((member): member is Box => member !== null);
    groups.set(alias, box && memberBoxes.length > 0 ? { box, contentBox: unionOf(memberBoxes) } : null);
    return groups.get(alias) ?? null;
  };

  for (const edge of plan.edges) {
    const sourceGroupAlias = plan.groupOfNode.get(edge.from);
    const targetGroupAlias = plan.groupOfNode.get(edge.to);
    if (sourceGroupAlias === targetGroupAlias) continue;
    if (!(sourceGroupAlias && plan.routedGroups.has(sourceGroupAlias)) && !(targetGroupAlias && plan.routedGroups.has(targetGroupAlias))) continue;

    const sourceNode = readNodeBox(edge.from);
    const targetNode = readNodeBox(edge.to);
    if (!sourceNode || !targetNode) continue;
    const route = routeGroupCrossing(
      plan.flow,
      { node: sourceNode, group: sourceGroupAlias ? readGroup(sourceGroupAlias) : null },
      { node: targetNode, group: targetGroupAlias ? readGroup(targetGroupAlias) : null },
    );
    if (!route) continue;

    for (const path of Array.from(svg.querySelectorAll<SVGPathElement>(`path[data-id^="L_${edge.from}_${edge.to}_"]`))) {
      redrawPath(svg, path, route);
    }
  }
}

/** Replaces `path`'s geometry with `route` (scene coordinates) and moves its label. */
function redrawPath(svg: SVGSVGElement, path: SVGPathElement, route: readonly Point[]): void {
  const toPathSpace = readSceneToLocal(path);
  if (!toPathSpace) return;
  path.setAttribute('d', buildRoundedRoutePath(route.map(toPathSpace)));
  path.setAttribute(ROUTED_EDGE_ATTRIBUTE, 'true');

  const edgeId = path.getAttribute('data-id');
  const label = edgeId ? svg.querySelector(`g.edgeLabel > g.label[data-id="${edgeId}"]`)?.parentElement : null;
  if (!label || !label.textContent?.trim()) return;
  const toLabelSpace = label.parentElement instanceof SVGGraphicsElement ? readSceneToLocal(label.parentElement) : null;
  if (!toLabelSpace) return;
  const point = toLabelSpace(pickRouteLabelPoint(route));
  label.setAttribute('transform', `translate(${point.x}, ${point.y})`);
}

/** Function turning scene points into `element`'s own coordinates, or `null` if it can't be placed. */
function readSceneToLocal(element: SVGGraphicsElement): ((point: Point) => Point) | null {
  const matrix = element.getCTM()?.inverse();
  if (!matrix) return null;
  return (point) => ({ x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f });
}

/** Box of `element` in scene (outer SVG) coordinates, or `null` if it can't be measured. */
function measure(element: SVGGraphicsElement | null): Box | null {
  const matrix = element?.getCTM();
  if (!element || !matrix) return null;
  let local: DOMRect;
  try {
    local = element.getBBox();
  } catch {
    return null;
  }
  if (local.width === 0 && local.height === 0) return null;
  const corner = (x: number, y: number): Point => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f });
  const first = corner(local.x, local.y);
  const second = corner(local.x + local.width, local.y + local.height);
  return { left: Math.min(first.x, second.x), top: Math.min(first.y, second.y), right: Math.max(first.x, second.x), bottom: Math.max(first.y, second.y) };
}

/**
 * Box of a step node, plus how far its outline sits inside that box where an
 * arrow meets it (non-zero only for slanted shapes such as a parallelogram).
 */
function measureNode(node: SVGGraphicsElement | null): Box | null {
  const box = measure(node);
  const shape = node?.querySelector<SVGGraphicsElement>('.label-container');
  const matrix = shape?.getCTM();
  if (!box || !(shape instanceof SVGPolygonElement) || !matrix) return box;
  const scenePoints = Array.from(shape.points).map((point) => ({ x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f }));
  const inset = readPolygonCentreInsets(scenePoints);
  if (!inset || (inset.left <= 0.5 && inset.right <= 0.5 && inset.top <= 0.5 && inset.bottom <= 0.5)) return box;
  return { ...box, inset: { left: Math.max(0, inset.left), right: Math.max(0, inset.right), top: Math.max(0, inset.top), bottom: Math.max(0, inset.bottom) } };
}

function unionOf(boxes: readonly Box[]): Box {
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}
