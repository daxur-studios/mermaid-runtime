import { MermaidRuntime } from '../task-graph-model';

/** A resolved graph edge, endpoints only (no label — decorative previews don't need it). */
export interface PreviewEdge {
  from: string;
  to: string;
}

/**
 * Resolve a graph's edges: explicit transitions, else per-node transitions, else dependencies.
 *
 * VALUE: Mirrors `GraphCanvasComponent`'s edge-resolution precedence so a preview draws the
 * same shape the interactive canvas would, regardless of which edge source a host supplies.
 */
export function resolvePreviewEdges(graph: MermaidRuntime.Graph): PreviewEdge[] {
  const explicit = graph.transitions ?? [];
  const perNode = graph.nodes.flatMap((node) => node.transitions ?? []);
  const transitions = explicit.length > 0 ? explicit : perNode;
  if (transitions.length > 0) {
    return transitions.map((transition) => ({ from: transition.from, to: transition.to }));
  }
  return graph.nodes.flatMap((node) => (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })));
}

/**
 * Longest-path depth (column index) for each node — a cycle-safe topological pass.
 *
 * VALUE: Places dependents to the right of their prerequisites, giving the box-diagram preview
 * a readable left-to-right flow regardless of declaration order.
 */
export function computePreviewDepths(nodes: readonly MermaidRuntime.Node[], edges: readonly PreviewEdge[]): Map<string, number> {
  const depth = new Map<string, number>();
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    depth.set(node.id, 0);
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  const queue = [...indegree.keys()].filter((id) => (indegree.get(id) ?? 0) === 0);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(current) ?? 0) + 1));
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return depth;
}

/**
 * Resolve a node's status to a CSS class via an already-merged status-style map.
 *
 * VALUE: Callers merge defaults + host overrides once (e.g. in a `computed()`), so this stays a
 * plain lookup instead of re-merging on every node.
 */
export function resolvePreviewStatusClass(status: MermaidRuntime.NodeStatus, mergedStatusStyles: MermaidRuntime.StatusStyleMap): string | undefined {
  return mergedStatusStyles[status]?.className;
}

/**
 * Structure-only signature of a graph: node ids + edges, deliberately excluding status.
 *
 * VALUE: Gates expensive re-layout (real Mermaid render) so it only happens when the graph's
 * shape actually changes, never on a status-only tick.
 */
export function hashPreviewStructure(graph: MermaidRuntime.Graph): string {
  const edges = resolvePreviewEdges(graph);
  return `${graph.nodes.map((node) => node.id).join('|')}::${edges.map((edge) => `${edge.from}>${edge.to}`).join('|')}`;
}

/**
 * Status-only signature of a graph's nodes.
 *
 * VALUE: Drives the cheap "recolour in place" path (DOM class toggling for the Mermaid
 * renderer, plain recompute for the simple renderer) independently from structure changes.
 */
export function hashPreviewStatuses(graph: MermaidRuntime.Graph): string {
  return graph.nodes.map((node) => `${node.id}:${node.status}`).join('|');
}
