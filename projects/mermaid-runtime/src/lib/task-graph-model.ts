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
export namespace MermaidRuntime {
  /**
   * Host theme family used to choose Mermaid's built-in render theme.
   *
   * PURPOSE: Keep the runtime independent from any one app's theme service while
   * still letting hosts tell the graph renderer whether it sits on a light or dark surface.
   *
   * VALUE: Daxur and other hosts can theme Mermaid output with one stable input, and
   * future custom themes can map down to the same light/dark contrast family.
   */
  export type MermaidThemeId = 'light' | 'dark';

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

  /**
   * Visual treatment for one execution status.
   *
   * PURPOSE: Let a host map its own status vocabulary to a CSS class (and label)
   * instead of the viewer hardcoding a fixed set of states.
   *
   * VALUE: A consuming project supplies a `statusStyles` map and the viewer
   * colours nodes accordingly; the built-in five are merely the default map, so
   * projects with extra states (`queued`, `blocked`, …) style them without
   * touching the library.
   */
  export interface StatusStyle {
    /** CSS class added to the rendered node element for nodes in this status. */
    className: string;
    /** Optional human-readable label for legends/inspectors. */
    label?: string;
  }

  /**
   * Map of execution status → visual treatment.
   *
   * VALUE: Open like {@link NodeStatus} — a host can override the defaults and add
   * its own states in the same object.
   */
  export type StatusStyleMap = Partial<Record<NodeStatus, StatusStyle>>;

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

    /**
     * Optional display metadata shown in the inspector (kind + timing).
     *
     * VALUE: Mirrors the daemon's `TaskRunNode` fields so its nodes render full
     * detail, while leaner hosts may omit them — the inspector hides absent rows.
     */
    type?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    durationMs?: number | null;

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
   * A named cluster of nodes rendered as a bordered box via Mermaid's native
   * layout clustering.
   *
   * PURPOSE: Let a host visually differentiate related nodes (e.g. every 5th node
   * of a long chain) and, via `direction`, let the layout engine actually compact
   * them into rows/columns instead of one long line.
   *
   * VALUE: Membership lives here, not on `Node`, so grouping is a pure view
   * concern — consistent with `NodeDecoration`/`StatusStyleMap`. This is
   * deliberately unrelated to `Node.subgraph`/`subgraphId` below: a group stays
   * visible in the same view (it never replaces it), while a node's `subgraph` is
   * a separate child graph the viewer drills into.
   */
  export interface NodeGroup {
    id: string;
    label: string;
    /** Ids of the member nodes, at this graph's level. A node belongs to at most one group. */
    nodeIds: string[];
    /**
     * Internal layout direction for this group's members; inherits the outer
     * flow direction when omitted.
     *
     * CAVEAT: Mermaid/dagre's edge routing for edges that cross into or out of
     * a cluster is unreliable once the cluster's `direction` differs from its
     * parent's — the edge can visually clip to the cluster's border instead of
     * reaching the actual node. Only set `direction` on a group whose members
     * have no edges to/from nodes outside the group; otherwise omit it (the
     * group still renders as a labelled box, just without the layout
     * compaction a differing direction would otherwise give it).
     */
    direction?: 'TB' | 'BT' | 'LR' | 'RL';
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
    /** Optional node groups at this graph's level (see {@link NodeGroup}). */
    groups?: NodeGroup[] | null;
  }

  /** The kind of timeline events recorded during a graph execution. */
  export type ExecutionEventKind = 'node-started' | 'node-ended' | 'edge-traversed';

  /**
   * One timeline event in a graph's execution history.
   *
   * VALUE: Deliberate structural subset of DaxurDaemonAPI.TaskGraphExecutionEvent.
   */
  export interface ExecutionEvent {
    /** 1-based position in execution order. */
    seq: number;
    /** ISO timestamp the event occurred. */
    at: string;
    kind: ExecutionEventKind;
    nodeId?: string | null;
    edgeId?: string | null;
    status?: NodeStatus | null;
    detail?: string | null;
  }
}
