import { MermaidRuntime } from '../task-graph-model';

/**
 * Summary metrics of a graph's node statuses for card progress and badge calculation.
 */
export interface GraphProgressSummary {
  /** Total number of nodes in the graph. */
  total: number;
  /** Number of nodes that have finished (status is 'complete', 'done', or 'skipped'). */
  done: number;
  /** Number of nodes currently running (status is 'running'). */
  running: number;
  /** Number of nodes that have failed (status is 'failed'). */
  failed: number;
  /** Percentage of settled/done nodes (0-100), rounded to the nearest integer. */
  percent: number;
}

/**
 * Computes progress summary from a graph's nodes.
 *
 * PURPOSE: Calculate settlement percentage and active/failed counts across a graph's
 * nodes without duplicating logic across cards, boards, and lists.
 *
 * VALUE: Provides pure, host-agnostic progress calculation for kanban cards, run lists,
 * and preview bars.
 *
 * @param graph Graph to inspect, or null/undefined.
 * @returns Summary object with total, done, running, failed, and percentage.
 */
export function computeGraphProgress(graph: MermaidRuntime.Graph | null | undefined): GraphProgressSummary {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    return {
      total: 0,
      done: 0,
      running: 0,
      failed: 0,
      percent: 0,
    };
  }

  const total = graph.nodes.length;
  let done = 0;
  let running = 0;
  let failed = 0;

  for (const node of graph.nodes) {
    const status = node.status?.toLowerCase();
    if (status === 'complete' || status === 'done' || status === 'skipped') {
      done++;
    } else if (status === 'running') {
      running++;
    } else if (status === 'failed') {
      failed++;
    }
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    total,
    done,
    running,
    failed,
    percent,
  };
}

/**
 * Returns a cloned graph with all node statuses reset to the specified status.
 *
 * PURPOSE: Produces an idle or "template" representation of a task graph for cards,
 * catalog listings, or re-run previews.
 *
 * VALUE: Allows Kanban and task boards to show a pristine template graph without mutating
 * the original execution graph or requiring host-side cloning boilerplate.
 *
 * @param graph Source graph to clone and reset.
 * @param status Target status for every node (default: 'undone').
 * @returns A new graph instance with reset statuses.
 */
export function resetGraphStatuses(
  graph: MermaidRuntime.Graph,
  status: MermaidRuntime.NodeStatus = 'undone'
): MermaidRuntime.Graph {
  if (!graph.nodes) {
    return { ...graph, nodes: [] };
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const clonedNode: MermaidRuntime.Node = {
        ...node,
        status,
      };

      if (node.subgraph) {
        clonedNode.subgraph = resetGraphStatuses(node.subgraph, status);
      }

      return clonedNode;
    }),
  };
}
