import * as _angular_core from '@angular/core';
import { InjectionToken } from '@angular/core';
import { MermaidAPI } from 'ngx-markdown';
import { Observable } from 'rxjs';

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
declare namespace MermaidRuntime {
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
    type NodeStatus = 'undone' | 'running' | 'complete' | 'failed' | 'skipped' | (string & {});
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
    interface StatusStyle {
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
    type StatusStyleMap = Partial<Record<NodeStatus, StatusStyle>>;
    /** A directed runtime edge between two nodes, with an optional label/condition. */
    interface Transition {
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
    interface NodeDecoration {
        displayTitle?: string;
        shape?: 'rect' | 'diamond';
    }
    /** Reference to structured input/output/context data stored outside the node. */
    interface DataRef {
        id: string;
        kind: 'input' | 'output' | 'context';
        path: string;
        contentType?: 'application/json' | 'text/markdown' | 'text/plain' | string | null;
        summary?: string | null;
    }
    /** Reference to logs correlated with a specific node. */
    interface LogRef {
        id: string;
        path?: string | null;
        eventId?: string | null;
        label?: string | null;
        summary?: string | null;
    }
    /** Reference to an artifact produced or inspected by a node. */
    interface ArtifactRef {
        id: string;
        path: string;
        label?: string | null;
        kind?: string | null;
        summary?: string | null;
    }
    /** Ref group names the inspector can request a preview for. */
    type InspectableRefKind = 'input' | 'output' | 'context' | 'log' | 'artifact';
    /** Any node ref that can point at a loadable preview. */
    type InspectableRef = DataRef | LogRef | ArtifactRef;
    /**
     * Preview payload returned for a clicked node ref.
     *
     * PURPOSE: Carry bounded ref content into the inspector.
     *
     * VALUE: The viewer renders previews from this shape regardless of how the host
     * loads them (daemon HTTP route today, any `RefLoader` once the inspector seam
     * is cut — see the extraction plan).
     */
    interface RefContent {
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
    interface Node {
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
     * A self-contained graph: the top-level viewer input and the shape of any
     * nested subgraph.
     *
     * PURPOSE: Give nesting one recursive type, so a subgraph is just another graph.
     *
     * VALUE: The viewer's enter/leave navigation and minified subgraph preview both
     * operate on `Graph` at any depth without special-casing levels.
     */
    interface Graph {
        nodes: Node[];
        transitions?: Transition[] | null;
    }
}

/** A breadcrumb entry: a navigable depth in the graph stack (0 = root). */
interface GraphCrumb {
    label: string;
    depth: number;
}
/**
 * Payload emitted when the user enters or leaves a subgraph.
 *
 * Value: Carries the full root→current node-id path so a host can mirror depth
 * into its router/history for browser back/forward.
 */
interface SubgraphNavEvent {
    /** Node-id path from root to the current level (empty at root). */
    path: string[];
    /** The node drilled into for the current level, or null at root. */
    nodeId: string | null;
    /** The current level's breadcrumb label, or null at root. */
    label: string | null;
}
declare class GraphCanvasComponent {
    private readonly hostElement;
    private readonly destroyRef;
    private readonly cameraRef;
    /** Execution nodes to render. The host owns their lifecycle and status. */
    readonly nodes: _angular_core.InputSignal<MermaidRuntime.Node[]>;
    /**
     * Runtime/story edges. When omitted, edges fall back to per-node
     * `transitions`, then to `dependencies` so a dependency-only graph still draws.
     */
    readonly transitions: _angular_core.InputSignal<MermaidRuntime.Transition[] | null>;
    /** Currently selected node id (highlight only; host owns the value). */
    readonly selectedNodeId: _angular_core.InputSignal<string | null>;
    /** The node to mark as the live "current" focus, if any. */
    readonly currentNodeId: _angular_core.InputSignal<string | null>;
    /** Per-node display overrides, keyed by real node id. */
    readonly decorations: _angular_core.InputSignal<Record<string, MermaidRuntime.NodeDecoration>>;
    /**
     * Status → visual-treatment overrides, merged over {@link DEFAULT_STATUS_STYLES}.
     *
     * VALUE: A host defines its own status vocabulary/colours (and can add states
     * beyond the built-in five) without forking the component.
     */
    readonly statusStyles: _angular_core.InputSignal<Partial<Record<MermaidRuntime.NodeStatus, MermaidRuntime.StatusStyle>>>;
    /** Breadcrumb label for the root (top-level) graph. */
    readonly rootLabel: _angular_core.InputSignal<string>;
    /** Whether to render the breadcrumb overlay while inside a subgraph. */
    readonly showBreadcrumb: _angular_core.InputSignal<boolean>;
    /**
     * Whether drillable nodes show a small, static thumbnail of their child graph.
     *
     * VALUE: A purely decorative hint that a node contains a subgraph (and its
     * rough shape); set false to drop it entirely with no other behaviour change.
     */
    readonly showSubgraphPreview: _angular_core.InputSignal<boolean>;
    /**
     * Whether a host has projected `[detail]` chrome — toggles the side column.
     *
     * VALUE: Lets the canvas reserve layout space for a projected inspector without
     * knowing what it is.
     */
    readonly showDetail: _angular_core.InputSignal<boolean>;
    /**
     * Resolves a node's child graph. When omitted, the node's inline
     * `subgraph` is used.
     *
     * VALUE: Lets daemon-style hosts turn a `subgraphId` into a `Graph` lazily,
     * while inline-graph hosts need supply nothing.
     */
    readonly subgraphResolver: _angular_core.InputSignal<((node: MermaidRuntime.Node) => MermaidRuntime.Graph | null) | null>;
    /**
     * Externally-controlled subgraph path (root node ids drilled into).
     *
     * VALUE: The history seam — a host drives this from its router so browser
     * back/forward can restore the viewer's depth; the viewer reconciles its stack
     * to match and emits {@link graphPathChange} when the user navigates.
     */
    readonly path: _angular_core.InputSignal<readonly string[]>;
    /**
     * When true, the camera keeps the running ("green") nodes framed as the run
     * progresses. A manual pan/zoom pauses it until the host re-enables follow or
     * the user clicks the re-center chip.
     */
    readonly followExecution: _angular_core.InputSignal<boolean>;
    /** Emits the real node id when a node is clicked. */
    readonly nodeSelected: _angular_core.OutputEmitterRef<string>;
    /** Emits when the user drills into a node's subgraph. */
    readonly subgraphEntered: _angular_core.OutputEmitterRef<SubgraphNavEvent>;
    /** Emits when the user leaves a subgraph (one or more levels up). */
    readonly subgraphLeft: _angular_core.OutputEmitterRef<SubgraphNavEvent>;
    /**
     * Emits the new root→current node-id path whenever the user enters or leaves a
     * subgraph.
     *
     * VALUE: The single output a host wires to its history (push on change, restore
     * via the {@link path} input on back/forward).
     */
    readonly graphPathChange: _angular_core.OutputEmitterRef<string[]>;
    protected readonly mermaidOptions: MermaidAPI.MermaidConfig;
    private readonly internalSelectedNodeId;
    /**
     * Subgraph navigation stack. Empty = root graph; each frame is one level the
     * user has drilled into. The top frame decides what the viewer renders.
     */
    private readonly graphStack;
    /** Nodes for the level currently shown — the root input, or the top frame. */
    private readonly activeNodes;
    /** Transitions for the level currently shown — the root input, or the top frame. */
    private readonly activeTransitions;
    /** True while inside a subgraph (the stack is non-empty). */
    protected readonly inSubgraph: _angular_core.Signal<boolean>;
    /** Breadcrumb trail (root + each entered level); empty at the root graph. */
    protected readonly breadcrumb: _angular_core.Signal<GraphCrumb[]>;
    /** Built-in status styles with any host `statusStyles` merged over them. */
    private readonly effectiveStatusStyles;
    /** Every CSS class the status map can apply — stripped before re-applying. */
    private readonly statusClassNames;
    private readonly aliasMap;
    protected readonly flowMarkdown: _angular_core.Signal<string>;
    protected readonly effectiveSelectedNodeId: _angular_core.Signal<string>;
    /** The resolved selected node — exposed so projected chrome can render its detail. */
    readonly selectedNode: _angular_core.Signal<MermaidRuntime.Node | null>;
    /** Whether the selected node can be drilled into — exposed for the projected inspector. */
    readonly selectedNodeHasSubgraph: _angular_core.Signal<boolean>;
    /** Ids of the currently running nodes, joined — drives follow re-framing. */
    private readonly runningKey;
    /** Joined `id:status` pairs — drives live status-class application (no re-render). */
    private readonly statusKey;
    /** Joined node progress values — drives live progress-bar DOM updates. */
    private readonly progressKey;
    /** Follow temporarily suspended after a manual pan/zoom. */
    protected readonly followPaused: _angular_core.WritableSignal<boolean>;
    /** Follow is on and not paused — the camera should track the running nodes. */
    protected readonly followActive: _angular_core.Signal<boolean>;
    /** Whether to offer the "re-center" chip (follow on, but paused by the user). */
    protected readonly showRecenterChip: _angular_core.Signal<boolean>;
    /** True once the first Mermaid node has rendered, so we fit the view once. */
    private hasFitInitialView;
    /** Last seen `followExecution` value, to detect off→on (which resumes follow). */
    private lastFollowOn;
    private followFramePending;
    /**
     * Track previous status of each node.
     *
     * VALUE: Detects real-time state transitions so the component only pulses nodes
     * that changed state while the user is actively watching.
     */
    private readonly previousStatuses;
    constructor();
    private buildAliasMap;
    /**
     * Build the Mermaid source for the graph **structure only** (nodes, edges,
     * shapes, click targets) — never status or current-focus.
     *
     * Status colouring and the live "current" highlight are applied as DOM classes
     * on the rendered `.node` elements (see `applyStatusClasses`). Keeping them out
     * of the source means `flowMarkdown` only changes when the structure changes,
     * so a run that merely advances statuses produces zero Mermaid re-renders.
     */
    private buildGraph;
    private buildNodeDefinitionLine;
    /**
     * Builds the Mermaid node label.
     *
     * PURPOSE: Keep Mermaid source limited to plain node text.
     *
     * VALUE: Live progress markup is injected after render, so Mermaid cannot
     * parse-fail on HTML controls or changing percentage values.
     */
    private buildNodeLabel;
    /**
     * Reads a safe whole-number progress value from a task-run node.
     *
     * PURPOSE: Avoid pushing null, NaN, or out-of-range progress into Mermaid HTML
     * labels.
     *
     * VALUE: The generated `<progress>` element always receives valid numeric
     * attributes.
     */
    private readNodeProgressPercent;
    private buildEdgeLines;
    /** Prefer explicit transitions, then per-node transitions, then dependencies. */
    private resolveEdges;
    private buildNodeClickLine;
    private escapeMermaidString;
    private onChartMutation;
    /** Called by the camera when the user manually pans/zooms — pauses follow. */
    protected onUserInteract(): void;
    /** Re-center chip handler: resume follow and move to the active node. */
    protected resumeFollow(): void;
    /**
     * Re-frame on the active node when follow is live. Resumes follow if the host
     * just toggled `followExecution` back on.
     */
    private scheduleFollow;
    /**
     * Queue a follow re-frame for the next animation frame.
     *
     * A status change fires both the follow effect and a burst of Mermaid DOM
     * mutations; coalescing them to a single frame stops the camera re-animating
     * many times for one execution event.
     */
    private requestFrameActiveNode;
    /**
     * Move the camera to the active node (plus its 1-hop neighbours, so the
     * previous/upcoming nodes stay visible). Measures the live render: the layout
     * is stable, so even a node from the outgoing SVG yields the right position.
     */
    private frameActiveNode;
    /** The node the camera should follow: the live focus, else a running node. */
    private activeFocusId;
    /** Undirected 1-hop adjacency built from the resolved edges. */
    private buildNeighbourMap;
    /** Resolve a real node id to its rendered `.node` element, via the click anchor. */
    private findNodeElement;
    private handleChartClick;
    /** Double-click a drillable node to enter its subgraph. */
    private handleChartDblClick;
    private readNodeIdFromLink;
    private scheduleSelectedNodeClass;
    /** Defer status-class application to the next frame, after any pending render. */
    private scheduleStatusClasses;
    /** Defer progress-bar application to the next frame, after any pending render. */
    private scheduleNodeProgressBars;
    /** Defer subgraph-preview application to the next frame, after any pending render. */
    private scheduleSubgraphPreviews;
    /**
     * Apply each node's status colour and the live "current" highlight directly to
     * its rendered `.node` element, replacing the previous classes.
     *
     * PURPOSE: Reflect execution progress without regenerating the Mermaid source.
     *
     * VALUE: The SVG stays put across status updates — no teardown/rebuild — so the
     * camera measures a stable layout and node label sizing never jumps.
     */
    private applyStatusClasses;
    /**
     * Temporarily thickens the node border outline.
     *
     * VALUE: Provides immediate visual feedback to the human operator that a specific
     * node has transitioned status (e.g. finished running or encountered an error).
     */
    private triggerNodePulse;
    /**
     * Temporarily animates incoming connections as dashed marching ants.
     *
     * VALUE: Visually represents active flow transitions, making it clear to the operator
     * which path triggered the newly active node.
     */
    private triggerIncomingEdgesPulse;
    /**
     * Applies status class modifiers to connection lines leading to nodes.
     *
     * VALUE: Styles traversed connection lines based on target node outcomes (e.g., solid
     * green for complete, solid red for failed), highlighting the execution path.
     */
    private applyEdgeStatusClasses;
    /**
     * Determine if a connection line should be visually colored/animated based on execution.
     *
     * VALUE: Prevents loop paths from highlighting prematurely, handles failed node recovery pathing,
     * and preserves parallel join animations using endedAt/startedAt timestamps.
     */
    private isEdgeActive;
    /**
     * Find a rendered Mermaid edge path element in the DOM.
     *
     * VALUE: Direct query targeting of path elements via data-id and id attributes, bypassing
     * Mermaid's auto-generated unique ID suffixes.
     */
    private findEdgeElement;
    /**
     * Apply each node's progress directly to the rendered Mermaid label.
     *
     * PURPOSE: Show live 0-100% node progress without changing the Mermaid source.
     *
     * VALUE: Progress ticks update the bar in place, keeping the camera and
     * selected node stable while long-running work advances.
     */
    private applyNodeProgressBars;
    private applySelectedNodeClass;
    /**
     * Inject (or refresh) a static thumbnail of each drillable node's child graph
     * into the node label.
     *
     * PURPOSE: Hint a node's subgraph and its rough shape inline, without the host
     * decorating anything.
     *
     * VALUE: Decoration only — it is `pointer-events: none`, cached by structure
     * hash so status/progress ticks never rebuild it, and re-injected idempotently
     * after a structural Mermaid re-render. Never participates in selection,
     * follow, or progress, so it cannot trigger a MutationObserver re-render storm.
     */
    private applySubgraphPreviews;
    /** Strip every injected subgraph thumbnail (toggle off). */
    private removeSubgraphPreviews;
    /**
     * Build the static mini-preview SVG for a child graph plus a structure hash.
     *
     * PURPOSE: Lay the child graph out as a tiny dependency-layered dot diagram
     * (columns = depth, terminal nodes accented) that reads as "this node contains
     * a few steps".
     *
     * VALUE: Pure structure — it ignores node status, so the cached SVG only needs
     * rebuilding when the child graph's nodes/edges change.
     */
    private buildSubgraphPreview;
    /**
     * Longest-path depth (column index) for each node in a child graph.
     *
     * VALUE: A topological pass (cycle-safe) that places dependents to the right of
     * their prerequisites, giving the mini-preview a readable left-to-right flow.
     */
    private computeGraphDepths;
    /** Resolve a child graph's edges (explicit → per-node → dependencies). */
    private resolveGraphEdges;
    /** Resolve a node's child graph via the host resolver, else its inline graph. */
    private resolveSubgraph;
    /** Drill into a node's subgraph, pushing one level onto the stack. */
    enterSubgraph(node: MermaidRuntime.Node): void;
    /** Enter the currently-selected node's subgraph (inspector affordance). */
    enterSelectedSubgraph(): void;
    /** Pop the stack back to `depth` (0 = root). Backs the breadcrumb crumbs. */
    goToDepth(depth: number): void;
    /** Leave the current subgraph, one level up. */
    leaveSubgraph(): void;
    /**
     * Shared after-navigation bookkeeping.
     *
     * PURPOSE: Reset per-level selection, re-fit the new level, and tell the host
     * where we are via the nav outputs.
     *
     * VALUE: Enter, leave, and breadcrumb jumps all emit one consistent path so the
     * host's history stays in lockstep with the viewer.
     */
    private onNavigated;
    /**
     * Rebuild the navigation stack to match a host-supplied node-id path.
     *
     * PURPOSE: Let the host restore subgraph depth from browser history without the
     * viewer and the URL fighting each other.
     *
     * VALUE: A no-op when the stack already matches (so the echo from our own
     * {@link graphPathChange} never loops), and it walks the chain from the root
     * input, resolving each level — so deep links and back/forward land exactly
     * where the user left off.
     */
    private reconcileStackToPath;
    /** Shallow ordered equality for two node-id paths. */
    private samePath;
    static ɵfac: _angular_core.ɵɵFactoryDeclaration<GraphCanvasComponent, never>;
    static ɵcmp: _angular_core.ɵɵComponentDeclaration<GraphCanvasComponent, "app-graph-canvas", never, { "nodes": { "alias": "nodes"; "required": true; "isSignal": true; }; "transitions": { "alias": "transitions"; "required": false; "isSignal": true; }; "selectedNodeId": { "alias": "selectedNodeId"; "required": false; "isSignal": true; }; "currentNodeId": { "alias": "currentNodeId"; "required": false; "isSignal": true; }; "decorations": { "alias": "decorations"; "required": false; "isSignal": true; }; "statusStyles": { "alias": "statusStyles"; "required": false; "isSignal": true; }; "rootLabel": { "alias": "rootLabel"; "required": false; "isSignal": true; }; "showBreadcrumb": { "alias": "showBreadcrumb"; "required": false; "isSignal": true; }; "showSubgraphPreview": { "alias": "showSubgraphPreview"; "required": false; "isSignal": true; }; "showDetail": { "alias": "showDetail"; "required": false; "isSignal": true; }; "subgraphResolver": { "alias": "subgraphResolver"; "required": false; "isSignal": true; }; "path": { "alias": "path"; "required": false; "isSignal": true; }; "followExecution": { "alias": "followExecution"; "required": false; "isSignal": true; }; }, { "nodeSelected": "nodeSelected"; "subgraphEntered": "subgraphEntered"; "subgraphLeft": "subgraphLeft"; "graphPathChange": "graphPathChange"; }, never, ["[overlay]", "[detail]"], true, never>;
}

/**
 * Per-node visual override supplied by the host.
 *
 * Value: Re-exported from the viewer's self-owned model so existing consumers
 * keep importing `TaskGraphNodeDecoration` from this component while the canonical
 * definition lives in `MermaidRuntime` (the extractable library surface).
 */
type TaskGraphNodeDecoration = MermaidRuntime.NodeDecoration;

/**
 * Default composition of the graph canvas + projected inspector.
 *
 * PURPOSE: Preserve the original `<app-task-graph>` API — one component a host
 * drops in with `[nodes]`, `[showInspector]`, etc. — by wiring the new
 * {@link GraphCanvasComponent} (rendering/interaction) to the optional
 * {@link GraphInspectorComponent} projected into its `[detail]` slot.
 *
 * VALUE: Existing consumers (task-live page, the workflows demo) keep working
 * unchanged, while projects that want a custom layout can compose the canvas and
 * their own chrome directly. The inspector binds to the canvas's exposed
 * `selectedNode` via a template ref, so selection state lives in one place.
 */
declare class TaskGraphComponent {
    /** Execution nodes to render. The host owns their lifecycle and status. */
    readonly nodes: _angular_core.InputSignal<MermaidRuntime.Node[]>;
    /**
     * Runtime/story edges. When omitted, edges fall back to per-node
     * `transitions`, then to `dependencies` so a dependency-only graph still draws.
     */
    readonly transitions: _angular_core.InputSignal<MermaidRuntime.Transition[] | null>;
    /** Currently selected node id (highlight only; host owns the value). */
    readonly selectedNodeId: _angular_core.InputSignal<string | null>;
    /** Durable run id used for loading ref previews from the local daemon. */
    readonly runId: _angular_core.InputSignal<string | null>;
    /** Whether to render the selected-node detail inspector beside the graph. */
    readonly showInspector: _angular_core.InputSignal<boolean>;
    /** The node to mark as the live "current" focus, if any. */
    readonly currentNodeId: _angular_core.InputSignal<string | null>;
    /** Per-node display overrides, keyed by real node id. */
    readonly decorations: _angular_core.InputSignal<Record<string, MermaidRuntime.NodeDecoration>>;
    /**
     * Status → visual-treatment overrides, merged over the canvas defaults.
     *
     * VALUE: A host defines its own status vocabulary/colours (and can add states
     * beyond the built-in five) without forking the component.
     */
    readonly statusStyles: _angular_core.InputSignal<Partial<Record<MermaidRuntime.NodeStatus, MermaidRuntime.StatusStyle>>>;
    /** Breadcrumb label for the root (top-level) graph. */
    readonly rootLabel: _angular_core.InputSignal<string>;
    /** Whether to render the breadcrumb overlay while inside a subgraph. */
    readonly showBreadcrumb: _angular_core.InputSignal<boolean>;
    /**
     * Whether drillable nodes show a small, static thumbnail of their child graph.
     *
     * VALUE: Decorative only; set false to drop the inline subgraph previews.
     */
    readonly showSubgraphPreview: _angular_core.InputSignal<boolean>;
    /**
     * Resolves a node's child graph. When omitted, the node's inline
     * `subgraph` is used.
     */
    readonly subgraphResolver: _angular_core.InputSignal<((node: MermaidRuntime.Node) => MermaidRuntime.Graph | null) | null>;
    /**
     * Externally-controlled subgraph path (root node ids drilled into) — the
     * history seam a host drives from its router for browser back/forward.
     */
    readonly path: _angular_core.InputSignal<readonly string[]>;
    /**
     * When true, the camera keeps the running ("green") nodes framed as the run
     * progresses.
     */
    readonly followExecution: _angular_core.InputSignal<boolean>;
    /** Emits the real node id when a node is clicked. */
    readonly nodeSelected: _angular_core.OutputEmitterRef<string>;
    /** Emits when the user drills into a node's subgraph. */
    readonly subgraphEntered: _angular_core.OutputEmitterRef<SubgraphNavEvent>;
    /** Emits when the user leaves a subgraph (one or more levels up). */
    readonly subgraphLeft: _angular_core.OutputEmitterRef<SubgraphNavEvent>;
    /** Emits the new root→current node-id path whenever the user navigates subgraphs. */
    readonly graphPathChange: _angular_core.OutputEmitterRef<string[]>;
    static ɵfac: _angular_core.ɵɵFactoryDeclaration<TaskGraphComponent, never>;
    static ɵcmp: _angular_core.ɵɵComponentDeclaration<TaskGraphComponent, "app-task-graph", never, { "nodes": { "alias": "nodes"; "required": true; "isSignal": true; }; "transitions": { "alias": "transitions"; "required": false; "isSignal": true; }; "selectedNodeId": { "alias": "selectedNodeId"; "required": false; "isSignal": true; }; "runId": { "alias": "runId"; "required": false; "isSignal": true; }; "showInspector": { "alias": "showInspector"; "required": false; "isSignal": true; }; "currentNodeId": { "alias": "currentNodeId"; "required": false; "isSignal": true; }; "decorations": { "alias": "decorations"; "required": false; "isSignal": true; }; "statusStyles": { "alias": "statusStyles"; "required": false; "isSignal": true; }; "rootLabel": { "alias": "rootLabel"; "required": false; "isSignal": true; }; "showBreadcrumb": { "alias": "showBreadcrumb"; "required": false; "isSignal": true; }; "showSubgraphPreview": { "alias": "showSubgraphPreview"; "required": false; "isSignal": true; }; "subgraphResolver": { "alias": "subgraphResolver"; "required": false; "isSignal": true; }; "path": { "alias": "path"; "required": false; "isSignal": true; }; "followExecution": { "alias": "followExecution"; "required": false; "isSignal": true; }; }, { "nodeSelected": "nodeSelected"; "subgraphEntered": "subgraphEntered"; "subgraphLeft": "subgraphLeft"; "graphPathChange": "graphPathChange"; }, never, never, true, never>;
}

/**
 * Ref group rendered in the selected-node inspector.
 *
 * Value: Keeps the template generic while each node can publish inputs,
 * outputs, context, logs, and artifacts through separate fields.
 */
interface InspectorRefGroup {
    title: string;
    kind: MermaidRuntime.InspectableRefKind;
    refs: MermaidRuntime.InspectableRef[];
}
/**
 * Ref currently selected for preview.
 *
 * Value: Couples the clicked ref to its node so repeated ref ids on different
 * nodes cannot highlight or preview the wrong evidence.
 */
interface SelectedInspectorRef {
    nodeId: string;
    refKind: MermaidRuntime.InspectableRefKind;
    ref: MermaidRuntime.InspectableRef;
}
/**
 * Selected-node detail sidebar for the graph canvas.
 *
 * PURPOSE: Render the selected node's metadata, progress, detail/error, and
 * inspectable refs (inputs/outputs/context/logs/artifacts), loading each ref's
 * preview lazily through the host-supplied {@link TASK_GRAPH_REF_LOADER}.
 *
 * VALUE: A default, optional sibling the host projects into the canvas's
 * `[detail]` slot and feeds from the canvas's exposed `selectedNode` signal — so
 * the canvas owns no inspector chrome and the only backend tie (ref loading)
 * stays a pluggable token, not a daemon import.
 */
declare class GraphInspectorComponent {
    private readonly destroyRef;
    /** Host-supplied loader for node-ref previews; absent when no inspector backend. */
    private readonly refLoader;
    /** The node to inspect — the canvas's `selectedNode`, or null for the empty state. */
    readonly node: _angular_core.InputSignal<MermaidRuntime.Node | null>;
    /** Durable run id used for loading ref previews. */
    readonly runId: _angular_core.InputSignal<string | null>;
    /** Whether the inspected node can be drilled into (drives the enter-subgraph button). */
    readonly hasSubgraph: _angular_core.InputSignal<boolean>;
    /** Emits when the user asks to drill into the inspected node's subgraph. */
    readonly enterSubgraph: _angular_core.OutputEmitterRef<void>;
    protected readonly copiedNodeId: _angular_core.WritableSignal<string | null>;
    protected readonly selectedNodeRefGroups: _angular_core.Signal<InspectorRefGroup[]>;
    protected readonly selectedRef: _angular_core.WritableSignal<SelectedInspectorRef | null>;
    protected readonly selectedRefContent: _angular_core.WritableSignal<MermaidRuntime.RefContent | null>;
    protected readonly selectedRefLoading: _angular_core.WritableSignal<boolean>;
    protected readonly selectedRefError: _angular_core.WritableSignal<string | null>;
    protected readonly selectedRefDisplayText: _angular_core.Signal<string>;
    /** Id of the node whose ref preview is currently shown — guards stale clears. */
    private lastInspectedNodeId;
    constructor();
    /**
     * Copy a compact, agent-friendly summary of the node to the clipboard.
     *
     * PURPOSE: Let the Human hand a node's status/progress/detail to a coding agent
     * in one click.
     *
     * VALUE: No manual transcription of run id, node id, status, and error text.
     */
    protected copyNodeForAgent(node: MermaidRuntime.Node): void;
    /**
     * Build non-empty ref groups for the selected node.
     *
     * PURPOSE: Present all evidence types through one inspector path while keeping
     * the persisted node shape separated by ref purpose.
     *
     * VALUE: Any task that publishes refs gets clickable inputs, outputs, context,
     * logs, and artifacts without a task-specific component.
     */
    private buildRefGroups;
    /**
     * Load a clicked node ref through the host-supplied {@link TASK_GRAPH_REF_LOADER}.
     *
     * PURPOSE: Turn published node refs into inspectable evidence without the
     * inspector knowing how the host fetches them.
     *
     * VALUE: Inputs, outputs, context, logs, and artifacts become reviewable from
     * the same reusable component, while the backend (daemon HTTP route, a
     * different API, or in-memory data) stays a pluggable seam.
     */
    protected openNodeRef(nodeId: string, refKind: MermaidRuntime.InspectableRefKind, ref: MermaidRuntime.InspectableRef): void;
    /**
     * Check whether a ref row is currently selected.
     *
     * PURPOSE: Keep row highlighting aligned with the preview block.
     *
     * VALUE: The Human can see exactly which published ref produced the visible
     * content below the node details.
     */
    protected isSelectedRef(nodeId: string, refKind: MermaidRuntime.InspectableRefKind, refId: string): boolean;
    /**
     * Read a concise label from any task-run ref.
     *
     * PURPOSE: Normalize data, log, and artifact refs for compact row rendering.
     *
     * VALUE: The template stays readable while preserving each ref's original shape.
     */
    protected readRefLabel(ref: MermaidRuntime.InspectableRef): string;
    /**
     * Read the main summary line from any task-run ref.
     *
     * PURPOSE: Prefer human-authored summaries and fall back to the stored path or event id.
     *
     * VALUE: Ref rows remain useful even when a task only publishes a file pointer.
     */
    protected readRefSummary(ref: MermaidRuntime.InspectableRef): string;
    /**
     * Read the path display value from any task-run ref.
     *
     * PURPOSE: Hide optional-path branching from the template.
     *
     * VALUE: Event-only refs can render without showing an empty path row.
     */
    protected readRefPath(ref: MermaidRuntime.InspectableRef): string | null;
    /**
     * Format loaded ref content for display.
     *
     * PURPOSE: Pretty-print JSON snapshots while leaving logs and text artifacts untouched.
     *
     * VALUE: Structured node context is easier to inspect without changing how refs are stored.
     */
    private formatTaskRunRefContent;
    /**
     * Clear the current ref preview when the selected node changes.
     *
     * PURPOSE: Avoid showing stale evidence for a node that is no longer selected.
     *
     * VALUE: The side panel always reads as one coherent node inspection.
     */
    private clearSelectedRef;
    static ɵfac: _angular_core.ɵɵFactoryDeclaration<GraphInspectorComponent, never>;
    static ɵcmp: _angular_core.ɵɵComponentDeclaration<GraphInspectorComponent, "app-graph-inspector", never, { "node": { "alias": "node"; "required": false; "isSignal": true; }; "runId": { "alias": "runId"; "required": false; "isSignal": true; }; "hasSubgraph": { "alias": "hasSubgraph"; "required": false; "isSignal": true; }; }, { "enterSubgraph": "enterSubgraph"; }, never, never, true, never>;
}

/**
 * Camera transform state shared with consumers.
 *
 * Value: A single source of truth for pan (`x`, `y` in viewport pixels) and
 * `scale`, so the parent can persist or restore the view without reaching into
 * the DOM.
 */
interface GraphCameraState {
    x: number;
    y: number;
    scale: number;
}
/**
 * A rectangle in scene/world coordinates (pre-transform, scale 1).
 *
 * Value: Lets graph-aware callers ask the camera to frame an arbitrary region
 * (e.g. the union box of running nodes) without knowing the current transform.
 */
interface GraphRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
/**
 * Generic pan / zoom / frame camera around arbitrary projected content.
 *
 * PURPOSE: Wrap any SVG or DOM (here, a Mermaid render) in a viewport whose
 * single CSS transform the camera owns — wheel-zoom-to-cursor, drag-pan,
 * fit-all, and imperative `frameRect()` for follow-execution.
 *
 * VALUE: Content-agnostic and dependency-free. It knows nothing about task
 * graphs or Mermaid, so the same camera serves any future graph viewer while
 * the graph-aware logic (node → bounding box, follow rules) lives in the parent.
 */
declare class GraphCameraComponent {
    private readonly destroyRef;
    private readonly viewportRef;
    private readonly sceneRef;
    /** Emits the current transform whenever the camera moves (pan, zoom, frame). */
    readonly cameraChange: _angular_core.OutputEmitterRef<GraphCameraState>;
    /**
     * Emits when the user manually pans or zooms. The parent uses this to pause
     * follow-execution and reveal a re-center control.
     */
    readonly userInteract: _angular_core.OutputEmitterRef<void>;
    private readonly camera;
    protected readonly sceneTransform: _angular_core.Signal<string>;
    protected readonly isPanning: _angular_core.WritableSignal<boolean>;
    protected readonly isAnimating: _angular_core.WritableSignal<boolean>;
    /**
     * True only while the user pans/zooms or a camera move animates.
     *
     * Value: Drives a temporary `will-change: transform`. When idle the hint is
     * removed so the browser re-rasterizes the SVG at the displayed scale (crisp
     * when zoomed in) instead of scaling a cached bitmap (blurry).
     */
    protected readonly isInteracting: _angular_core.Signal<boolean>;
    private pointerStart;
    private cameraAtPointerStart;
    private activePointerId;
    private animationFrameId;
    constructor();
    protected onWheel(event: WheelEvent): void;
    protected onPointerDown(event: PointerEvent): void;
    protected onPointerMove(event: PointerEvent): void;
    protected onPointerUp(event: PointerEvent): void;
    protected zoomIn(): void;
    protected zoomOut(): void;
    /** Reset to the identity transform (top-left, no zoom). */
    reset(): void;
    /** Frame the whole projected content so all of it is visible. */
    fitAll(): void;
    /**
     * Frame a scene-space rectangle, centering it at a comfortable zoom.
     * `maxScale` lets callers cap zoom-in (e.g. a single-node floor for follow).
     */
    frameRect(rect: GraphRect, options?: {
        maxScale?: number;
        animate?: boolean;
    }): void;
    /**
     * Union bounds of a set of on-screen elements, in scene coordinates.
     *
     * Value: The returned rect is in scene space, so it is invariant to the
     * camera's current pan/zoom (even mid-animation). A caller can poll this to
     * detect when projected content (e.g. an async Mermaid render) has finished
     * laying out before moving the camera, avoiding a jump to a stale position.
     */
    measureElementsRect(elements: Iterable<Element>): GraphRect | null;
    /**
     * Frame the union of a set of on-screen elements (e.g. the running nodes).
     *
     * Value: Convenience wrapper over `measureElementsRect` + `frameRect` for
     * callers that don't need the intermediate measurement.
     */
    frameElements(elements: Iterable<Element>, options?: {
        maxScale?: number;
        animate?: boolean;
    }): void;
    private beginPan;
    private zoomFromCenter;
    /** Scale by `factor` while keeping the world point under (px, py) fixed. */
    private zoomAtPoint;
    /** Natural (scale-1) bounds of the projected content, in scene coordinates. */
    private measureContentRect;
    private animateCameraTo;
    private cancelCameraAnimation;
    static ɵfac: _angular_core.ɵɵFactoryDeclaration<GraphCameraComponent, never>;
    static ɵcmp: _angular_core.ɵɵComponentDeclaration<GraphCameraComponent, "app-graph-camera", never, {}, { "cameraChange": "cameraChange"; "userInteract": "userInteract"; }, never, ["*"], true, never>;
}

/**
 * Inspector data seam for the task-graph viewer.
 *
 * PURPOSE: Let the viewer load a node ref's preview (input/output/context/log/
 * artifact) without knowing *how* — the host plugs an implementation in.
 *
 * VALUE: This is the viewer's last runtime tie to any backend, inverted into a
 * token. The daemon provides a loader wrapping its HTTP route; a different
 * project provides its own; a host that omits the inspector provides nothing and
 * the dependency vanishes. Nothing here imports the daemon API — it travels with
 * the library (see `docs/draft/033_task-graph-library-extraction.md`).
 */

/**
 * Everything a loader needs to fetch one ref's preview.
 *
 * VALUE: Carries both the identity (run/node/ref ids) a backend route needs and
 * the resolved `ref` object, so a loader can read either.
 */
interface TaskGraphRefRequest {
    /** Durable run id the ref belongs to. */
    runId: string;
    /** Node id the ref hangs off. */
    nodeId: string;
    /** Which ref group was clicked. */
    refKind: MermaidRuntime.InspectableRefKind;
    /** Id of the specific ref within that group. */
    refId: string;
    /** The resolved ref object (path/summary/label, etc.). */
    ref: MermaidRuntime.InspectableRef;
}
/**
 * Host-supplied loader for node-ref previews.
 *
 * VALUE: A single method, returning an `Observable` or a `Promise`, so hosts can
 * back it with HTTP, fetch, or in-memory data without the viewer caring.
 */
interface TaskGraphRefLoader {
    loadRef(request: TaskGraphRefRequest): Observable<MermaidRuntime.RefContent> | Promise<MermaidRuntime.RefContent>;
}
/**
 * DI token the viewer reads (optionally) to resolve a {@link TaskGraphRefLoader}.
 *
 * VALUE: Optional injection — when no loader is provided, the inspector simply
 * reports that previews are unavailable instead of pulling in a backend.
 */
declare const TASK_GRAPH_REF_LOADER: InjectionToken<TaskGraphRefLoader>;

export { GraphCameraComponent, GraphCanvasComponent, GraphInspectorComponent, MermaidRuntime, TASK_GRAPH_REF_LOADER, TaskGraphComponent };
export type { GraphCameraState, GraphRect, SubgraphNavEvent, TaskGraphNodeDecoration, TaskGraphRefLoader, TaskGraphRefRequest };
