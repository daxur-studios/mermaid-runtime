/**
 * Self-owned view model for the interactive task-graph viewer.
 *
 * PURPOSE: Give the graph viewer (`TaskGraphComponent` + `GraphCameraComponent`)
 * its own data contract so it depends on nothing daemon-specific. Every type here
 * is a deliberate structural *subset* of the daemon's `DaxurDaemonAPI.TaskRun*`
 * shapes, so a daemon `TaskRunNode[]` is assignable to `Node[]` with no adapter,
 * while any other node/workflow project can satisfy the same contract from its
 * own model.
 *
 * VALUE: This namespace is the seam that lets the viewer ship as a standalone
 * library. Nothing in here imports the daemon API; the only place the two models
 * are tied together is the type-only conformance check in
 * `task-graph-model.conformance.ts`, which breaks the build if they ever drift.
 *
 * See `docs/draft/033_task-graph-library-extraction.md` for the extraction plan.
 */
export namespace TaskGraphModel {
  /**
   * Execution state of a single graph node.
   *
   * PURPOSE: Drive per-node status colouring without binding the viewer to one
   * project's fixed set of states.
   *
   * VALUE: The five built-in states autocomplete and match the daemon defaults,
   * while `(string & {})` keeps the union open so a consuming project can supply
   * its own states (e.g. `queued`, `blocked`) and map them via `statusStyles`.
   */
  export type NodeStatus =
    | 'undone'
    | 'running'
    | 'complete'
    | 'failed'
    | 'skipped'
    | (string & {});

  /** A directed runtime edge between two nodes, with an optional label/condition. */
  export interface Transition {
    from: string;
    to: string;
    label?: string | null;
    condition?: string | null;
  }

  /**
   * Per-node visual override supplied by the host.
   *
   * PURPOSE: Let a caller relabel a node or render it as a decision diamond
   * without polluting the execution model with view concerns.
   *
   * VALUE: Hosts keep their domain titles/shapes out of the node data and pass
   * them as a separate decoration map.
   */
  export interface NodeDecoration {
    displayTitle?: string;
    shape?: 'rect' | 'diamond';
  }

  /** Reference to structured input/output/context data stored outside the node. */
  export interface DataRef {
    id: string;
    kind: 'input' | 'output' | 'context';
    path: string;
    contentType?: 'application/json' | 'text/markdown' | 'text/plain' | string | null;
    summary?: string | null;
  }

  /** Reference to logs correlated with a specific node. */
  export interface LogRef {
    id: string;
    path?: string | null;
    eventId?: string | null;
    label?: string | null;
    summary?: string | null;
  }

  /** Reference to an artifact produced or inspected by a node. */
  export interface ArtifactRef {
    id: string;
    path: string;
    label?: string | null;
    kind?: string | null;
    summary?: string | null;
  }

  /** Ref group names the inspector can request a preview for. */
  export type InspectableRefKind = 'input' | 'output' | 'context' | 'log' | 'artifact';

  /** Any node ref that can point at a loadable preview. */
  export type InspectableRef = DataRef | LogRef | ArtifactRef;

  /**
   * Preview payload returned for a clicked node ref.
   *
   * PURPOSE: Carry bounded ref content into the inspector.
   *
   * VALUE: The viewer renders previews from this shape regardless of how the host
   * loads them (daemon HTTP route today, any `RefLoader` once the inspector seam
   * is cut — see the extraction plan).
   */
  export interface RefContent {
    refKind: InspectableRefKind;
    ref: InspectableRef;
    path: string | null;
    contentType: string | null;
    content: string;
    sizeBytes: number;
    truncated: boolean;
  }

  /**
   * A renderable graph node — the only required input shape for the viewer.
   *
   * PURPOSE: Describe a node with just the fields the viewer reads (identity,
   * status, edges, progress, optional drill-down refs, and optional nested graph).
   *
   * VALUE: A deliberate subset of `DaxurDaemonAPI.TaskRunNode`, so daemon nodes
   * pass straight in, while a leaner host can satisfy it without the daemon's
   * extra execution-record fields (timing, attempts, …).
   */
  export interface Node {
    id: string;
    title: string;
    status: NodeStatus;
    detail?: string | null;
    error?: string | null;
    dependencies?: string[] | null;
    transitions?: Transition[] | null;
    progressPercent?: number | null;
    progressLabel?: string | null;
    inputRefs?: DataRef[] | null;
    outputRefs?: DataRef[] | null;
    contextRefs?: DataRef[] | null;
    logRefs?: LogRef[] | null;
    artifactRefs?: ArtifactRef[] | null;

    /**
     * Id of a subgraph this node drills into (host-resolved, daemon-compatible).
     *
     * VALUE: Lets a high-level node point at a child graph the host supplies
     * separately (via a resolver), matching the daemon's existing `subgraphId`.
     */
    subgraphId?: string | null;

    /** Optional label for the referenced/inline subgraph (e.g. shown on the node). */
    subgraphLabel?: string | null;

    /**
     * Inline child graph for self-contained, arbitrarily-nested subgraphs.
     *
     * PURPOSE: Allow a node to carry its own nested nodes/transitions directly,
     * so the viewer can enter/leave and minify-preview it without a separate
     * resolver call.
     *
     * VALUE: Hosts that already hold the full nested structure (the common case
     * outside the daemon) get nesting for free; the daemon path can keep using
     * `subgraphId` + a resolver instead. Optional, so daemon nodes (which omit
     * it) still satisfy this contract.
     */
    subgraph?: Graph | null;
  }

  /**
   * A self-contained graph: the top-level viewer input and the shape of any
   * nested subgraph.
   *
   * PURPOSE: Give nesting one recursive type, so a subgraph is just another graph.
   *
   * VALUE: The viewer's enter/leave navigation and minified subgraph preview both
   * operate on `Graph` at any depth without special-casing levels.
   */
  export interface Graph {
    nodes: Node[];
    transitions?: Transition[] | null;
  }
}
