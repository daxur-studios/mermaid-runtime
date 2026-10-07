import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, model, output, signal, untracked, viewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Subscription } from "rxjs";
import mermaid from "mermaid";

import { MermaidRuntime } from "../task-graph-model";
import { GraphCameraComponent, type GraphCameraState, type GraphRect } from "../graph-camera/graph-camera.component";
import { MinimapComponent } from "../minimap/minimap.component";
import { GraphBreadcrumbComponent, type GraphBreadcrumbEntry } from "../graph-breadcrumb/graph-breadcrumb.component";
import { buildMermaidRuntimeConfig, readMermaidRuntimeConfigKey, withNodeLabelLayout, type MermaidRuntimeConfig } from "../mermaid-theme";
import { ensureMermaidConfigured } from "../mermaid-config";
import { hashPreviewStructure, hashPreviewStatuses, resolvePreviewEdges, resolvePreviewStatusClass } from "../graph-preview/graph-preview.utils";
import { buildTopStartOutlinePath, computeOutlinePerimeterLength, offsetPolygonGeometry, offsetRectGeometry, type OffsetShapeGeometry, type ShapePoint } from "./shape-offset.utils";
import { readIconContent, resolveNodeStyle, toToneClass, type IconContent, type ResolvedNodeStyle } from "./node-kind.utils";
import { LayoutStabilityTracker } from "./layout-stability";
import { computeBackgroundPatternLevels, DEFAULT_PATTERN_GAP_PX } from "./background-pattern.utils";
import { raiseGroupLabels } from "./group-label.utils";
import { composeNodeReadout, computeProgressBadgeBox, selectVisibleNodeProgress } from "./node-progress.utils";
import { buildGroupWrapLinks, chooseGroupsPerLine, computeGroupChainLevels, connectedGroupDirection, estimateGroupFootprint, findIndependentGroupIds, viewportAspectChanged, type ArrangementViewport, type GroupFootprint } from "./group-arrangement.utils";
import { routeGroupCrossings, type GroupCrossingPlan } from "./group-edge-routing.utils";
import { createMermaidRenderSandbox, ensureMermaidTemporaryRenderIsolation } from "../mermaid-render-sandbox";
import { GraphBannerComponent } from "../graph-banner/graph-banner.component";
import { pickBannerMessage, type BannerMessage, type HostBannerMessage } from "../graph-banner/banner-message.utils";
import { isGraphOutOfView } from "../graph-camera/camera-visibility.utils";
import { computeFarLayout } from "./far-layout.utils";
import { DEFAULT_FAR_ZOOM_SCALE, nextZoomBand, resolveFarLabel, shortenNodeName, type ZoomBand } from "./far-zoom.utils";
import { formatDurationMs, getLiveNodeTimeMs, measureGroupTimeMs, summariseRun, type RunSettledEvent, type RunState } from "./run-summary.utils";

export type GraphRenderPhase =
  | "idle"
  | "rendering"
  | "settling-sandbox"
  | "swapping"
  | "decorating"
  | "fitting-camera"
  | "stable"
  | "error";

export interface GraphRenderStatus {
  generation: number;
  phase: GraphRenderPhase;
  direction: "TD" | "LR";
  path: readonly string[];
  message?: string;
}

/** A directed graph edge, from one node id to another, with an optional label. */
interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

/** Maps real node ids to Mermaid-safe aliases and back. */
interface GraphAliasMap {
  toAlias: Map<string, string>;
  toReal: Map<string, string>;
}

/**
 * One node's scene-space rect + resolved status class, for a projected minimap.
 *
 * Value: `className` reuses the same status→class resolution as the real graph
 * (`effectiveStatusStyles`), so a host's custom `statusStyles` are respected
 * without the minimap needing its own copy of that map.
 */
export interface MinimapNodeRect {
  id: string;
  rect: GraphRect;
  className: string;
}

/**
 * One drilled-into level on the subgraph navigation stack.
 *
 * Value: Captures the parent node we entered, its breadcrumb label, and the
 * child graph rendered at this level, so the viewer can render and leave any
 * depth without re-resolving the chain.
 */
interface GraphFrame {
  /** Real id (in its parent graph) of the node that was entered. */
  nodeId: string;
  /** Label shown for this level in the breadcrumb. */
  label: string;
  /** The child graph rendered at this level. */
  graph: MermaidRuntime.Graph;
}

/**
 * Camera snapshot captured before a structural Mermaid re-render.
 *
 * VALUE: Lets the canvas keep the previous graph visible while Mermaid renders
 * the next structure in an off-camera sandbox, then restore or recompute the
 * camera only after the finished SVG is swapped into place.
 */
interface PendingStructuralRerender {
  token: number;
  previousCameraState: GraphCameraState;
}

/**
 * Pixel size lock applied to the visible Mermaid host during a structural swap.
 *
 * VALUE: Keeps the camera scene's intrinsic size stable even if the browser
 * briefly paints between removing the old SVG and fully settling on the new one.
 */
interface GraphHostSize {
  width: number;
  height: number;
}

/**
 * Payload emitted when the user enters or leaves a subgraph.
 *
 * Value: Carries the full root→current node-id path so a host can mirror depth
 * into its router/history for browser back/forward.
 */
export interface SubgraphNavEvent {
  /** Node-id path from root to the current level (empty at root). */
  path: string[];
  /** The node drilled into for the current level, or null at root. */
  nodeId: string | null;
  /** The current level's breadcrumb label, or null at root. */
  label: string | null;
}

/**
 * Payload emitted when the user right-clicks a node.
 *
 * Value: Carries the node id plus a position already relative to the canvas
 * viewport, so a host can position its own projected context-menu component
 * with a plain `[style.left.px]`/`[style.top.px]` binding — no coordinate math.
 */
export interface NodeContextMenuEvent {
  /** Real id of the right-clicked node. */
  nodeId: string;
  /** Horizontal offset (px) from the viewport's left edge. */
  x: number;
  /** Vertical offset (px) from the viewport's top edge. */
  y: number;
}

/** Query parameter used to encode the real node id in Mermaid click hrefs. */
const NODE_HREF_PARAM = "node";

/**
 * Built-in status → visual-treatment map, merged under any host `statusStyles`.
 *
 * PURPOSE: Give the five daemon-default states their colours while keeping status
 * styling out of the Mermaid source (applied as DOM classes after render).
 *
 * VALUE: Status changes update the rendered DOM in place — Mermaid never tears
 * down and rebuilds the SVG for a running/done/failed transition — and a host can
 * override or extend this map without forking the component.
 */
const DEFAULT_STATUS_STYLES: MermaidRuntime.StatusStyleMap = {
  running: { className: "running", label: "Running" },
  complete: { className: "done", label: "Complete" },
  failed: { className: "failed", label: "Failed" },
  skipped: { className: "skipped", label: "Skipped" },
};

/**
 * CSS class marking the live "current" focus node.
 *
 * VALUE: Kept separate from status classes so the focus highlight and the
 * execution colour are applied and stripped independently.
 */
const CURRENT_NODE_CLASS = "current";

/**
 * CSS class marking a node the user can drill into (it resolves to a subgraph).
 *
 * VALUE: Lets the stylesheet flag drillable nodes (badge/affordance) without the
 * host having to decorate them.
 */
const HAS_SUBGRAPH_CLASS = "has-subgraph";

/** CSS class for the drillable-node corner badge group (see graph-canvas.component.scss). */
const SUBGRAPH_BADGE_CLASS = "mr-node-subgraph-badge";

/** Radius (px) of the drillable-node corner badge circle, centred on the node shape's top-right corner. */
const SUBGRAPH_BADGE_RADIUS_PX = 7;

/** CSS class for a host-supplied `NodeDecoration.badge` dot (see graph-canvas.component.scss). */
const NODE_BADGE_CLASS = "mr-node-badge";

/** CSS class toggled on a `NodeDecoration.badge` dot when `pulse: true`. */
const NODE_BADGE_PULSE_CLASS = "mr-node-badge--pulse";

/** Radius (px) of a host-supplied `NodeDecoration.badge` dot. */
const NODE_BADGE_RADIUS_PX = 6;

/**
 * Reserved pixel footprint for content injected into a node's label *after*
 * Mermaid's own render (see {@link GraphCanvasComponent.applySubgraphPreviews}).
 *
 * VALUE: A same-sized placeholder is baked into the Mermaid label text
 * *before* render (see {@link GraphCanvasComponent.buildReservedContentHtml}),
 * so Mermaid's `htmlLabels` measurement already accounts for this space — the
 * node box and its connected edges are sized/positioned around it from the
 * very first render. The post-render step then only ever fills an
 * already-reserved box; it never needs Mermaid to resize or reflow anything.
 */
const RESERVED_LABEL_CONTENT_SIZE = {
  "subgraph-preview": { width: 54, height: 54 },
} as const satisfies Record<string, { readonly width: number; readonly height: number }>;

type ReservedLabelContentKind = keyof typeof RESERVED_LABEL_CONTENT_SIZE;

/**
 * Outward offset (px) for the selected/current-node outline ring — the same
 * node shape, redrawn larger, so it reads as a ring around the node rather
 * than a border on it.
 *
 * VALUE: Kept larger than {@link NODE_PROGRESS_TRACE_OFFSET_PX} so the two
 * rings never overlap: shape → progress trace → this outline, outside-in.
 */
const NODE_OUTLINE_OFFSET_PX = 12;

/** CSS class for the selected-node outline ring (thin, white — see graph-canvas.component.scss). */
const SELECTED_OUTLINE_CLASS = "mr-node-outline-selected";

/** CSS class for the current/live-focus-node outline ring (thick, blue — see graph-canvas.component.scss). */
const CURRENT_OUTLINE_CLASS = "mr-node-outline-current";

/**
 * Outward offset (px) for the progress trace — smaller than
 * {@link NODE_OUTLINE_OFFSET_PX} so it sits in the gap between the node's own
 * border and the selected/current outline ring, never touching either.
 */
const NODE_PROGRESS_TRACE_OFFSET_PX = 5;

/** CSS class for the shape-tracing progress ring (see graph-canvas.component.scss). */
const PROGRESS_TRACE_CLASS = "mr-node-progress-trace";

/** CSS class for the small `NN%` badge on a node's bottom-right border (see computeProgressBadgeBox). */
const PROGRESS_BADGE_CLASS = "mr-node-progress-badge";

/**
 * Extra outward offset (px) for each running-child ring beyond the overall ring.
 *
 * VALUE: Separates stacked rings by more than their stroke width, so each
 * stays readable as its own ring.
 */
const NODE_PROGRESS_STACK_OFFSET_PX = 4;

/**
 * Modifier class on the fainter per-running-child rings. Their opacity is the
 * `--mr-progress-child-ring-opacity` token (see graph-canvas.component.scss).
 */
const PROGRESS_TRACE_CHILD_CLASS = "mr-node-progress-trace--child";

/**
 * Marker class applied to every shape-offset overlay element (selected/current
 * outline rings, the progress trace path and its text), in addition to that
 * element's own specific class.
 *
 * PURPOSE: The pre-existing node status/hover/pulse/replay-flash styling
 * (see graph-canvas.component.scss) targets *every* `rect`/`polygon` inside
 * `.node`, because until this overlay mechanism existed there was ever only
 * one such element per node — the node's own shape. These overlays are
 * additional `rect`/`polygon`/`path` siblings, so without an explicit
 * exclusion those `!important` fill/stroke rules also repaint the overlay
 * (e.g. a `.done` node's translucent fill "!important"-overrides the
 * outline's `fill: none`), which — since the overlay is drawn on top and
 * larger than the node — visually reads as the node growing and swallowing
 * its own label text.
 *
 * VALUE: One class, excluded once per generic selector via `:not()`, keeps
 * every current and future overlay immune to node-status styling without
 * hand-listing each overlay class in every status/hover/pulse rule.
 */
const NODE_DECORATION_CLASS = "mr-node-decoration";

/**
 * Class of the empty slot a node label reserves for its icon.
 *
 * VALUE: The slot sits in the Mermaid label so the node is measured with room for
 * the icon; the icon itself is drawn into it after the render, so a host's SVG
 * never passes through the Mermaid source.
 */
const NODE_ICON_CLASS = "mr-node-icon";

/** Data attribute that remembers the text and size a badge was last drawn for, so an unchanged badge is left alone. */
const BADGE_KEY_ATTRIBUTE = "mrReadout";

/** Class of the pill drawn beside a group title to show the group's time. */
const GROUP_TIME_CLASS = "mr-group-time";

/**
 * How often (ms) a running step's time counts up.
 *
 * VALUE: A time shown to one decimal under ten seconds and whole seconds after
 * needs no finer tick, and a slower one would look stuck.
 */
const LIVE_TIME_REFRESH_MS = 1000;

/** Class of the group that holds what a node shows in its middle when the viewer is zoomed far out. */
const NODE_FAR_CLASS = "mr-node-far";

/**
 * CSS custom property on a node's far group holding the font size (scene px) its content was laid out at.
 *
 * VALUE: The stylesheet divides the on-screen target size by this to shrink the content with the zoom.
 */
const FAR_BASE_FONT_PROPERTY = "--mr-far-base-font";

/** Data attribute that remembers what a node's far group was last built from, so an unchanged one is left alone. */
const FAR_KEY_ATTRIBUTE = "mrFarKey";

/** Text between the parts of a far group's content key; a control character no title or chip contains. */
const FAR_KEY_SEPARATOR = "\u0001";

/** Gap (px, scene units) between a group title's pill and its time pill. */
const GROUP_TIME_GAP_PX = 6;

/** Horizontal padding (px, scene units) inside the group time pill. */
const GROUP_TIME_PADDING_X_PX = 6;

/** Group time text size as a share of the title pill's height. */
const GROUP_TIME_FONT_RATIO = 0.62;

/** Estimated width of one character of group time text, as a share of its font size (tabular digits). */
const GROUP_TIME_CHAR_WIDTH_RATIO = 0.6;

/** Class of the pill that shows a node kind's chip text. */
const NODE_CHIP_CLASS = "mr-node-chip";

/** Class Angular Material's icon font uses, added when an icon is a ligature name. */
const MATERIAL_ICON_FONT_CLASS = "material-icons";

/** Data attribute that remembers which icon string a slot already shows. */
const NODE_ICON_KEY_ATTRIBUTE = "mrIcon";

/**
 * Zoom cap when follow-execution frames the running nodes.
 *
 * Value: Keeps the camera from snapping uncomfortably close to one or two
 * nodes — "not too far, not too close" — while `frameRect` padding handles the
 * lower bound for larger running sets.
 */
const FOLLOW_MAX_ZOOM = 1.4;

/**
 * Default camera snapshot used when the child camera is not yet available.
 *
 * VALUE: Structural render bookkeeping always has a camera state to restore,
 * even during very early initialization.
 */
const DEFAULT_CAMERA_STATE: GraphCameraState = { x: 0, y: 0, scale: 1 };

/**
 * How far (px) the pointer may travel between press and release and still count
 * as a click.
 *
 * VALUE: A pan drag ends in a click on the background; without this gate every
 * pan would clear the selection. Matches the camera's own pan-start threshold
 * in spirit, with a little slack for a shaky click.
 */
const CLICK_MAX_TRAVEL_PX = 5;

/**
 * Elements a background click must ignore, because they are controls or node
 * links rather than empty graph space.
 */
const BACKGROUND_CLICK_IGNORE_SELECTOR = "a, button, input, select, textarea, mr-minimap, mr-graph-banner, .graph-canvas__run-pill";

/**
 * How long (ms) the "run complete" or "run failed" banner stays before it slides away.
 *
 * VALUE: Long enough to read the counts and the time, short enough not to sit
 * over the graph. The pill stays afterwards.
 */
const RUN_RESULT_BANNER_MS = 6000;

/**
 * How long (ms) the graph must stay out of view before "Back to graph" appears.
 *
 * VALUE: A camera animation or a quick pan can pass through an empty view; this
 * keeps the prompt for a viewer who is really lost.
 */
const OUT_OF_VIEW_PROMPT_DELAY_MS = 500;

/**
 * Class name applied to the hidden Mermaid render sandbox.
 *
 * VALUE: MutationObserver callbacks can cheaply ignore sandbox-only DOM churn
 * while the visible graph continues to react to real swaps.
 */
const RENDER_SANDBOX_CLASS = "graph-canvas__render-sandbox";

/**
 * Prefix for Mermaid render ids created by the main graph canvas.
 *
 * VALUE: Keeps generated SVG ids unique across multiple canvas instances on the
 * same page while still being easy to correlate in the DOM.
 */
const MAIN_GRAPH_RENDER_ID_PREFIX = "mr-main-graph";

/**
 * Number of consecutive animation frames whose SVG bounds must match before the
 * layout is considered settled.
 *
 * VALUE: One frame is too eager for Chromium's `foreignObject` label layout;
 * requiring two equal samples avoids fitting/restoring against a transient box.
 */
const STRUCTURAL_LAYOUT_STABLE_FRAME_COUNT = 2;

/**
 * Maximum number of animation frames spent waiting for a structural Mermaid
 * render to settle.
 *
 * VALUE: Prevents a broken SVG/layout edge case from leaving the camera pinned
 * at identity forever.
 */
const STRUCTURAL_LAYOUT_MAX_WAIT_FRAMES = 24;

/**
 * Tolerance (px) for considering two successive SVG bounds equal.
 *
 * VALUE: Ignores sub-pixel jitter between animation frames while still catching
 * real label-size changes.
 */
const STRUCTURAL_LAYOUT_BOUNDS_EPSILON_PX = 0.5;

/** Running counter so each canvas instance gets a unique Mermaid render-id prefix. */
let graphCanvasInstanceCounter = 0;

/**
 * Reads a resolved CSS length custom property in px, or `null` when it is
 * missing or not a plain px value (e.g. a host used `rem`).
 */
function readCssPxProperty(element: Element, propertyName: string): number | null {
  const raw = getComputedStyle(element).getPropertyValue(propertyName).trim();
  if (!raw.endsWith("px")) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Lowest valid percentage shown in a task graph node progress bar.
 *
 * PURPOSE: Clamp malformed task-run node progress before it reaches Mermaid.
 *
 * VALUE: Progress bars never render negative values.
 */
const TASK_GRAPH_PROGRESS_MIN_PERCENT = 0;

/**
 * Highest valid percentage shown in a task graph node progress bar.
 *
 * PURPOSE: Keep task-run node progress inside the browser progress element's
 * expected range.
 *
 * VALUE: Node labels and inspector bars share the same 0-100 scale.
 */
const TASK_GRAPH_PROGRESS_MAX_PERCENT = 100;

// Subgraph preview constants removed in favor of GraphPreviewSimpleComponent

/**
 * Default Mermaid render configuration for the task graph.
 *
 * Value: Dark remains the default for backwards compatibility; hosts can pass
 * `mermaidTheme` or `mermaidConfig` to align Mermaid output with their app theme.
 */
const DEFAULT_MERMAID_OPTIONS: MermaidRuntimeConfig = {
  ...buildMermaidRuntimeConfig("dark", false),
  securityLevel: "loose",
  flowchart: {
    // The camera owns sizing/zoom. `useMaxWidth: false` gives the SVG a fixed
    // intrinsic size so a re-render (status change) never re-fits it to the
    // container and fights the current zoom — text stays the right size.
    useMaxWidth: false,
    htmlLabels: true,
    curve: "basis",
  },
};

/**
 * Interactive Mermaid graph canvas — the rendering + interaction core.
 *
 * PURPOSE: Render any `MermaidRuntime.Node[]` (+ transitions) as a status-coloured,
 * clickable flowchart inside a pan/zoom camera, with progress bars, follow,
 * nested-subgraph navigation, and optional node groups (clusters, not to be
 * confused with subgraph drill-down — see {@link MermaidRuntime.NodeGroup}). It
 * owns selection/navigation state and exposes it, but renders no inspector or
 * toolbar chrome itself.
 *
 * VALUE: The reusable product surface. A host projects its own chrome through the
 * `[overlay]` and `[detail]` slots and binds it to the canvas's exposed signals
 * (e.g. `selectedNode`, `selectedNodeHasSubgraph`, `contextMenuTarget`) via a
 * template ref — so every project arranges its own layout while the interaction
 * behaviour is shared. A right-click on a node follows the same pattern: the
 * canvas resolves and exposes the target, the host supplies and positions its own
 * standalone context-menu component into `[overlay]`.
 */
/**
 * Maximum time difference (ms) allowed between parallel execution parent node completions.
 *
 * VALUE: Ensures concurrent parent nodes in a parallel AND-join are both treated as triggering
 * the child node, while stale parents from older loop iterations are correctly filtered out.
 */
const PARALLEL_JOIN_THRESHOLD_MS = 3000;

/**
 * Duration (ms) that the node border pulse class remains active.
 *
 * VALUE: Matches the CSS transition duration so the class is removed exactly as the
 * visual animation completes.
 */
const NODE_PULSE_DURATION_MS = 500;

/**
 * Duration (ms) that the connection edge marching-ants pulse class remains active.
 *
 * VALUE: Matches the transition and animation timings so the edge settles into its
 * solid color state exactly as the pulse completes.
 */
const EDGE_PULSE_DURATION_MS = 1000;

/**
 * Duration (ms) that a replay node flash remains active.
 *
 * VALUE: Matches the one-shot replay flash CSS so stale replay classes are removed
 * promptly before the next event paints.
 */
const REPLAY_NODE_FLASH_DURATION_MS = 560;

/**
 * Duration (ms) that a replay edge trace remains active.
 *
 * VALUE: Keeps the transient SVG overlay visible only for the active replay event.
 */
const REPLAY_EDGE_TRACE_DURATION_MS = 720;

/**
 * Delay (ms) before clearing replay event visuals.
 *
 * VALUE: Uses the longer replay animation duration so node and edge effects can
 * share one cleanup timer.
 */
const REPLAY_EVENT_CLEAR_DELAY_MS = REPLAY_EDGE_TRACE_DURATION_MS;

/**
 * SVG namespace used for replay overlay paths.
 *
 * VALUE: Ensures injected replay traces are real SVG paths, not HTML elements.
 */
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * PathLength value assigned to replay traces.
 *
 * VALUE: Normalizes every cloned Mermaid edge to a 0-100 animation scale,
 * regardless of its physical SVG length.
 */
const REPLAY_EDGE_TRACE_PATH_LENGTH = "100";

/**
 * CSS class for the transient replay overlay group.
 *
 * VALUE: Keeps replay SVG nodes identifiable for cleanup and mutation filtering.
 */
const REPLAY_ANIMATION_OVERLAY_CLASS = "mr-replay-animation-overlay-group";

/**
 * CSS class for the transient edge path drawn during timeline replay.
 *
 * VALUE: Separates replay motion from Mermaid's real edge path so the base line
 * styling remains stable.
 */
const REPLAY_EDGE_TRACE_CLASS = "mr-replay-edge-trace";

/**
 * CSS class for the one-shot node flash drawn during timeline replay.
 *
 * VALUE: Highlights only the current replay event's node instead of animating the
 * whole completed graph.
 */
const REPLAY_NODE_FLASH_CLASS = "mr-replay-node-flash";

/**
 * Minimum segment count for graph-execution edge ids.
 *
 * VALUE: Documents the positional `kind:from:to[:label]` edge id format shared
 * with the daemon graph execution builder.
 */
const GRAPH_EDGE_ID_MIN_PARTS = 3;

/**
 * Index of the source node id inside `kind:from:to[:label]` edge ids.
 *
 * VALUE: Keeps replay edge parsing explicit and resilient to labels containing
 * extra `:` characters after the target id.
 */
const GRAPH_EDGE_ID_FROM_INDEX = 1;

/**
 * Index of the target node id inside `kind:from:to[:label]` edge ids.
 *
 * VALUE: Keeps replay edge parsing explicit and resilient to labels containing
 * extra `:` characters after the target id.
 */
const GRAPH_EDGE_ID_TO_INDEX = 2;

@Component({
  selector: "mr-graph-canvas",
  templateUrl: "./graph-canvas.component.html",
  styleUrl: "./graph-canvas.component.scss",
  host: {
    class: "mr-graph-canvas",
    "[attr.data-render-phase]": "renderStatus().phase",
    "[attr.data-render-generation]": "renderStatus().generation",
    "[attr.data-render-message]": "renderStatus().message ?? null",
    "[attr.data-zoom-band]": "zoomBand()",
  },
  imports: [CommonModule, GraphCameraComponent, MinimapComponent, GraphBreadcrumbComponent, GraphBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphCanvasComponent implements AfterViewInit {
  /** Observable structural-render lifecycle for hosts and browser regression tests. */
  readonly renderStatus = signal<GraphRenderStatus>({
    generation: 0,
    phase: "idle",
    direction: "TD",
    path: [],
  });

  /** Emits after the newest visible graph and camera have survived a painted frame. */
  readonly renderSettled = output<GraphRenderStatus>();

  readonly minimapContentRect = signal<GraphRect | null>(null);
  readonly minimapNodes = signal<MinimapNodeRect[]>([]);
  private readonly viewportSize = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  readonly minimapViewportRect = computed<GraphRect | null>(() => {
    const cameraComp = this.cameraRef();
    if (!cameraComp) return null;
    const { x, y, scale } = cameraComp.cameraState();
    const size = this.viewportSize();
    if (scale === 0 || size.width === 0 || size.height === 0) return null;
    return {
      x: -x / scale,
      y: -y / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
  });

  private readonly hostElement = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cameraRef = viewChild.required(GraphCameraComponent);
  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>("viewport");
  private readonly mermaidHostRef = viewChild.required<ElementRef<HTMLElement>>("mermaidHost");
  private readonly viewReady = signal(false);
  private readonly instanceId = `${MAIN_GRAPH_RENDER_ID_PREFIX}-${graphCanvasInstanceCounter++}`;
  private readonly renderSandboxHost: HTMLDivElement;

  protected readonly cameraState = computed(() => {
    const cameraComp = this.cameraRef();
    return cameraComp ? cameraComp.cameraState() : { x: 0, y: 0, scale: 1.0 };
  });

  /**
   * World-space spacing (px) of the background pattern, read from the resolved
   * `--mr-pattern-gap` once the view exists, so a host's `--mr-pattern-size`
   * switches levels at the right zoom.
   */
  private readonly backgroundPatternGapPx = signal(DEFAULT_PATTERN_GAP_PX);

  /**
   * On-screen spacing and fade of the fine and coarse background levels at the
   * current zoom.
   *
   * VALUE: The fades multiply the base pattern opacity rather than replacing
   * it, so host-tuned opacities still adapt instead of flooding the canvas.
   */
  protected readonly backgroundPatternLevels = computed(() =>
    computeBackgroundPatternLevels(this.backgroundPatternGapPx(), this.cameraState().scale),
  );

  /** Execution nodes to render. The host owns their lifecycle and status. */
  readonly nodes = input.required<MermaidRuntime.Node[]>();

  /**
   * Runtime/story edges. When omitted, edges fall back to per-node
   * `transitions`, then to `dependencies` so a dependency-only graph still draws.
   */
  readonly transitions = input<MermaidRuntime.Transition[] | null>(null);

  /** Optional node groups for the root graph (see {@link MermaidRuntime.NodeGroup}). */
  readonly groups = input<MermaidRuntime.NodeGroup[] | null>(null);

  /**
   * How independent groups are packed (see {@link MermaidRuntime.GroupArrangement}).
   *
   * VALUE: `'auto'` fits parallel groups into a viewport-shaped grid instead of
   * one long strip; `'mermaid'` restores the legacy placement.
   */
  readonly groupArrangement = input<MermaidRuntime.GroupArrangement>("auto");

  /**
   * Which way the steps inside each group of a chain run, from one group to the
   * next (see {@link MermaidRuntime.GroupFlow}).
   *
   * VALUE: `'alternate'` (default) makes a chain of groups a snake with short
   * straight hand-offs; `'same'` keeps every row reading the same way.
   */
  readonly groupFlow = input<MermaidRuntime.GroupFlow>("alternate");

  /** Currently selected node id (highlight only; host owns the value). */
  readonly selectedNodeId = input<string | null>(null);

  /** The node to mark as the live "current" focus, if any. */
  readonly currentNodeId = input<string | null>(null);

  /**
   * Whether the graph is currently showing a timeline replay.
   *
   * VALUE: Lets the canvas suppress live execution pulses while the replay layer
   * owns one-shot node and edge motion.
   */
  readonly replayActive = input<boolean>(false);

  /**
   * Current timeline event to animate during replay.
   *
   * VALUE: Drives sequential replay visuals from the recorded execution events,
   * including loops and parallel branches, instead of guessing from final node
   * state.
   */
  readonly replayEvent = input<MermaidRuntime.ExecutionEvent | null>(null);

  /** Per-node display overrides, keyed by real node id. */
  readonly decorations = input<Record<string, MermaidRuntime.NodeDecoration>>({});

  /**
   * How each kind of step looks, keyed by the node's `type`.
   *
   * VALUE: A host describes "database step" or "assertion" once (shape, icon, chip,
   * tone) instead of decorating every node. A node's own {@link decorations} entry
   * still wins, field by field.
   */
  readonly nodeKinds = input<Record<string, MermaidRuntime.NodeKindStyle>>({});

  /**
   * Status → visual-treatment overrides, merged over {@link DEFAULT_STATUS_STYLES}.
   *
   * VALUE: A host defines its own status vocabulary/colours (and can add states
   * beyond the built-in five) without forking the component.
   */
  readonly statusStyles = input<MermaidRuntime.StatusStyleMap>({});

  /** Contrast family used when the runtime builds its default Mermaid config. */
  readonly mermaidTheme = input<MermaidRuntime.MermaidThemeId>("dark");

  /** Layout direction of the graph flow ('TD' or 'LR'). */
  readonly direction = model<"TD" | "LR">("TD");

  /**
   * Full Mermaid render config override for hosts that need custom theme variables.
   *
   * VALUE: Lets advanced hosts provide `theme: 'base'` and `themeVariables` while
   * simple hosts use `mermaidTheme` only.
   */
  readonly mermaidConfig = input<MermaidRuntimeConfig | null>(null);

  /**
   * Viewport background treatment behind the rendered graph.
   *
   * VALUE: Dots by default; grid lines, both, none, or a host's own CSS
   * background. Built-in patterns keep the same on-screen density at any zoom.
   */
  readonly backgroundEffect = input<MermaidRuntime.GraphBackgroundEffect>("dots");

  /**
   * Which nodes draw their progress ring.
   *
   * VALUE: By default finished and 0% nodes draw none, so rings mark only
   * work in progress; `always` restores the older draw-everything behaviour.
   */
  readonly progressRings = input<MermaidRuntime.ProgressRingVisibility>("active");

  /**
   * Whether a node also draws one fainter ring per running child node
   * (`activeChildNodeProgresses`), outside its overall ring.
   *
   * VALUE: Hosts that find stacked rings busy can keep just the overall ring.
   */
  readonly childProgressRings = input<boolean>(true);

  /** Breadcrumb label for the root (top-level) graph. */
  readonly rootLabel = input<string>("Main");

  /** Whether to render the breadcrumb overlay while inside a subgraph. */
  readonly showBreadcrumb = input<boolean>(true);

  /** Whether the breadcrumb renders in the canvas corner or is exposed for host chrome. */
  readonly breadcrumbPlacement = input<"built-in" | "host">("built-in");

  /**
   * Whether drillable nodes show a small, static thumbnail of their child graph.
   *
   * VALUE: A purely decorative hint that a node contains a subgraph (and its
   * rough shape); set false to drop it entirely with no other behaviour change.
   */
  readonly showSubgraphPreview = input<boolean>(true);

  /** Whether to render the corner minimap overlay. */
  readonly showMinimap = input<boolean>(true);

  /**
   * Whether the minimap renders in its own built-in corner, or is suppressed so a host can
   * render `<mr-minimap>` itself (bound to `minimapContentRect`/`minimapViewportRect`/
   * `minimapNodes`/`centerOnPoint`) inside its own shared overlay layer instead.
   *
   * VALUE: lets a host app relocate the minimap without the library needing to know anything
   * about where a host's layout system wants it placed.
   */
  readonly minimapPlacement = input<"built-in" | "host">("built-in");

  /**
   * Whether the camera's zoom/pan control cluster renders in its own built-in corner, or is
   * suppressed so a host can render its own controls (calling `zoomIn()`/`zoomOut()`/
   * `fitAll()`/`resetCamera()` on this component) inside its own shared overlay layer instead.
   *
   * VALUE: Same seam as `minimapPlacement`, applied to the other piece of built-in viewport
   * chrome that a host may need to relocate to avoid colliding with a relocated minimap.
   */
  readonly cameraControlsPlacement = input<"built-in" | "host">("built-in");

  /**
   * Whether a host has projected `[detail]` chrome — toggles the side column.
   *
   * VALUE: Lets the canvas reserve layout space for a projected inspector without
   * knowing what it is.
   */
  readonly showDetail = input<boolean>(false);

  /**
   * Resolves a node's child graph. When omitted, the node's inline
   * `subgraph` is used.
   *
   * VALUE: Lets daemon-style hosts turn a `subgraphId` into a `Graph` lazily,
   * while inline-graph hosts need supply nothing.
   */
  readonly subgraphResolver = input<((node: MermaidRuntime.Node) => MermaidRuntime.Graph | null) | null>(null);

  /**
   * Externally-controlled subgraph path (root node ids drilled into).
   *
   * VALUE: The history seam — a host drives this from its router so browser
   * back/forward can restore the viewer's depth; the viewer reconciles its stack
   * to match and emits {@link graphPathChange} when the user navigates.
   */
  readonly path = input<readonly string[]>([]);

  /**
   * When true, the camera keeps the running ("green") nodes framed as the run
   * progresses. A manual pan/zoom pauses it until the host re-enables follow or
   * the user clicks the re-center chip.
   */
  readonly followExecution = input<boolean>(false);

  /** Emits the real node id when a node is clicked. */
  readonly nodeSelected = output<string>();

  /**
   * Emits when a click on the empty background clears the selection. A host that
   * owns `selectedNodeId` should set it back to null here.
   */
  readonly selectionCleared = output<void>();

  /** Emits the target node id and viewport-relative position on a node right-click. */
  readonly nodeContextMenu = output<NodeContextMenuEvent>();

  /** Emits when the user drills into a node's subgraph. */
  readonly subgraphEntered = output<SubgraphNavEvent>();

  /** Emits when the user leaves a subgraph (one or more levels up). */
  readonly subgraphLeft = output<SubgraphNavEvent>();

  /**
   * Emits the new root→current node-id path whenever the user enters or leaves a
   * subgraph.
   *
   * VALUE: The single output a host wires to its history (push on change, restore
   * via the {@link path} input on back/forward).
   */
  readonly graphPathChange = output<string[]>();

  /**
   * Emits once when the run finishes: every step complete or skipped, or a step
   * failed with none still running.
   *
   * VALUE: Hosts react (notify, archive, start the next run) without watching the
   * node list. It does not fire for a run that is already finished when the graph
   * first appears.
   */
  readonly runSettled = output<RunSettledEvent>();

  /**
   * A message of the host's own for the top-centre banner.
   *
   * VALUE: Shares the slot with the run result and the "back to graph" prompt,
   * which both outrank it while they apply.
   */
  readonly banner = input<HostBannerMessage | null>(null);

  /**
   * Shows each step's time in the badge on its bottom-right border (beside its percentage
   * while it runs) and each group's time beside its title.
   *
   * VALUE: Off by default. The times come from the steps' `durationMs`, or `startedAt`
   * and `endedAt`; a step that has not started shows nothing, a running step with a
   * `startedAt` counts up. Turning it on or off redraws no layout: badges are overlays.
   */
  readonly showTimes = input<boolean>(false);

  /**
   * Zoom (scale) below which each node swaps its small text for something readable far
   * out: its badge (percentage and time) grows, and a node with no badge shows a short
   * form of its name. Null turns this off.
   *
   * VALUE: A far-out overview of hundreds of steps stays readable: it shows how long
   * each took, or how far along it is, instead of text too small to read.
   */
  readonly farZoomScale = input<number | null>(DEFAULT_FAR_ZOOM_SCALE);

  /**
   * Text for the middle of a node when zoomed far out. Return a string to use it (an empty
   * string shows nothing), or null to use the default (nothing when the node's badge
   * already shows a percentage or time, otherwise a short form of its title).
   */
  readonly farLabel = input<((node: MermaidRuntime.Node) => string | null | undefined) | null>(null);

  /** Whether the viewer is close enough for full node text (`near`) or far enough for one short line (`far`). */
  protected readonly zoomBand = signal<ZoomBand>("near");

  protected readonly mermaidOptions = computed<MermaidRuntimeConfig>(() => withNodeLabelLayout(this.mermaidConfig() ?? buildMermaidRuntimeConfig(this.mermaidTheme(), DEFAULT_MERMAID_OPTIONS.startOnLoad ?? false)));

  private readonly internalSelectedNodeId = signal<string | null>(null);

  /** Where the last pointer press landed, so a click that ends a drag can be told from a real click. */
  private lastPointerDown: { x: number; y: number } | null = null;

  /**
   * Subgraph navigation stack. Empty = root graph; each frame is one level the
   * user has drilled into. The top frame decides what the viewer renders.
   */
  private readonly graphStack = signal<GraphFrame[]>([]);

  /**
   * Resolve the visible level from current host data, not the snapshot captured
   * on entry. Immutable run updates must reach an already-open subgraph without
   * rebuilding navigation or resetting the camera. Resolver reads remain tracked.
   */
  private readonly activeGraph = computed<MermaidRuntime.Graph>(() => {
    let graph: MermaidRuntime.Graph = { nodes: this.nodes(), transitions: this.transitions(), groups: this.groups() };
    for (const frame of this.graphStack()) {
      const node = graph.nodes.find(candidate => candidate.id === frame.nodeId);
      const child = node ? this.resolveSubgraph(node) : null;
      if (!child) break;
      graph = child;
    }
    return graph;
  });

  private readonly activeNodes = computed(() => this.activeGraph().nodes);
  private readonly activeTransitions = computed(() => this.activeGraph().transitions ?? null);
  private readonly activeGroups = computed(() => this.activeGraph().groups ?? null);

  /** True while inside a subgraph (the stack is non-empty). */
  protected readonly inSubgraph = computed(() => this.graphStack().length > 0);

  /** Current camera zoom scale. */
  protected readonly currentZoom = computed(() => {
    const cameraComp = this.cameraRef();
    return cameraComp ? cameraComp.cameraState().scale : 1.0;
  });

  /** Breadcrumb trail (root + each entered level); empty at the root graph. */
  readonly breadcrumb = computed<GraphBreadcrumbEntry[]>(() => {
    const stack = this.graphStack();
    if (stack.length === 0) return [];
    const crumbs: GraphBreadcrumbEntry[] = [{ label: this.rootLabel(), depth: 0 }];
    stack.forEach((frame, index) => crumbs.push({ label: frame.label, depth: index + 1 }));
    return crumbs;
  });

  /** Built-in status styles with any host `statusStyles` merged over them. */
  private readonly effectiveStatusStyles = computed<MermaidRuntime.StatusStyleMap>(() => ({
    ...DEFAULT_STATUS_STYLES,
    ...this.statusStyles(),
  }));

  /** Every CSS class the status map can apply — stripped before re-applying. */
  private readonly statusClassNames = computed<string[]>(() => {
    const names = new Set<string>();
    for (const style of Object.values(this.effectiveStatusStyles())) {
      if (style?.className) names.add(style.className);
    }
    return [...names];
  });

  private readonly aliasMap = computed<GraphAliasMap>(() => this.buildAliasMap(this.activeNodes()));

  /** Mermaid-safe aliases for the active groups, namespaced apart from node aliases. */
  private readonly groupAliasMap = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    (this.activeGroups() ?? []).forEach((group, index) => map.set(group.id, `tgGrp${index}`));
    return map;
  });

  /** Position of each active group along its chain of groups (see `computeGroupChainLevels`). */
  private readonly groupChainLevels = computed<Map<string, number>>(() => computeGroupChainLevels(this.activeGroups() ?? [], this.resolveEdges()));

  /**
   * Viewport size the automatic group arrangement was last chosen for.
   *
   * VALUE: Only follows {@link viewportSize} when its aspect ratio changes
   * substantially (see `viewportAspectChanged`), so ordinary resizes never
   * trigger a Mermaid re-layout.
   */
  private readonly arrangementViewport = signal<ArrangementViewport | null>(null);

  /**
   * Measured cluster sizes of previously rendered independent groups, keyed by
   * {@link groupFootprintKey}.
   *
   * VALUE: The first render wraps from an estimate; real sizes then refine the
   * choice. A group's own box doesn't depend on how groups are wrapped, so one
   * measurement per group settles it — no re-render loop.
   */
  private readonly groupFootprints = signal<ReadonlyMap<string, GroupFootprint>>(new Map());

  /**
   * Active-level groups free to be arranged: no edges leaving them, and at
   * least one rendered member (empty groups emit no Mermaid cluster).
   */
  private readonly arrangeableGroups = computed<MermaidRuntime.NodeGroup[]>(() => {
    const groups = this.activeGroups() ?? [];
    const independentIds = findIndependentGroupIds(groups, this.resolveEdges());
    const { toAlias } = this.aliasMap();
    return groups.filter((group) => independentIds.has(group.id) && group.nodeIds.some((nodeId) => toAlias.has(nodeId)));
  });

  /**
   * Groups placed per line for the active level, or null when groups are left
   * to Mermaid (legacy mode, or fewer than two arrangeable groups).
   */
  private readonly groupsPerLine = computed<number | null>(() => {
    const arrangement = this.groupArrangement();
    if (arrangement === "mermaid") return null;
    const independent = this.arrangeableGroups();
    if (independent.length < 2) return null;
    if (arrangement !== "auto") return Math.max(1, Math.floor(arrangement.groupsPerLine));

    const flow = this.direction();
    const measured = this.groupFootprints();
    const footprints = independent.map((group) => measured.get(this.groupFootprintKey(group, flow)) ?? estimateGroupFootprint(group.nodeIds.length, flow));
    return chooseGroupsPerLine(footprints, flow, this.arrangementViewport() ?? { width: 0, height: 0 });
  });

  protected readonly mermaidSource = computed(() => this.buildGraph());

  protected readonly effectiveSelectedNodeId = computed(() => {
    const nodes = this.activeNodes();
    return this.selectedNodeId() ?? this.internalSelectedNodeId() ?? this.currentNodeId() ?? nodes.find((node) => node.status === "running")?.id ?? nodes[0]?.id ?? null;
  });

  /**
   * The node the white selection ring is drawn on — only ever a node somebody
   * picked (the host's `selectedNodeId`, or a click).
   *
   * PURPOSE: Keep "selected" and "currently running" visually distinct.
   *
   * VALUE: {@link effectiveSelectedNodeId} falls back to the running or first
   * node so the inspector always has something to show; ringing that fallback made
   * every newly active step look as if it had just been selected.
   */
  protected readonly highlightedNodeId = computed(() => this.selectedNodeId() ?? this.internalSelectedNodeId());

  /** The resolved selected node — exposed so projected chrome can render its detail. */
  readonly selectedNode = computed(() => {
    const selectedId = this.effectiveSelectedNodeId();
    if (!selectedId) return null;
    return this.activeNodes().find((node) => node.id === selectedId) ?? null;
  });

  /** Whether the selected node can be drilled into — exposed for the projected inspector. */
  readonly selectedNodeHasSubgraph = computed(() => {
    const node = this.selectedNode();
    return !!node && !!this.resolveSubgraph(node);
  });

  private readonly internalContextMenuTarget = signal<MermaidRuntime.Node | null>(null);

  /**
   * The node last right-clicked, or null once dismissed.
   *
   * VALUE: Lets a host bind its projected context-menu component straight to the
   * target node via the `#canvas` template ref (`canvas.contextMenuTarget()`),
   * the same idiom used for `selectedNode` — no separate lookup needed.
   */
  readonly contextMenuTarget = this.internalContextMenuTarget.asReadonly();

  /** Ids of the currently running nodes, joined — drives follow re-framing. */
  private readonly runningKey = computed(() =>
    this.activeNodes()
      .filter((node) => node.status === "running")
      .map((node) => node.id)
      .join(","),
  );

  /** Joined `id:status` pairs — drives live status-class application (no re-render). */
  private readonly statusKey = computed(() =>
    this.activeNodes()
      .map((node) => `${node.id}:${node.status}`)
      .join(","),
  );

  /** Joined node progress values — drives live progress-bar DOM updates. */
  private readonly progressKey = computed(() => {
    const nodeKeys = this.activeNodes()
      .map((node) => {
        const childProgressesStr = node.activeChildNodeProgresses ? node.activeChildNodeProgresses.join("|") : "";
        return `${node.id}:${node.status}:${node.progressPercent ?? ""}:${node.progressLabel ?? ""}:${childProgressesStr}`;
      })
      .join(",");
    return `${this.progressRings()}:${this.childProgressRings()}:${nodeKeys}`;
  });

  /** Follow temporarily suspended after a manual pan/zoom. */
  protected readonly followPaused = signal(false);

  /** Follow is on and not paused — the camera should track the running nodes. */
  protected readonly followActive = computed(() => this.followExecution() && !this.followPaused());

  /** Counts, state and time of the whole run, read from the root graph's steps. */
  protected readonly runSummary = computed(() => summariseRun(this.nodes()));

  /** True for a few seconds after a run settles, so its result shows in the banner. */
  protected readonly runResultVisible = signal(false);

  /**
   * Little or none of the graph is on screen.
   *
   * VALUE: Computed from the camera and the cached content rectangle, so panning
   * never measures the DOM.
   */
  private readonly graphOutOfView = computed(() => {
    const content = this.minimapContentRect();
    if (!content) return false;
    return isGraphOutOfView(content, this.cameraState(), this.viewportSize());
  });

  /**
   * {@link graphOutOfView}, held back by {@link OUT_OF_VIEW_PROMPT_DELAY_MS}, so a
   * camera animation that passes through an empty view does not flash the prompt.
   */
  private readonly outOfViewPrompt = signal(false);

  /** The one message the top-centre banner shows now, or null. */
  protected readonly bannerMessage = computed<BannerMessage | null>(() =>
    pickBannerMessage({
      run: this.runSummary(),
      runResultVisible: this.runResultVisible(),
      hostMessage: this.banner(),
      outOfView: this.outOfViewPrompt(),
      followPaused: this.followExecution() && this.followPaused(),
    }),
  );

  /** The settled run, kept as a small pill after the banner has gone; null while a run is in progress. */
  protected readonly runPill = computed(() => {
    const summary = this.runSummary();
    if (summary.state !== "complete" && summary.state !== "failed") return null;
    const time = formatDurationMs(summary.durationMs);
    const label = summary.state === "failed" ? `Failed · ${summary.failed} failed` : `Complete · ${summary.complete}/${summary.total}`;
    return { state: summary.state, label: time ? `${label} · ${time}` : label };
  });

  private previousRunState: RunState | null = null;
  private liveTimeTimer: ReturnType<typeof setInterval> | null = null;
  private runResultTimer: ReturnType<typeof setTimeout> | null = null;
  private outOfViewTimer: ReturnType<typeof setTimeout> | null = null;

  /** True once the first Mermaid node has rendered, so we fit the view once. */
  private hasFitInitialView = false;

  private readonly subgraphStructureHashes = new Map<string, string>();

  private readonly canvasFocusSubscription = new Subscription();

  /** Last seen `followExecution` value, to detect off→on (which resumes follow). */
  private lastFollowOn = false;

  private followFramePending = false;

  /** Last structural Mermaid source rendered into the canvas. */
  private lastStructureRenderKey: string | null = null;

  /** Active structural re-render waiting for its post-render layout to settle. */
  private pendingStructuralRerender: PendingStructuralRerender | null = null;

  /** Pending animation frame for structural-layout settling. */
  private structuralLayoutSettleFrame: number | null = null;

  /** Monotonic token for invalidating stale structural-layout settle loops. */
  private structuralLayoutToken = 0;

  /** Current in-flight main-graph Mermaid render token. */
  private mainGraphRenderToken = 0;

  /**
   * Track previous status of each node.
   *
   * VALUE: Detects real-time state transitions so the component only pulses nodes
   * that changed state while the user is actively watching.
   */
  private readonly previousStatuses = new Map<string, string>();

  /** Last replay event key animated by the canvas. */
  private lastReplayEventKey: string | null = null;

  /** Pending animation frame used to wait for Mermaid DOM updates before replay paint. */
  private replayAnimationFrame: number | null = null;

  /** Cleanup timer for the current replay node/edge visual. */
  private replayAnimationTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const host = this.hostElement.nativeElement;
    this.renderSandboxHost = createMermaidRenderSandbox(
      host,
      `graph-canvas__mermaid mermaid ${RENDER_SANDBOX_CLASS}`,
    );
    const clickListener = (event: MouseEvent) => this.handleChartClick(event);
    const dblClickListener = (event: MouseEvent) => this.handleChartDblClick(event);
    const contextMenuListener = (event: MouseEvent) => this.handleChartContextMenu(event);
    const pointerDownListener = (event: PointerEvent) => {
      this.lastPointerDown = { x: event.clientX, y: event.clientY };
    };
    const chartObserver = new MutationObserver((mutations) => {
      const hasRealMutations = mutations.some((m) => {
        const element = m.target instanceof Element ? m.target : m.target.parentElement;
        if (element) {
          if (element.closest(`.${RENDER_SANDBOX_CLASS}`)) {
            return false;
          }
          if (element.closest("mr-minimap, .mr-minimap")) {
            return false;
          }
          if (element.closest(`.${REPLAY_ANIMATION_OVERLAY_CLASS}, .${REPLAY_EDGE_TRACE_CLASS}`)) {
            return false;
          }
          if (element.closest(".task-graph-node-subgraph-preview")) {
            return false;
          }
          if (element.closest(`.${NODE_DECORATION_CLASS}`)) {
            return false;
          }
          if (element.closest(`.${NODE_ICON_CLASS}, .${GROUP_TIME_CLASS}, .${NODE_FAR_CLASS}`)) {
            return false;
          }
        }
        return true;
      });
      if (hasRealMutations) {
        this.onChartMutation();
      }
    });
    host.addEventListener("pointerdown", pointerDownListener, true);
    host.addEventListener("click", clickListener, true);
    host.addEventListener("dblclick", dblClickListener, true);
    host.addEventListener("contextmenu", contextMenuListener, true);
    chartObserver.observe(host, { childList: true, subtree: true });
    this.destroyRef.onDestroy(() => {
      host.removeEventListener("pointerdown", pointerDownListener, true);
      host.removeEventListener("click", clickListener, true);
      host.removeEventListener("dblclick", dblClickListener, true);
      host.removeEventListener("contextmenu", contextMenuListener, true);
      chartObserver.disconnect();
      this.clearReplayAnimationFrame();
      this.clearReplayAnimationTimer();
      clearTimeout(this.runResultTimer ?? undefined);
      clearTimeout(this.outOfViewTimer ?? undefined);
      clearInterval(this.liveTimeTimer ?? undefined);
      this.mainGraphRenderToken++;
      this.cancelStructuralLayoutSettle();
      this.clearRenderedGraphHostSizeLock();
      this.renderSandboxHost.remove();
    });

    effect(() => this.scheduleSelectedNodeClass(this.highlightedNodeId()));

    effect(() => {
      const summary = this.runSummary();
      untracked(() => this.trackRunState(summary));
    });

    effect(() => {
      const scale = this.cameraState().scale;
      const threshold = this.farZoomScale();
      untracked(() => this.zoomBand.update((band) => nextZoomBand(band, scale, threshold)));
    });

    // Times are overlays, not part of the Mermaid source, so turning them on or off redraws them in place.
    effect(() => {
      this.showTimes();
      untracked(() => this.refreshTimes());
    });

    effect(() => {
      const counting = (this.showTimes() || this.zoomBand() === "far") && this.activeNodes().some((node) => node.status === "running" && !!node.startedAt && node.durationMs == null);
      untracked(() => this.syncLiveTimeTimer(counting));
    });

    effect(() => {
      const outOfView = this.graphOutOfView();
      untracked(() => this.scheduleOutOfViewPrompt(outOfView));
    });

    effect(() => {
      if (!this.viewReady()) return;
      const source = this.mermaidSource();
      const config = this.mermaidOptions();
      const structureKey = `${readMermaidRuntimeConfigKey(config)}\u0000${source}`;
      untracked(() => void this.renderMainGraph(structureKey, source, config));
    });

    // A new direction or group wrap rearranges the whole layout, so the previous
    // camera framing is meaningless — fit the new arrangement once it renders.
    effect(() => {
      this.direction();
      this.groupsPerLine();
      untracked(() => {
        this.hasFitInitialView = false;
      });
    });

    effect(() => {
      const size = this.viewportSize();
      if (viewportAspectChanged(untracked(this.arrangementViewport), size)) {
        this.arrangementViewport.set(size);
      }
    });

    // Keep the navigation stack in sync with the host-controlled `path` input so
    // browser back/forward can restore subgraph depth. Reads only `path` (and the
    // resolver) tracked; the graph inputs are read untracked so replay status
    // ticks never rebuild the stack.
    effect(() => this.reconcileStackToPath(this.path()));

    // Status colouring and the "current" highlight live as DOM classes on the
    // rendered nodes, applied whenever a status, the current focus, the style map,
    // the decoration map (e.g. the live "thinking" badge), or the active level
    // changes. Because this never touches the Mermaid source, the SVG is not
    // re-rendered.
    effect(() => {
      this.statusKey();
      this.currentNodeId();
      this.replayActive();
      this.replayEvent();
      this.effectiveStatusStyles();
      this.decorations();
      this.nodeKinds();
      this.graphStack();
      this.scheduleStatusClasses();
    });

    effect(() => {
      this.progressKey();
      this.scheduleNodeProgressBars();
    });

    // Re-apply the inline subgraph thumbnails when the toggle flips, the active
    // level changes, or resolved subgraphs load/update.
    effect(() => {
      this.showSubgraphPreview();
      this.graphStack();
      this.activeNodes();

      // Reactively track resolveSubgraph evaluations for each active node
      for (const node of this.activeNodes()) {
        this.resolveSubgraph(node);
      }

      this.scheduleSubgraphPreviews();
    });

    // Re-frame the camera whenever an execution event changes the active node or
    // follow is toggled. The graph layout never changes between status updates,
    // so we only need to re-measure when one of these actually fires.
    effect(() => {
      this.followExecution();
      this.followPaused();
      this.currentNodeId();
      this.runningKey();
      this.scheduleFollow();
    });

    effect(() => {
      const replayActive = this.replayActive();
      const replayEvent = this.replayEvent();
      this.graphStack();
      this.scheduleReplayEventAnimation(replayActive, replayEvent);
    });
  }

  ngAfterViewInit(): void {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        this.viewportSize.set({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    const viewport = this.viewportRef().nativeElement;
    resizeObserver.observe(viewport);
    this.destroyRef.onDestroy(() => resizeObserver.disconnect());
    this.backgroundPatternGapPx.set(readCssPxProperty(viewport, "--mr-pattern-gap") ?? DEFAULT_PATTERN_GAP_PX);
    // Seed the size synchronously so the first render already knows the
    // viewport (the observer's first callback arrives a frame later, which would
    // otherwise force an immediate second render for viewport-aware layouts).
    const { width, height } = viewport.getBoundingClientRect();
    this.viewportSize.set({ width, height });
    this.viewReady.set(true);
  }

  private buildAliasMap(nodes: readonly MermaidRuntime.Node[]): GraphAliasMap {
    const toAlias = new Map<string, string>();
    const toReal = new Map<string, string>();
    nodes.forEach((node, index) => {
      const alias = `tg${index}`;
      toAlias.set(node.id, alias);
      toReal.set(alias, node.id);
    });
    return { toAlias, toReal };
  }

  /**
   * Build the Mermaid source for the graph **structure only** (nodes, edges,
   * shapes, click targets) — never status or current-focus.
   *
   * Status colouring and the live "current" highlight are applied as DOM classes
   * on the rendered `.node` elements (see `applyStatusClasses`). Keeping them out
   * of the source means `mermaidSource` only changes when the structure changes,
   * so a run that merely advances statuses produces zero Mermaid re-renders.
   */
  private buildGraph(): string {
    const nodes = this.activeNodes();
    const { toAlias } = this.aliasMap();
    const decorations = this.decorations();
    const aliasFor = (id: string): string | undefined => toAlias.get(id);

    return [
      `flowchart ${this.direction()}`,
      ...this.buildNodeDefinitionBlocks(nodes, toAlias, decorations),
      "",
      ...this.buildEdgeLines(aliasFor),
      ...this.buildGroupArrangementLines(),
      "",
      ...nodes.map((node) => this.buildNodeClickLine(node, toAlias.get(node.id) ?? node.id)),
      "",
      `  class ${nodes.map((node) => toAlias.get(node.id)).join(",")} clickable;`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Builds node definition lines, wrapping grouped nodes in Mermaid `subgraph`
   * clusters (namespaced via {@link groupAliasMap} so their ids never collide
   * with node aliases) so the layout engine treats each group as its own layout
   * unit — this is what actually compacts a long chain, not just colours it.
   *
   * VALUE: A node belongs to at most one group (first group in `groups` order
   * wins ties); ungrouped nodes render exactly as before. Edges, click lines, and
   * the clickable class line are untouched — Mermaid resolves those by node alias
   * regardless of which cluster (if any) contains it.
   */
  private buildNodeDefinitionBlocks(nodes: readonly MermaidRuntime.Node[], toAlias: Map<string, string>, decorations: Record<string, MermaidRuntime.NodeDecoration>): string[] {
    const groups = this.activeGroups() ?? [];
    if (groups.length === 0) {
      return nodes.map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id]));
    }

    const nodeGroupId = new Map<string, string>();
    for (const group of groups) {
      for (const nodeId of group.nodeIds) {
        if (!nodeGroupId.has(nodeId)) nodeGroupId.set(nodeId, group.id);
      }
    }

    const groupAliasFor = this.groupAliasMap();
    const groupBlocks: string[] = [];
    // Mermaid places sibling clusters in reverse source order, so arranged groups
    // are emitted reversed to read first → last (left → right / top → bottom).
    const arranged = this.groupsPerLine() === null ? [] : this.arrangeableGroups();
    const orderedGroups = [...[...arranged].reverse(), ...groups.filter((group) => !arranged.includes(group))];
    for (const group of orderedGroups) {
      const memberLines = nodes.filter((node) => nodeGroupId.get(node.id) === group.id).map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id]));
      if (memberLines.length === 0) continue;

      const groupAlias = groupAliasFor.get(group.id) ?? group.id;
      groupBlocks.push(`  subgraph ${groupAlias}["${this.escapeMermaidString(group.label)}"]`);
      const direction = group.direction ?? this.readArrangedGroupDirection(group.id) ?? this.readConnectedGroupDirection(group.id);
      if (direction) groupBlocks.push(`    direction ${direction}`);
      groupBlocks.push(...memberLines);
      groupBlocks.push("  end");
    }

    const ungroupedLines = nodes.filter((node) => !nodeGroupId.has(node.id)).map((node) => this.buildNodeDefinitionLine(node, toAlias.get(node.id) ?? node.id, decorations[node.id]));

    return [...groupBlocks, ...ungroupedLines];
  }

  /**
   * Inner direction for an independent group that the host left unset.
   *
   * VALUE: Without it Mermaid flips an unconnected cluster perpendicular to the
   * graph, which is what turns parallel groups into one long strip. Matching the
   * graph's own direction makes groups line up *across* the flow instead.
   */
  private readArrangedGroupDirection(groupId: string): "TB" | "LR" | null {
    if (this.groupsPerLine() === null || !this.arrangeableGroups().some((group) => group.id === groupId)) return null;
    return this.direction() === "TD" ? "TB" : "LR";
  }

  /**
   * Inner direction for a group wired into the rest of the graph that the host
   * left unset.
   *
   * VALUE: Without it a chain of groups keeps the outer direction inside every
   * group, so a long process renders as one long strip. Running the steps across
   * the flow stacks the groups as short rows (or columns). Off in `'mermaid'`
   * (legacy) mode; independent groups are handled by
   * {@link readArrangedGroupDirection}.
   */
  private readConnectedGroupDirection(groupId: string): "TB" | "BT" | "LR" | "RL" | null {
    if (this.groupArrangement() === "mermaid" || this.arrangeableGroups().some((group) => group.id === groupId)) return null;
    return connectedGroupDirection(this.direction(), this.groupChainLevels().get(groupId) ?? 0, this.groupFlow());
  }

  /**
   * Redraw plan for arrows that cross a group border, or null when there is
   * nothing to redraw.
   *
   * VALUE: Mermaid draws such an arrow from group border to group border once a
   * group runs a different way to the graph; redrawing it keeps the compact
   * layout and the exact step-to-step arrows. Off in `'mermaid'` (legacy) mode.
   */
  private buildGroupCrossingPlan(): GroupCrossingPlan | null {
    if (this.groupArrangement() === "mermaid") return null;
    const groups = this.activeGroups() ?? [];
    if (groups.length === 0) return null;

    const { toAlias } = this.aliasMap();
    const groupAliasFor = this.groupAliasMap();
    const independentIds = new Set(this.arrangeableGroups().map((group) => group.id));
    const groupOfNode = new Map<string, string>();
    const routedGroups = new Set<string>();
    for (const group of groups) {
      const groupAlias = groupAliasFor.get(group.id);
      if (!groupAlias) continue;
      if (!independentIds.has(group.id)) routedGroups.add(groupAlias);
      for (const nodeId of group.nodeIds) {
        const nodeAlias = toAlias.get(nodeId);
        if (nodeAlias && !groupOfNode.has(nodeAlias)) groupOfNode.set(nodeAlias, groupAlias);
      }
    }

    const edges = this.resolveEdges().flatMap((edge) => {
      const from = toAlias.get(edge.from);
      const to = toAlias.get(edge.to);
      return from && to ? [{ from, to }] : [];
    });
    return { flow: this.direction(), groupOfNode, routedGroups, edges };
  }

  /**
   * Invisible group-to-group links that wrap independent groups into lines.
   *
   * VALUE: Mermaid then lays out the grid itself; see `buildGroupWrapLinks`.
   */
  private buildGroupArrangementLines(): string[] {
    const perLine = this.groupsPerLine();
    if (perLine === null) return [];
    const aliasFor = this.groupAliasMap();
    const aliases = this.arrangeableGroups().map((group) => aliasFor.get(group.id) ?? group.id);
    return buildGroupWrapLinks(aliases, perLine);
  }

  /** Cache key for a group's measured footprint: depends on flow and membership. */
  private groupFootprintKey(group: MermaidRuntime.NodeGroup, flow: "TD" | "LR"): string {
    return `${flow}\u0000${group.id}\u0000${group.nodeIds.join(",")}`;
  }

  /**
   * Records the rendered size of each arranged group not yet measured.
   *
   * VALUE: Replaces the first-render estimate with real cluster sizes so
   * `'auto'` picks the best wrap; already-measured groups are skipped, so this
   * converges after at most one refinement render.
   */
  private measureGroupFootprints(host: HTMLElement): void {
    if (this.groupArrangement() !== "auto" || this.groupsPerLine() === null) return;
    const flow = this.direction();
    const known = this.groupFootprints();
    const aliasFor = this.groupAliasMap();
    let next: Map<string, GroupFootprint> | null = null;
    for (const group of this.arrangeableGroups()) {
      const key = this.groupFootprintKey(group, flow);
      if (known.has(key)) continue;
      const rect = host.querySelector<SVGRectElement>(`g.cluster[id$="-${aliasFor.get(group.id)}"] > rect`);
      const width = Number(rect?.getAttribute("width"));
      const height = Number(rect?.getAttribute("height"));
      if (!(width > 0 && height > 0)) continue;
      next ??= new Map(known);
      next.set(key, { width, height });
    }
    if (next) this.groupFootprints.set(next);
  }

  private buildNodeDefinitionLine(node: MermaidRuntime.Node, alias: string, decoration: MermaidRuntime.NodeDecoration | undefined): string {
    const style = resolveNodeStyle(node, decoration, this.nodeKinds());
    const title = this.buildNodeLabel(decoration?.displayTitle ?? node.title, node.subtitle, style);
    const reservedPreview = this.showSubgraphPreview() && this.resolveSubgraph(node) ? this.buildReservedContentHtml("subgraph-preview") : "";
    const label = `${title}${reservedPreview}`;
    switch (style.shape) {
      case "diamond":
        return `  ${alias}{"${label}"}`;
      case "subroutine":
        return `  ${alias}[["${label}"]]`;
      case "rounded":
        return `  ${alias}("${label}")`;
      case "hexagon":
        return `  ${alias}{{"${label}"}}`;
      case "parallelogram":
        return `  ${alias}[/"${label}"/]`;
      default:
        return `  ${alias}["${label}"]`;
    }
  }

  /**
   * Builds the Mermaid node label.
   *
   * PURPOSE: Keep Mermaid source limited to node text, plus one styled span for the subtitle.
   *
   * VALUE: Live progress markup is injected after render, so Mermaid cannot
   * parse-fail on HTML controls or changing percentage values. The subtitle is
   * escaped as text, so a command containing `<`, `&` or quotes shows as typed.
   * The span uses single quotes because this HTML sits inside a double-quoted
   * Mermaid label.
   */
  private buildNodeLabel(title: string, subtitle?: string | null, style?: ResolvedNodeStyle): string {
    const toneClass = toToneClass(style?.tone);
    const toneAttribute = toneClass ? ` ${toneClass}` : "";
    const icon = style?.icon && readIconContent(style.icon) ? `<span class='${NODE_ICON_CLASS}${toneAttribute}'></span>` : "";
    const text = `${icon}${this.escapeMermaidString(title)}`;
    const chip = style?.chip ? `<span class='${NODE_CHIP_CLASS}${toneAttribute}'>${this.escapeMermaidString(this.escapeHtml(style.chip))}</span>` : "";
    const line = subtitle?.trim();
    const detail = line ? this.highlightPlaceholders(this.escapeMermaidString(this.escapeHtml(line))) : "";
    return chip || detail ? `${text}<span class='mr-node-subtitle'>${chip}${detail}</span>` : text;
  }

  /**
   * Draws a node's icon into the slot its label reserved.
   *
   * VALUE: Idempotent: a slot that already shows this icon is left alone, so the
   * status pass can call it on every tick without touching the DOM.
   */
  private applyNodeIcon(nodeElement: Element, icon: string | undefined): void {
    const slot = nodeElement.querySelector<HTMLElement>(`.${NODE_ICON_CLASS}`);
    if (!slot || !icon || slot.dataset[NODE_ICON_KEY_ATTRIBUTE] === icon) return;
    const content = readIconContent(icon);
    slot.dataset[NODE_ICON_KEY_ATTRIBUTE] = icon;
    slot.classList.remove(MATERIAL_ICON_FONT_CLASS);
    slot.replaceChildren();
    if (!content) return;
    if (content.kind === "svg") {
      slot.append(content.element);
    } else {
      slot.classList.add(MATERIAL_ICON_FONT_CLASS);
      slot.textContent = content.name;
    }
  }

  /**
   * The line a node shows for how it is doing: its percentage while it reports progress,
   * then its time, such as `42% · 1m 05s`. Empty when there is nothing to show.
   *
   * VALUE: The badge up close passes `withTime` from `showTimes`. The centred text when
   * zoomed far out always includes the time, so a far-out overview shows how long each
   * step took even for a host that never turned `showTimes` on. The percentage follows
   * the progress-ring rules (not shown on finished steps).
   */
  private readNodeReadout(node: MermaidRuntime.Node, nowMs: number, withTime: boolean): string {
    const percent = selectVisibleNodeProgress(node.status, this.readNodeProgressPercent(node.progressPercent), [], this.progressRings(), false).percent;
    return composeNodeReadout(percent, withTime ? formatDurationMs(getLiveNodeTimeMs(node, nowMs)) : "");
  }

  /**
   * Draws a node's badge: the small pill on its bottom-right border that holds its
   * percentage and time together, and removes it when there is nothing to show.
   *
   * PURPOSE: One place on the node for "how far" and "how long", so a running step shows
   * both at once instead of two things competing for the same corner. Zoomed far out the
   * badge is hidden by CSS and the same text is drawn large in the middle (see applyFarLabel).
   *
   * VALUE: Layout-free: the badge is an SVG overlay, so a time that appears or counts up
   * never changes a node's size. A badge that already shows this text is left alone, so
   * the once-a-second time tick touches the DOM only when a digit changes.
   */
  private applyNodeReadout(nodeElement: Element, node: MermaidRuntime.Node, nowMs: number): void {
    const text = this.readNodeReadout(node, nowMs, this.showTimes());
    const existing = nodeElement.querySelector<SVGGElement>(`:scope > .${PROGRESS_BADGE_CLASS}`);
    if (!text) {
      existing?.remove();
      return;
    }
    if (existing?.dataset[BADGE_KEY_ATTRIBUTE] === text) {
      // Rings added after the badge would cover it, so keep it last.
      if (nodeElement.lastElementChild !== existing) nodeElement.appendChild(existing);
      return;
    }
    const shapeEl = this.findNodeShapeElement(nodeElement);
    const geometry = shapeEl ? this.readOffsetGeometry(shapeEl, 0) : null;
    if (!shapeEl || !geometry) {
      existing?.remove();
      return;
    }

    let badge = existing;
    if (!badge) {
      badge = document.createElementNS(SVG_NAMESPACE, "g") as SVGGElement;
      badge.classList.add(PROGRESS_BADGE_CLASS, NODE_DECORATION_CLASS);
      badge.setAttribute("pointer-events", "none");
      // The pill needs the decoration class itself: status/hover rules match any `.node rect` without it.
      const pillElement = document.createElementNS(SVG_NAMESPACE, "rect");
      pillElement.classList.add(NODE_DECORATION_CLASS);
      badge.appendChild(pillElement);
      const textElement = document.createElementNS(SVG_NAMESPACE, "text");
      textElement.setAttribute("text-anchor", "middle");
      textElement.setAttribute("dominant-baseline", "central");
      badge.appendChild(textElement);
    }
    if (nodeElement.lastElementChild !== badge) nodeElement.appendChild(badge);

    const transform = shapeEl.getAttribute("transform");
    if (transform) badge.setAttribute("transform", transform);
    else badge.removeAttribute("transform");

    const box = computeProgressBadgeBox(geometry, text);
    const pill = badge.querySelector("rect")!;
    pill.setAttribute("x", String(box.x));
    pill.setAttribute("y", String(box.y));
    pill.setAttribute("width", String(box.width));
    pill.setAttribute("height", String(box.height));
    pill.setAttribute("rx", String(box.height / 2));

    const textElement = badge.querySelector("text")!;
    textElement.setAttribute("x", String(box.x + box.width / 2));
    textElement.setAttribute("y", String(box.y + box.height / 2));
    textElement.textContent = text;
    badge.dataset[BADGE_KEY_ATTRIBUTE] = text;
  }

  /**
   * Gives a node what it shows in the middle when zoomed far out: its kind's icon and chip
   * in a row, and its percentage and time large below.
   *
   * PURPOSE: At far zoom the label is too small to read, but what kind of step it is (a
   * Kafka wait, a SQL poll) and how it is doing still are. The content is laid out at the
   * largest size that fits the node (see computeFarLayout) and the stylesheet shrinks it
   * from the zoom (the `.mr-node-far` rule), so it stays about the same size on screen. A
   * step with no icon, chip, percentage or time shows a short form of its name instead,
   * so it is not a blank box.
   *
   * VALUE: Layout-free and cheap to repeat: the group is rebuilt only when its content
   * changes, so the once-a-second time tick touches the DOM only when a digit changes.
   */
  private applyFarLabel(nodeElement: Element, node: MermaidRuntime.Node, nowMs: number): void {
    if (this.farZoomScale() === null) return;
    const style = resolveNodeStyle(node, this.decorations()[node.id], this.nodeKinds());
    const readout = resolveFarLabel(node, this.readNodeReadout(node, nowMs, true), this.farLabel());
    const chip = style.chip ?? "";
    const key = [readout, chip, style.icon ?? "", style.tone ?? "", node.title].join(FAR_KEY_SEPARATOR);
    const existing = nodeElement.querySelector<SVGGElement>(`:scope > g.${NODE_FAR_CLASS}`);
    if (existing?.dataset[FAR_KEY_ATTRIBUTE] === key) return;
    const box = this.readNodeShapeBox(nodeElement);
    if (!box) return;

    const icon = style.icon ? readIconContent(style.icon) : null;
    const line = !readout && !chip && !icon ? shortenNodeName(node.title) : readout;
    const layout = computeFarLayout(box, { hasIcon: !!icon, chip, readout: line });
    const group = existing ?? (nodeElement.ownerDocument.createElementNS(SVG_NAMESPACE, "g") as SVGGElement);
    group.replaceChildren();
    group.setAttribute("class", [NODE_FAR_CLASS, toToneClass(style.tone)].filter(Boolean).join(" "));
    group.style.setProperty(FAR_BASE_FONT_PROPERTY, layout.baseFont.toFixed(2));

    const kind = layout.kind;
    if (kind && icon) group.append(this.buildFarIcon(icon, kind.iconX, kind.y, kind.iconSize));
    if (kind && chip) {
      const pill = nodeElement.ownerDocument.createElementNS(SVG_NAMESPACE, "rect");
      pill.classList.add("mr-node-far-chip-bg", NODE_DECORATION_CLASS);
      pill.setAttribute("x", String(kind.chipX));
      pill.setAttribute("y", String(kind.y - kind.chipHeight / 2));
      pill.setAttribute("width", String(kind.chipWidth));
      pill.setAttribute("height", String(kind.chipHeight));
      pill.setAttribute("rx", String(kind.chipHeight / 2));
      group.append(pill, this.buildFarText("mr-node-far-chip", chip, kind.chipX + kind.chipWidth / 2, kind.y, kind.fontSize));
    }
    if (layout.readout) group.append(this.buildFarText("mr-node-far-readout", line, 0, layout.readout.y, layout.readout.fontSize));
    group.dataset[FAR_KEY_ATTRIBUTE] = key;
    if (!existing) nodeElement.appendChild(group);
  }

  /** One centred line of far text. */
  private buildFarText(className: string, text: string, x: number, y: number, fontSize: number): SVGTextElement {
    const element = document.createElementNS(SVG_NAMESPACE, "text") as SVGTextElement;
    element.setAttribute("class", className);
    element.setAttribute("x", String(x));
    element.setAttribute("y", String(y));
    element.setAttribute("font-size", String(fontSize));
    element.textContent = text;
    return element;
  }

  /** A node kind's icon sized and placed for the far content: a Material name as a centred glyph, an SVG as a nested copy. */
  private buildFarIcon(icon: IconContent, x: number, centreY: number, size: number): SVGElement {
    if (icon.kind === "svg") {
      const svg = icon.element.cloneNode(true) as SVGSVGElement;
      svg.classList.add("mr-node-far-icon");
      svg.setAttribute("x", String(x));
      svg.setAttribute("y", String(centreY - size / 2));
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      return svg;
    }
    return this.buildFarText(`mr-node-far-icon ${MATERIAL_ICON_FONT_CLASS}`, icon.name, x + size / 2, centreY, size);
  }

  /** Size of a node's drawn shape in scene units, or null when it cannot be measured. */
  private readNodeShapeBox(nodeElement: Element): { width: number; height: number } | null {
    const shape = nodeElement.querySelector<SVGGraphicsElement>(".label-container, rect, polygon, path");
    if (!shape) return null;
    try {
      const box = shape.getBBox();
      return box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : null;
    } catch {
      return null;
    }
  }

  /**
   * Draws each group's time as a small pill to the right of its title.
   *
   * PURPOSE: A group's time is the span of its steps (see `measureGroupTimeMs`), so
   * it cannot be part of the title in the Mermaid source without a re-render on
   * every change.
   *
   * VALUE: Idempotent and layout-free: the pill is an SVG element in the raised
   * title layer, created once per title and updated in place, and removed again
   * when the group has no time.
   */
  private applyGroupTimes(nowMs: number): void {
    const host = this.readRenderedGraphHost();
    if (!host) return;
    const groups = this.activeGroups() ?? [];
    if (!this.showTimes() || groups.length === 0) {
      host.querySelectorAll(`.${GROUP_TIME_CLASS}`).forEach((pill) => pill.remove());
      return;
    }
    const nodesById = new Map(this.activeNodes().map((node) => [node.id, node]));
    for (const group of groups) {
      const alias = this.groupAliasMap().get(group.id);
      const label = alias ? host.querySelector<SVGGElement>(`g.cluster-label[data-mr-group-label-for$="-${alias}"]`) : null;
      if (!label) continue;
      const members = group.nodeIds.map((id) => nodesById.get(id)).filter((node): node is MermaidRuntime.Node => !!node);
      const text = formatDurationMs(measureGroupTimeMs(members, nowMs));
      this.drawGroupTime(label, text);
    }
  }

  /** Creates, updates or removes the time pill of one group title. */
  private drawGroupTime(label: SVGGElement, text: string): void {
    let pill = label.querySelector<SVGGElement>(`:scope > .${GROUP_TIME_CLASS}`);
    const backdrop = label.querySelector<SVGRectElement>(":scope > rect.mr-group-label-backdrop");
    if (!text || !backdrop) {
      pill?.remove();
      return;
    }
    if (!pill) {
      pill = label.ownerDocument.createElementNS(SVG_NAMESPACE, "g") as SVGGElement;
      pill.classList.add(GROUP_TIME_CLASS);
      pill.append(label.ownerDocument.createElementNS(SVG_NAMESPACE, "rect"), label.ownerDocument.createElementNS(SVG_NAMESPACE, "text"));
      pill.firstElementChild!.classList.add("mr-group-label-backdrop");
      label.appendChild(pill);
    }
    const [box, caption] = [pill.firstElementChild as SVGRectElement, pill.lastElementChild as SVGTextElement];
    const height = backdrop.height.baseVal.value;
    const fontSize = height * GROUP_TIME_FONT_RATIO;
    const width = text.length * fontSize * GROUP_TIME_CHAR_WIDTH_RATIO + 2 * GROUP_TIME_PADDING_X_PX;
    const x = backdrop.x.baseVal.value + backdrop.width.baseVal.value + GROUP_TIME_GAP_PX;
    const y = backdrop.y.baseVal.value;
    box.setAttribute("x", String(x));
    box.setAttribute("y", String(y));
    box.setAttribute("width", String(width));
    box.setAttribute("height", String(height));
    caption.setAttribute("x", String(x + width / 2));
    caption.setAttribute("y", String(y + height / 2));
    caption.setAttribute("font-size", String(fontSize));
    if (caption.textContent !== text) caption.textContent = text;
  }

  /**
   * Counts running steps' times up once a second.
   *
   * VALUE: Runs only while a shown time is counting (a running step with a
   * `startedAt` and no recorded duration), and updates text only.
   */
  private syncLiveTimeTimer(counting: boolean): void {
    if (!counting) {
      clearInterval(this.liveTimeTimer ?? undefined);
      this.liveTimeTimer = null;
      return;
    }
    if (this.liveTimeTimer !== null) return;
    this.liveTimeTimer = setInterval(() => this.refreshTimes(), LIVE_TIME_REFRESH_MS);
  }

  /** Rewrites every visible time from the current clock, without touching anything else. */
  private refreshTimes(): void {
    const nowMs = Date.now();
    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      this.applyNodeReadout(element, node, nowMs);
      this.applyFarLabel(element, node, nowMs);
    }
    this.applyGroupTimes(nowMs);
  }

  /**
   * Wraps each `{{name}}` placeholder in a span so the label can colour it.
   *
   * VALUE: In a command line the variable parts are what a reader looks for;
   * they stand out from the fixed words without any host markup.
   */
  private highlightPlaceholders(escapedText: string): string {
    return escapedText.replace(/{{[^{}]*}}/g, (placeholder) => `<span class='mr-node-param'>${placeholder}</span>`);
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /**
   * Builds an empty, fixed-size placeholder `<div>` for content that is
   * filled in *after* Mermaid's own render (e.g. {@link applySubgraphPreviews}).
   *
   * VALUE: Reserves the content's known footprint (see
   * {@link RESERVED_LABEL_CONTENT_SIZE}) inside the Mermaid label text so
   * `htmlLabels` measurement includes it before the node/edges are sized —
   * see the note on {@link RESERVED_LABEL_CONTENT_SIZE} for why this matters.
   *
   * Attributes use single quotes: this HTML is embedded inside a
   * double-quote-delimited Mermaid label string, so double quotes here would
   * terminate that string early.
   */
  private buildReservedContentHtml(kind: ReservedLabelContentKind): string {
    const size = RESERVED_LABEL_CONTENT_SIZE[kind];
    return `<div class='task-graph-node-${kind}' style='width:${size.width}px;height:${size.height}px'></div>`;
  }

  /**
   * Reads a safe whole-number progress value from a task-run node.
   *
   * PURPOSE: Avoid pushing null, NaN, or out-of-range progress into Mermaid HTML
   * labels.
   *
   * VALUE: The generated `<progress>` element always receives valid numeric
   * attributes.
   */
  private readNodeProgressPercent(progressPercent: number | null | undefined): number | null {
    if (progressPercent === null || progressPercent === undefined || !Number.isFinite(progressPercent)) {
      return null;
    }
    return Math.max(TASK_GRAPH_PROGRESS_MIN_PERCENT, Math.min(TASK_GRAPH_PROGRESS_MAX_PERCENT, Math.round(progressPercent)));
  }

  private buildEdgeLines(aliasFor: (id: string) => string | undefined): string[] {
    return this.resolveEdges()
      .map((edge) => {
        const from = aliasFor(edge.from);
        const to = aliasFor(edge.to);
        if (!from || !to) return null;
        return edge.label ? `  ${from} -->|${this.escapeMermaidString(edge.label)}| ${to}` : `  ${from} --> ${to}`;
      })
      .filter((line): line is string => line !== null);
  }

  /** Prefer explicit transitions, then per-node transitions, then dependencies. */
  private resolveEdges(): GraphEdge[] {
    const nodes = this.activeNodes();
    const explicit = this.activeTransitions() ?? [];
    const perNode = nodes.flatMap((node) => node.transitions ?? []);
    const transitions = explicit.length > 0 ? explicit : perNode;
    if (transitions.length > 0) {
      return transitions.map((transition) => ({
        from: transition.from,
        to: transition.to,
        label: transition.label ?? undefined,
      }));
    }
    return nodes.flatMap((node) => (node.dependencies ?? []).map((dependency) => ({ from: dependency, to: node.id })));
  }

  /**
   * Builds the Mermaid `click` line that makes a node a link the canvas can intercept.
   *
   * No tooltip text is passed: Mermaid draws tooltips as a `<body>`-level div
   * with a hard-coded light background, which is unreadable on dark hosts and
   * only repeated the node title.
   */
  private buildNodeClickLine(node: MermaidRuntime.Node, alias: string): string {
    return `  click ${alias} "?${NODE_HREF_PARAM}=${encodeURIComponent(node.id)}"`;
  }

  private escapeMermaidString(value: string): string {
    return value.replace(/"/g, '#quot;');
  }

  private onChartMutation(): void {
    try {
      // Guard against early DOM mutations before Angular has populated required inputs
      this.nodes();
    } catch (err) {
      return;
    }

    this.applySelectedNodeClass(this.highlightedNodeId());
    const renderedGraphHost = this.readRenderedGraphHost();
    if (!renderedGraphHost?.querySelector(".node")) return;
    this.measureGroupFootprints(renderedGraphHost);
    this.setRenderPhase(this.mainGraphRenderToken, "decorating");

    // Clear hashes on structural parent re-render so all subgraph previews are redrawn
    this.subgraphStructureHashes.clear();

    // A structural re-render produces fresh, class-less nodes; re-apply status.
    this.applyStatusClasses();
    this.applySubgraphPreviews();
    this.applyNodeProgressBars();

    const pendingStructuralRerender = this.pendingStructuralRerender;
    if (pendingStructuralRerender) {
      this.pendingStructuralRerender = null;
      this.finalizeStructuralRerender(pendingStructuralRerender.previousCameraState);
      this.scheduleRenderStable();
      return;
    }

    this.updateMinimap();

    if (this.followActive() && this.activeFocusId()) {
      // First render (or a re-render) with follow on and a focus node: frame it.
      this.requestFrameActiveNode();
    } else if (!this.hasFitInitialView) {
      // No focus to follow (idle, or a freshly-entered subgraph): fit the whole
      // level once so the new graph is visible.
      this.hasFitInitialView = true;
      requestAnimationFrame(() => this.cameraRef().fitAll());
    }
    this.scheduleRenderStable();
  }

  private async renderMainGraph(structureKey: string, source: string, config: MermaidRuntimeConfig): Promise<void> {
    this.prepareStructuralRerender(structureKey);
    const token = ++this.mainGraphRenderToken;
    this.setRenderPhase(token, "rendering");

    try {
      ensureMermaidConfigured(config);
      const renderId = `${this.instanceId}-${token}`;
      ensureMermaidTemporaryRenderIsolation(this.hostElement.nativeElement.ownerDocument);
      const { svg, bindFunctions } = await mermaid.render(renderId, source);
      if (token !== this.mainGraphRenderToken) {
        return;
      }

      this.renderSandboxHost.innerHTML = svg;
      this.setRenderPhase(token, "settling-sandbox");
      const sandboxSettled = await this.waitForStableSandboxLayout(token);
      if (!sandboxSettled || token !== this.mainGraphRenderToken) {
        if (token === this.mainGraphRenderToken) {
          this.pendingStructuralRerender = null;
          this.renderSandboxHost.replaceChildren();
          this.clearRenderedGraphHostSizeLock();
          this.setRenderPhase(token, "error", "Sandbox SVG layout did not settle");
        }
        return;
      }

      const renderedGraphHost = this.readRenderedGraphHost();
      if (!renderedGraphHost) {
        return;
      }

      // In the hidden sandbox, so the visible graph never shows Mermaid's
      // border-to-border arrows between groups, or titles under arrows.
      const crossingPlan = this.buildGroupCrossingPlan();
      if (crossingPlan) routeGroupCrossings(this.renderSandboxHost, crossingPlan);
      raiseGroupLabels(this.renderSandboxHost);
      this.setRenderPhase(token, "swapping");
      renderedGraphHost.innerHTML = this.renderSandboxHost.innerHTML;
      this.renderSandboxHost.replaceChildren();
      bindFunctions?.(renderedGraphHost);
    } catch (err) {
      if (token === this.mainGraphRenderToken) {
        this.pendingStructuralRerender = null;
        this.renderSandboxHost.replaceChildren();
        this.clearRenderedGraphHostSizeLock();
      }
      this.setRenderPhase(token, "error", err instanceof Error ? err.message : String(err));
      console.error("Failed to render Mermaid graph canvas", err);
    }
  }

  /**
   * Snapshot the current camera before a structural Mermaid re-render starts.
   *
   * VALUE: The previous graph stays visible while Mermaid renders offscreen, and
   * once the finished SVG is swapped into view the camera can either restore the
   * prior viewport or compute a new fit/follow target.
   */
  private prepareStructuralRerender(structureKey: string): void {
    // A render that supersedes one which never reached the screen is still the
    // first visible render: there is no previous graph to keep on screen or to
    // freeze the host size from (freezing an empty host makes fit-all zoom to max).
    if (this.lastStructureRenderKey === null || !this.readRenderedGraphHost()?.querySelector("svg")) {
      this.lastStructureRenderKey = structureKey;
      return;
    }
    if (this.lastStructureRenderKey === structureKey) {
      return;
    }

    this.lastStructureRenderKey = structureKey;
    this.cancelStructuralLayoutSettle();
    const frozenHostSize = this.measureRenderedGraphHostSize();
    this.pendingStructuralRerender = {
      token: ++this.structuralLayoutToken,
      previousCameraState: this.readCameraComponent()?.cameraState() ?? DEFAULT_CAMERA_STATE,
    };
    this.applyRenderedGraphHostSizeLock(frozenHostSize);
  }

  /**
   * Wait for the offscreen Mermaid sandbox SVG bounds to stop changing before it
   * is swapped into the visible camera scene.
   *
   * VALUE: The visible scene never shows Mermaid's transient label/bounds phases;
   * only a settled SVG is promoted into the camera subtree.
   */
  private waitForStableSandboxLayout(renderToken: number): Promise<boolean> {
    this.cancelStructuralLayoutSettle();

    return new Promise((resolve) => {
      let sampledFrameCount = 0;
      const tracker = new LayoutStabilityTracker(
        STRUCTURAL_LAYOUT_STABLE_FRAME_COUNT,
        STRUCTURAL_LAYOUT_BOUNDS_EPSILON_PX,
      );

      const sampleLayout = (): void => {
        if (renderToken !== this.mainGraphRenderToken) {
          this.structuralLayoutSettleFrame = null;
          resolve(false);
          return;
        }

        sampledFrameCount++;
        const bounds = this.measureSvgBounds(this.renderSandboxHost);
        const stability = tracker.sample(bounds);

        if (stability === "settled") {
          this.structuralLayoutSettleFrame = null;
          resolve(true);
          return;
        }

        if (sampledFrameCount >= STRUCTURAL_LAYOUT_MAX_WAIT_FRAMES) {
          this.structuralLayoutSettleFrame = null;
          resolve(false);
          return;
        }

        this.structuralLayoutSettleFrame = requestAnimationFrame(sampleLayout);
      };

      this.structuralLayoutSettleFrame = requestAnimationFrame(sampleLayout);
    });
  }

  /**
   * Finish a structural Mermaid re-render after its layout settles.
   *
   * VALUE: The camera either resumes follow, fits a new level/direction change,
   * or restores the user's prior viewport without ever measuring a stale label
   * box from the in-flight render.
   */
  private finalizeStructuralRerender(previousCameraState: GraphCameraState): void {
    this.setRenderPhase(this.mainGraphRenderToken, "fitting-camera");
    this.updateMinimap();

    if (this.followActive() && this.activeFocusId()) {
      this.frameActiveNode({ animate: false });
      requestAnimationFrame(() => this.clearRenderedGraphHostSizeLock());
      return;
    }

    if (!this.hasFitInitialView) {
      this.hasFitInitialView = true;
      // Release the swap size lock *before* fitting: the lock holds the host at
      // the previous graph's size (and CSS-scales the new SVG into it), so
      // fitting under it frames the old dimensions — e.g. after a direction or
      // group-wrap change. Unlock + fit run in one task, so no frame paints between.
      this.clearRenderedGraphHostSizeLock();
      this.cameraRef().fitAll({ animate: false });
      return;
    }

    this.cameraRef().setCameraState(previousCameraState, { animate: false });
    requestAnimationFrame(() => this.clearRenderedGraphHostSizeLock());
  }

  private setRenderPhase(generation: number, phase: GraphRenderPhase, message?: string): void {
    if (generation !== this.mainGraphRenderToken && generation !== 0) return;
    this.renderStatus.set({
      generation,
      phase,
      direction: this.direction(),
      path: this.graphStack().map((frame) => frame.nodeId),
      ...(message ? { message } : {}),
    });
  }

  private scheduleRenderStable(): void {
    const generation = this.mainGraphRenderToken;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (generation !== this.mainGraphRenderToken) return;
        this.setRenderPhase(generation, "stable");
        this.renderSettled.emit(this.renderStatus());
      });
    });
  }

  /** Cancel any in-flight structural-layout settle loop. */
  private cancelStructuralLayoutSettle(): void {
    if (this.structuralLayoutSettleFrame === null) {
      return;
    }
    cancelAnimationFrame(this.structuralLayoutSettleFrame);
    this.structuralLayoutSettleFrame = null;
  }

  /** Safe access to the child camera before/after view init. */
  private readCameraComponent(): GraphCameraComponent | null {
    try {
      return this.cameraRef();
    } catch {
      return null;
    }
  }

  /** Read the current Mermaid SVG bounds inside a specific render root. */
  private measureSvgBounds(root: ParentNode): DOMRect | null {
    const svg = root.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) {
      return null;
    }

    const bounds = svg.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }
    return bounds;
  }

  /** Safe access to the visible Mermaid mount inside the camera scene. */
  private readRenderedGraphHost(): HTMLElement | null {
    try {
      return this.mermaidHostRef().nativeElement;
    } catch {
      return null;
    }
  }

  /**
   * Measure the visible Mermaid host's current box size in CSS pixels.
   *
   * VALUE: Lets a structural rerender temporarily hold the camera scene at its
   * previous intrinsic size while the new SVG is swapped in.
   */
  private measureRenderedGraphHostSize(): GraphHostSize | null {
    const host = this.readRenderedGraphHost();
    if (!host) {
      return null;
    }

    const bounds = host.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }

    return {
      width: bounds.width,
      height: bounds.height,
    };
  }

  /**
   * Lock the visible Mermaid host to a fixed size for the structural swap window.
   *
   * VALUE: Prevents the camera scene's intrinsic size from collapsing or
   * expanding for a frame before the final camera state has been restored.
   */
  private applyRenderedGraphHostSizeLock(size: GraphHostSize | null): void {
    const host = this.readRenderedGraphHost();
    if (!host || !size) {
      return;
    }

    host.style.width = `${size.width}px`;
    host.style.height = `${size.height}px`;
    host.style.minWidth = `${size.width}px`;
    host.style.minHeight = `${size.height}px`;
    host.style.maxWidth = `${size.width}px`;
    host.style.maxHeight = `${size.height}px`;
  }

  /**
   * Release any temporary structural-swap size lock on the visible Mermaid host.
   *
   * VALUE: Once the corrected camera state has painted, the new graph regains
   * its natural intrinsic size for future fits and follow measurements.
   */
  private clearRenderedGraphHostSizeLock(): void {
    const host = this.readRenderedGraphHost();
    if (!host) {
      return;
    }

    host.style.removeProperty("width");
    host.style.removeProperty("height");
    host.style.removeProperty("min-width");
    host.style.removeProperty("min-height");
    host.style.removeProperty("max-width");
    host.style.removeProperty("max-height");
  }

  private updateMinimap(): void {
    const camera = this.cameraRef();
    if (!camera) return;

    const content = camera.contentRect();
    this.minimapContentRect.set(content);

    const styles = this.effectiveStatusStyles();
    const nodeRects: MinimapNodeRect[] = [];
    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      const rect = camera.measureElementsRect([element]);
      if (rect) {
        nodeRects.push({
          id: node.id,
          rect,
          className: styles[node.status]?.className ?? "undone",
        });
      }
    }
    this.minimapNodes.set(nodeRects);
  }

  centerOnPoint(point: { x: number; y: number }): void {
    // Minimap drags re-emit this on every pointermove; an eased animation
    // would restart on each call and never catch up to the pointer.
    this.cameraRef().centerOn(point, { animate: false });
  }

  /**
   * Delegates to the camera for a host rendering its own controls (`cameraControlsPlacement:
   * 'host'`) — `cameraRef` itself is private, so these are the public seam.
   */
  zoomIn(): void {
    this.cameraRef().zoomIn();
  }

  /** @see zoomIn */
  zoomOut(): void {
    this.cameraRef().zoomOut();
  }

  /** @see zoomIn */
  fitAll(): void {
    this.cameraRef().fitAll();
  }

  /** @see zoomIn */
  resetCamera(): void {
    this.cameraRef().reset();
  }

  /** Called by the camera when the user manually pans/zooms — pauses follow. */
  protected onUserInteract(): void {
    if (this.followExecution()) this.followPaused.set(true);
    // A pan/zoom moves the node the menu's position was measured for.
    this.internalContextMenuTarget.set(null);
  }

  /**
   * Notes a change in the run's state: shows the result banner and emits
   * `runSettled` when a run settles, and hides the banner again when a new run starts.
   */
  private trackRunState(summary: ReturnType<typeof summariseRun>): void {
    const previous = this.previousRunState;
    this.previousRunState = summary.state;
    if (summary.state !== "complete" && summary.state !== "failed") {
      clearTimeout(this.runResultTimer ?? undefined);
      this.runResultVisible.set(false);
      return;
    }
    if (previous === null || previous === summary.state) return;
    this.runResultVisible.set(true);
    clearTimeout(this.runResultTimer ?? undefined);
    this.runResultTimer = setTimeout(() => this.runResultVisible.set(false), RUN_RESULT_BANNER_MS);
    this.runSettled.emit({ state: summary.state, summary });
  }

  /** Shows the "back to graph" prompt only after the graph has been out of view for a moment; hides it at once. */
  private scheduleOutOfViewPrompt(outOfView: boolean): void {
    clearTimeout(this.outOfViewTimer ?? undefined);
    if (!outOfView) {
      this.outOfViewPrompt.set(false);
      return;
    }
    this.outOfViewTimer = setTimeout(() => this.outOfViewPrompt.set(true), OUT_OF_VIEW_PROMPT_DELAY_MS);
  }

  /** Banner button handler: brings the graph back, resumes follow, or hides a result. */
  protected onBannerActivated(message: BannerMessage): void {
    if (message.action === "fit") this.fitAll();
    else if (message.action === "resume-follow") this.resumeFollow();
    else this.runResultVisible.set(false);
  }

  /** Banner handler: resume follow and move to the active node. */
  protected resumeFollow(): void {
    this.followPaused.set(false);
    this.scheduleFollow();
  }

  /**
   * Re-frame on the active node when follow is live. Resumes follow if the host
   * just toggled `followExecution` back on.
   */
  private scheduleFollow(): void {
    if (this.followExecution() && !this.lastFollowOn) this.followPaused.set(false);
    this.lastFollowOn = this.followExecution();
    if (this.followActive()) this.requestFrameActiveNode();
  }

  /**
   * Queue a follow re-frame for the next animation frame.
   *
   * A status change fires both the follow effect and a burst of Mermaid DOM
   * mutations; coalescing them to a single frame stops the camera re-animating
   * many times for one execution event.
   */
  private requestFrameActiveNode(): void {
    if (this.followFramePending) return;
    this.followFramePending = true;
    requestAnimationFrame(() => {
      this.followFramePending = false;
      this.frameActiveNode();
    });
  }

  /**
   * Move the camera to the active node (plus its 1-hop neighbours, so the
   * previous/upcoming nodes stay visible). Measures the live render: the layout
   * is stable, so even a node from the outgoing SVG yields the right position.
   */
  private frameActiveNode(options?: { animate?: boolean }): void {
    if (!this.followActive()) return;
    const focusId = this.activeFocusId();
    if (!focusId) return;

    const ids = new Set<string>([focusId]);
    for (const neighbour of this.buildNeighbourMap().get(focusId) ?? []) ids.add(neighbour);

    const elements: Element[] = [];
    for (const id of ids) {
      const element = this.findNodeElement(id);
      if (element) elements.push(element);
    }
    if (elements.length === 0) return;
    this.cameraRef().frameElements(elements, {
      maxScale: FOLLOW_MAX_ZOOM,
      animate: options?.animate,
    });
  }

  /** The node the camera should follow: the live focus, else a running node. */
  private activeFocusId(): string | null {
    const nodes = this.activeNodes();
    const currentId = this.currentNodeId();
    // Only honour `currentNodeId` if it exists at the active level — it addresses
    // the root graph and is meaningless inside a subgraph.
    if (currentId && nodes.some((node) => node.id === currentId)) return currentId;
    return nodes.find((node) => node.status === "running")?.id ?? null;
  }

  /** Undirected 1-hop adjacency built from the resolved edges. */
  private buildNeighbourMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const link = (a: string, b: string): void => {
      const list = map.get(a) ?? [];
      list.push(b);
      map.set(a, list);
    };
    for (const edge of this.resolveEdges()) {
      link(edge.from, edge.to);
      link(edge.to, edge.from);
    }
    return map;
  }

  /** Resolve a real node id to its rendered `.node` element, via the click anchor. */
  private findNodeElement(nodeId: string): Element | null {
    const host = this.readRenderedGraphHost();
    if (!host) return null;
    const link = (Array.from(host.querySelectorAll("a")) as Element[]).find((linkElement) => this.readNodeIdFromLink(linkElement) === nodeId);
    if (!link) return null;
    // This Mermaid build wraps the node group inside the click `<a>`, so `.node`
    // is a descendant; fall back to an ancestor for other builds.
    return link.querySelector(".node") ?? link.closest(".node");
  }

  private handleChartClick(event: MouseEvent): void {
    this.internalContextMenuTarget.set(null);
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

    const linkElement = target.closest("a");
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) {
      if (this.isBackgroundClick(target, event)) this.clearSelection();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.internalSelectedNodeId.set(nodeId);
    this.nodeSelected.emit(nodeId);
  }

  /** A click on empty graph space: inside the graph, not on a node or a control, and not the end of a drag. */
  private isBackgroundClick(target: Element, event: MouseEvent): boolean {
    if (!this.hostElement.nativeElement.contains(target)) return false;
    if (target.closest(BACKGROUND_CLICK_IGNORE_SELECTOR)) return false;
    const down = this.lastPointerDown;
    return !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) <= CLICK_MAX_TRAVEL_PX;
  }

  /** Drop the selection ring; tells the host only if something was actually selected. */
  private clearSelection(): void {
    const hadSelection = this.highlightedNodeId() !== null;
    this.internalSelectedNodeId.set(null);
    if (hadSelection) this.selectionCleared.emit();
  }

  /** Double-click a drillable node to enter its subgraph. */
  private handleChartDblClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const linkElement = target.closest("a");
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) return;
    const node = this.activeNodes().find((candidate) => candidate.id === nodeId);
    if (!node || !this.resolveSubgraph(node)) return;
    event.preventDefault();
    event.stopPropagation();
    this.enterSubgraph(node);
  }

  /** Right-click a node to resolve it and emit {@link nodeContextMenu}, suppressing the browser menu. */
  private handleChartContextMenu(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const linkElement = target.closest("a");
    const nodeId = linkElement ? this.readNodeIdFromLink(linkElement) : null;
    if (!nodeId) return;
    const node = this.activeNodes().find((candidate) => candidate.id === nodeId);
    if (!node) return;

    event.preventDefault();
    event.stopPropagation();
    this.internalContextMenuTarget.set(node);
    const viewportRect = this.viewportRef().nativeElement.getBoundingClientRect();
    this.nodeContextMenu.emit({
      nodeId,
      x: event.clientX - viewportRect.left,
      y: event.clientY - viewportRect.top,
    });
  }

  /** Dismiss the context-menu target. A host calls this from its menu's own close/action handler. */
  closeContextMenu(): void {
    this.internalContextMenuTarget.set(null);
  }

  private readNodeIdFromLink(linkElement: Element): string | null {
    const href = linkElement.getAttribute("href") ?? linkElement.getAttribute("xlink:href");
    if (!href) return null;
    try {
      const url = new URL(href, window.location.origin);
      const real = url.searchParams.get(NODE_HREF_PARAM);
      return real && this.aliasMap().toAlias.has(real) ? real : null;
    } catch {
      return null;
    }
  }

  private scheduleSelectedNodeClass(selectedId: string | null): void {
    requestAnimationFrame(() => this.applySelectedNodeClass(selectedId));
  }

  /** Defer status-class application to the next frame, after any pending render. */
  private scheduleStatusClasses(): void {
    requestAnimationFrame(() => this.applyStatusClasses());
  }

  /** Defer progress-bar application to the next frame, after any pending render. */
  private scheduleNodeProgressBars(): void {
    requestAnimationFrame(() => this.applyNodeProgressBars());
  }

  /** Defer subgraph-preview application to the next frame, after any pending render. */
  private scheduleSubgraphPreviews(): void {
    requestAnimationFrame(() => this.applySubgraphPreviews());
  }

  // ── Shape-offset overlays (selected/current outline ring, progress trace) ──
  //
  // PURPOSE: Draw the selected/current highlight and the progress indicator as
  // the node's own shape redrawn larger (an outline ring), rather than a fill
  // colour or an in-label progress bar — so they read the same way regardless
  // of whether the underlying node is a rect, diamond, or subroutine.
  //
  // VALUE: Mermaid already computed each node's exact shape when it rendered
  // the `<rect>`/`<polygon>` in `.label-container` — these helpers read that
  // geometry back out and offset it, instead of re-deriving node dimensions.

  /** Find the SVG element Mermaid drew for a node's own shape (`<rect>` for `rect`/`subroutine`-envelope purposes, `<polygon>` for `diamond`/`subroutine`). */
  private findNodeShapeElement(nodeElement: Element): SVGGraphicsElement | null {
    return nodeElement.querySelector<SVGGraphicsElement>(".label-container");
  }

  /** Reads `shapeEl`'s geometry and returns it offset outward by `offsetPx`, or null if `shapeEl` is a shape kind this library doesn't know how to offset. */
  private readOffsetGeometry(shapeEl: SVGGraphicsElement, offsetPx: number): OffsetShapeGeometry | null {
    if (shapeEl instanceof SVGRectElement) {
      const rx = shapeEl.rx?.baseVal?.value ?? 0;
      return offsetRectGeometry(shapeEl.x.baseVal.value, shapeEl.y.baseVal.value, shapeEl.width.baseVal.value, shapeEl.height.baseVal.value, rx, offsetPx);
    }
    if (shapeEl instanceof SVGPolygonElement) {
      const points = Array.from(shapeEl.points).map((point) => ({ x: point.x, y: point.y }));
      return offsetPolygonGeometry(points, offsetPx);
    }
    return null;
  }

  /** Reads `shapeEl`'s own (un-offset) bounding-box top-right corner, in the same local coordinate space {@link readOffsetGeometry} uses. */
  private readShapeTopRightCorner(shapeEl: SVGGraphicsElement): ShapePoint | null {
    const geometry = this.readOffsetGeometry(shapeEl, 0);
    if (!geometry) return null;
    if (geometry.kind === "rect") {
      return { x: geometry.x + geometry.width, y: geometry.y };
    }
    const xs = geometry.points.map((point) => point.x);
    const ys = geometry.points.map((point) => point.y);
    return { x: Math.max(...xs), y: Math.min(...ys) };
  }

  /** Reads `shapeEl`'s own (un-offset) bounding-box top-left corner, in the same local coordinate space {@link readOffsetGeometry} uses. */
  private readShapeTopLeftCorner(shapeEl: SVGGraphicsElement): ShapePoint | null {
    const geometry = this.readOffsetGeometry(shapeEl, 0);
    if (!geometry) return null;
    if (geometry.kind === "rect") {
      return { x: geometry.x, y: geometry.y };
    }
    const xs = geometry.points.map((point) => point.x);
    const ys = geometry.points.map((point) => point.y);
    return { x: Math.min(...xs), y: Math.min(...ys) };
  }

  /**
   * Creates or updates a `cssClass`-marked `<rect>`/`<polygon>` sibling inside
   * `nodeElement`, tracing the node's own shape offset outward by `offsetPx`.
   *
   * VALUE: Reuses `shapeEl`'s own `transform` attribute (rather than reading
   * ancestor transforms) so the overlay lands in the same screen position
   * regardless of whether Mermaid put the positioning transform on the shape
   * element itself (as it does for `diamond`) or left it on an ancestor group
   * (as it does for `rect`) — copying "whatever transform the shape already
   * has" is correct either way.
   */
  private applyShapeOutlineOverlay(nodeElement: Element, cssClass: string, offsetPx: number): void {
    const existing = nodeElement.querySelector<SVGGraphicsElement>(`:scope > .${cssClass}`);
    const shapeEl = this.findNodeShapeElement(nodeElement);
    const geometry = shapeEl ? this.readOffsetGeometry(shapeEl, offsetPx) : null;
    if (!shapeEl || !geometry) {
      existing?.remove();
      return;
    }

    const tag = geometry.kind === "rect" ? "rect" : "polygon";
    let overlay = existing;
    if (!overlay || overlay.tagName.toLowerCase() !== tag) {
      existing?.remove();
      overlay = document.createElementNS(SVG_NAMESPACE, tag) as SVGGraphicsElement;
      overlay.classList.add(cssClass, NODE_DECORATION_CLASS);
      overlay.setAttribute("fill", "none");
      overlay.setAttribute("pointer-events", "none");
      nodeElement.appendChild(overlay);
    }

    const transform = shapeEl.getAttribute("transform");
    if (transform) overlay.setAttribute("transform", transform);
    else overlay.removeAttribute("transform");

    if (geometry.kind === "rect") {
      overlay.setAttribute("x", String(geometry.x));
      overlay.setAttribute("y", String(geometry.y));
      overlay.setAttribute("width", String(geometry.width));
      overlay.setAttribute("height", String(geometry.height));
      if (geometry.rx) overlay.setAttribute("rx", String(geometry.rx));
      else overlay.removeAttribute("rx");
    } else {
      overlay.setAttribute("points", geometry.points.map((point) => `${point.x},${point.y}`).join(" "));
    }
  }

  /** Removes a previously-applied {@link applyShapeOutlineOverlay} ring, if present. */
  private removeShapeOutlineOverlay(nodeElement: Element, cssClass: string): void {
    nodeElement.querySelector(`:scope > .${cssClass}`)?.remove();
  }

  /**
   * Creates, updates, or removes a drillable node's corner badge: a small
   * circle-plus-cross glyph centred on the node shape's own top-right corner.
   *
   * VALUE: Replaces a dashed outline as the "this node opens a subgraph" cue,
   * so the node's own border can stay solid while the badge alone carries
   * that meaning (see graph-canvas.component.scss).
   */
  private applySubgraphBadge(nodeElement: Element, hasSubgraph: boolean): void {
    const existing = nodeElement.querySelector<SVGGElement>(`:scope > .${SUBGRAPH_BADGE_CLASS}`);
    const shapeEl = hasSubgraph ? this.findNodeShapeElement(nodeElement) : null;
    const corner = shapeEl ? this.readShapeTopRightCorner(shapeEl) : null;
    if (!corner) {
      existing?.remove();
      return;
    }

    let group = existing;
    if (!group) {
      group = document.createElementNS(SVG_NAMESPACE, "g") as SVGGElement;
      group.classList.add(SUBGRAPH_BADGE_CLASS, NODE_DECORATION_CLASS);
      group.setAttribute("pointer-events", "none");
      group.appendChild(document.createElementNS(SVG_NAMESPACE, "circle"));
      group.appendChild(document.createElementNS(SVG_NAMESPACE, "line"));
      group.appendChild(document.createElementNS(SVG_NAMESPACE, "line"));
      nodeElement.appendChild(group);
    }

    const transform = shapeEl!.getAttribute("transform");
    if (transform) group.setAttribute("transform", transform);
    else group.removeAttribute("transform");

    const circle = group.querySelector("circle")!;
    circle.setAttribute("cx", String(corner.x));
    circle.setAttribute("cy", String(corner.y));
    circle.setAttribute("r", String(SUBGRAPH_BADGE_RADIUS_PX));

    const [vertical, horizontal] = Array.from(group.querySelectorAll("line"));
    const armLength = SUBGRAPH_BADGE_RADIUS_PX * 0.5;
    vertical.setAttribute("x1", String(corner.x));
    vertical.setAttribute("y1", String(corner.y - armLength));
    vertical.setAttribute("x2", String(corner.x));
    vertical.setAttribute("y2", String(corner.y + armLength));
    horizontal.setAttribute("x1", String(corner.x - armLength));
    horizontal.setAttribute("y1", String(corner.y));
    horizontal.setAttribute("x2", String(corner.x + armLength));
    horizontal.setAttribute("y2", String(corner.y));
  }

  /**
   * Creates, updates, or removes a host-supplied `NodeDecoration.badge`: a
   * small circle centred on one of the node shape's own corners.
   *
   * VALUE: The library only knows how to draw and position the dot — what it
   * means (a live LLM call, a stale cache, a pending review, ...) is entirely
   * up to the host via `badge.color`/`badge.pulse`, so this stays reusable
   * instead of growing a new boolean+method pair per host use case.
   */
  private applyNodeBadge(nodeElement: Element, badge: MermaidRuntime.NodeBadge | undefined): void {
    const existing = nodeElement.querySelector<SVGCircleElement>(`:scope > .${NODE_BADGE_CLASS}`);
    const shapeEl = badge ? this.findNodeShapeElement(nodeElement) : null;
    const corner = shapeEl
      ? badge!.position === "topLeft"
        ? this.readShapeTopLeftCorner(shapeEl)
        : this.readShapeTopRightCorner(shapeEl)
      : null;
    if (!badge || !corner) {
      existing?.remove();
      return;
    }

    let circle = existing;
    if (!circle) {
      circle = document.createElementNS(SVG_NAMESPACE, "circle") as SVGCircleElement;
      circle.classList.add(NODE_BADGE_CLASS, NODE_DECORATION_CLASS);
      circle.setAttribute("pointer-events", "none");
      circle.setAttribute("r", String(NODE_BADGE_RADIUS_PX));
      nodeElement.appendChild(circle);
    }
    circle.classList.toggle(NODE_BADGE_PULSE_CLASS, !!badge.pulse);
    circle.style.fill = badge.color ?? "";

    const transform = shapeEl!.getAttribute("transform");
    if (transform) circle.setAttribute("transform", transform);
    else circle.removeAttribute("transform");

    circle.setAttribute("cx", String(corner.x));
    circle.setAttribute("cy", String(corner.y));
  }

  /**
   * Creates, updates, or removes a node's progress trace: a `<path>` tracing
   * its shape (offset outward by {@link NODE_PROGRESS_TRACE_OFFSET_PX}),
   * revealed clockwise from its topmost point via `stroke-dasharray`/
   * `stroke-dashoffset`, and one fainter ring per running child further out. The
   * percentage and time are written by {@link applyNodeReadout}.
   *
   * Callers pass only what should be drawn (see selectVisibleNodeProgress);
   * a null `progressPercent` with no child rings removes every ring.
   */
  private applyProgressTraceOverlay(nodeElement: Element, progressPercent: number | null, childPercents: readonly number[]): void {
    const existingPaths = Array.from(nodeElement.querySelectorAll<SVGPathElement>(`:scope > .${PROGRESS_TRACE_CLASS}`));

    const hasProgress = progressPercent !== null || childPercents.length > 0;
    const shapeEl = hasProgress ? this.findNodeShapeElement(nodeElement) : null;

    if (!hasProgress || !shapeEl) {
      existingPaths.forEach((p) => p.remove());
      return;
    }

    const transform = shapeEl.getAttribute("transform");

    // Gather all progress rings to render: the overall ring first, then one per running child.
    const allPercents: { percent: number; isChild: boolean; offset: number }[] = [];
    if (progressPercent !== null) {
      allPercents.push({
        percent: progressPercent,
        isChild: false,
        offset: NODE_PROGRESS_TRACE_OFFSET_PX,
      });
    }

    childPercents.forEach((percent) => {
      allPercents.push({
        percent,
        isChild: true,
        offset: NODE_PROGRESS_TRACE_OFFSET_PX + allPercents.length * NODE_PROGRESS_STACK_OFFSET_PX,
      });
    });

    // Ensure we have exactly allPercents.length path elements
    const paths: SVGPathElement[] = [];
    for (let i = 0; i < allPercents.length; i++) {
      let path = existingPaths[i];
      if (!path) {
        path = document.createElementNS(SVG_NAMESPACE, "path") as SVGPathElement;
        path.classList.add(PROGRESS_TRACE_CLASS, NODE_DECORATION_CLASS);
        path.setAttribute("fill", "none");
        path.setAttribute("pointer-events", "none");
        nodeElement.appendChild(path);
      }
      paths.push(path);
    }
    // Remove excess paths
    for (let i = allPercents.length; i < existingPaths.length; i++) {
      existingPaths[i].remove();
    }

    // Apply values to each path
    for (let i = 0; i < allPercents.length; i++) {
      const config = allPercents[i];
      const path = paths[i];
      const geometry = this.readOffsetGeometry(shapeEl, config.offset);
      if (!geometry) continue;

      if (transform) path.setAttribute("transform", transform);
      else path.removeAttribute("transform");

      path.setAttribute("d", buildTopStartOutlinePath(geometry));
      const pathLength = computeOutlinePerimeterLength(geometry);
      path.style.strokeDasharray = `${pathLength}`;
      path.style.strokeDashoffset = `${pathLength * (1 - config.percent / 100)}`;
      path.classList.toggle(PROGRESS_TRACE_CHILD_CLASS, config.isChild);
    }
  }

  /**
   * Apply each node's status colour and the live "current" highlight directly to
   * its rendered `.node` element, replacing the previous classes.
   *
   * PURPOSE: Reflect execution progress without regenerating the Mermaid source.
   *
   * VALUE: The SVG stays put across status updates — no teardown/rebuild — so the
   * camera measures a stable layout and node label sizing never jumps.
   */
  private applyStatusClasses(): void {
    const nowMs = Date.now();
    const currentId = this.currentNodeId();
    const suppressLivePulses = this.replayActive();
    const styles = this.effectiveStatusStyles();
    const stripClasses = [...this.statusClassNames(), CURRENT_NODE_CLASS, HAS_SUBGRAPH_CLASS];

    if (suppressLivePulses) {
      this.clearEdgePulseClasses();
    }

    // Clean up stale nodes from previousStatuses map (e.g. after subgraph navigation)
    const activeIds = new Set(this.activeNodes().map((n) => n.id));
    for (const key of this.previousStatuses.keys()) {
      if (!activeIds.has(key)) {
        this.previousStatuses.delete(key);
      }
    }

    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      element.classList.remove(...stripClasses);
      const statusClass = styles[node.status]?.className;
      if (statusClass) element.classList.add(statusClass);
      if (node.id === currentId) {
        element.classList.add(CURRENT_NODE_CLASS);
        this.applyShapeOutlineOverlay(element, CURRENT_OUTLINE_CLASS, NODE_OUTLINE_OFFSET_PX);
      } else {
        this.removeShapeOutlineOverlay(element, CURRENT_OUTLINE_CLASS);
      }
      const hasSubgraph = !!this.resolveSubgraph(node);
      if (hasSubgraph) element.classList.add(HAS_SUBGRAPH_CLASS);
      this.applySubgraphBadge(element, hasSubgraph);
      this.applyNodeBadge(element, this.decorations()[node.id]?.badge);
      this.applyNodeIcon(element, resolveNodeStyle(node, this.decorations()[node.id], this.nodeKinds()).icon);
      this.applyNodeReadout(element, node, nowMs);
      this.applyFarLabel(element, node, nowMs);

      // Detect transitions and trigger the generic pulse animations
      const prevStatus = this.previousStatuses.get(node.id);
      if (!suppressLivePulses && prevStatus !== undefined && prevStatus !== node.status) {
        if (statusClass) {
          this.triggerNodePulse(node.id);
          this.triggerIncomingEdgesPulse(node.id, statusClass);
        }
      }
      this.previousStatuses.set(node.id, node.status);
    }
    this.applyGroupTimes(nowMs);
    // Keep connection lines styled based on target node states
    this.applyEdgeStatusClasses();
  }

  /**
   * Temporarily thickens the node border outline.
   *
   * VALUE: Provides immediate visual feedback to the human operator that a specific
   * node has transitioned status (e.g. finished running or encountered an error).
   */
  private triggerNodePulse(nodeId: string): void {
    const element = this.findNodeElement(nodeId);
    if (!element) return;

    element.classList.add("pulse-active");
    setTimeout(() => element.classList.remove("pulse-active"), NODE_PULSE_DURATION_MS);
  }

  /**
   * Temporarily animates incoming connections as dashed marching ants.
   *
   * VALUE: Visually represents active flow transitions, making it clear to the operator
   * which path triggered the newly active node.
   */
  private triggerIncomingEdgesPulse(nodeId: string, statusClass: string): void {
    const { toAlias } = this.aliasMap();
    const pulseClass = `edge-pulse--${statusClass}`;
    const nodes = this.activeNodes();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    for (const edge of this.resolveEdges()) {
      if (edge.to !== nodeId) continue;

      if (!this.isEdgeActive(edge, nodeMap)) continue;

      const parentAlias = toAlias.get(edge.from);
      const childAlias = toAlias.get(edge.to);
      if (!parentAlias || !childAlias) continue;

      const edgeEl = this.findEdgeElement(parentAlias, childAlias);
      if (!edgeEl) continue;

      edgeEl.classList.add(pulseClass);
      setTimeout(() => edgeEl.classList.remove(pulseClass), EDGE_PULSE_DURATION_MS);
    }
  }

  /**
   * Applies status class modifiers to connection lines leading to nodes.
   *
   * VALUE: Styles traversed connection lines based on target node outcomes (e.g., solid
   * green for complete, solid red for failed), highlighting the execution path.
   */
  private applyEdgeStatusClasses(): void {
    const { toAlias } = this.aliasMap();
    const host = this.readRenderedGraphHost();
    if (!host) return;
    const styles = this.effectiveStatusStyles();
    const nodes = this.activeNodes();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const suppressRunningEdgeAnimation = this.replayActive();

    // Clean up any old edge status classes first from the flowchart link paths
    for (const edgeEl of Array.from(host.querySelectorAll(".flowchart-link"))) {
      const toRemove: string[] = [];
      for (let i = 0; i < edgeEl.classList.length; i++) {
        const cls = edgeEl.classList[i];
        if (cls.startsWith("edge-status--")) {
          toRemove.push(cls);
        }
      }
      if (toRemove.length > 0) {
        edgeEl.classList.remove(...toRemove);
      }
    }

    for (const edge of this.resolveEdges()) {
      const parentAlias = toAlias.get(edge.from);
      const childAlias = toAlias.get(edge.to);
      if (!parentAlias || !childAlias) continue;

      const childNode = nodeMap.get(edge.to);
      if (!childNode) continue;

      if (this.isEdgeActive(edge, nodeMap)) {
        const edgeEl = this.findEdgeElement(parentAlias, childAlias);
        if (!edgeEl) continue;

        const statusClass = styles[childNode.status]?.className;
        if (statusClass && !(suppressRunningEdgeAnimation && childNode.status === "running")) {
          edgeEl.classList.add(`edge-status--${statusClass}`);
        }
      }
    }
  }

  /**
   * Determine if a connection line should be visually colored/animated based on execution.
   *
   * VALUE: Prevents loop paths from highlighting prematurely, handles failed node recovery pathing,
   * and preserves parallel join animations using endedAt/startedAt timestamps.
   */
  private isEdgeActive(edge: GraphEdge, nodeMap: Map<string, MermaidRuntime.Node>): boolean {
    const parentNode = nodeMap.get(edge.from);
    const childNode = nodeMap.get(edge.to);
    if (!parentNode || !childNode) return false;

    // 1. Parent must have executed (not undone/skipped/running)
    const isParentExecuted = parentNode.status !== "undone" && parentNode.status !== "skipped" && parentNode.status !== "running";
    if (!isParentExecuted) return false;

    // 2. Child must be active/completed (not undone/skipped)
    if (childNode.status === "undone" || childNode.status === "skipped") return false;

    // 3. Resolve multi-parent connections using execution timestamps
    if (childNode.startedAt) {
      const childStart = Date.parse(childNode.startedAt);
      if (!isNaN(childStart)) {
        const candidates: { id: string; endTime: number }[] = [];
        const edges = this.resolveEdges();
        for (const e of edges) {
          if (e.to !== childNode.id) continue;
          const p = nodeMap.get(e.from);
          if (p && p.endedAt) {
            const pEnd = Date.parse(p.endedAt);
            if (!isNaN(pEnd) && pEnd <= childStart) {
              candidates.push({ id: p.id, endTime: pEnd });
            }
          }
        }

        if (candidates.length > 1) {
          const maxEndTime = Math.max(...candidates.map((c) => c.endTime));
          const parentCandidate = candidates.find((c) => c.id === parentNode.id);
          if (parentCandidate) {
            // Active if it is the closest parent OR completed within parallel join threshold
            const diff = maxEndTime - parentCandidate.endTime;
            return diff <= PARALLEL_JOIN_THRESHOLD_MS;
          }
        }
      }
    }

    return true;
  }

  /**
   * Find a rendered Mermaid edge path element in the DOM.
   *
   * VALUE: Direct query targeting of path elements via data-id and id attributes, bypassing
   * Mermaid's auto-generated unique ID suffixes.
   */
  private findEdgeElement(parentAlias: string, childAlias: string): Element | null {
    const host = this.readRenderedGraphHost();
    if (!host) return null;
    return host.querySelector(`[data-id^="L_${parentAlias}_${childAlias}_"]`) ?? host.querySelector(`[id*="-L_${parentAlias}_${childAlias}_"]`) ?? null;
  }

  /**
   * Apply each node's progress directly to the rendered Mermaid label.
   *
   * PURPOSE: Show live 0-100% node progress without changing the Mermaid source.
   *
   * VALUE: Progress ticks update the bar in place, keeping the camera and
   * selected node stable while long-running work advances.
   */
  private applyNodeProgressBars(): void {
    const visibility = this.progressRings();
    const showChildRings = this.childProgressRings();
    const nowMs = Date.now();
    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      if (!element) continue;
      const childPercents = (node.activeChildNodeProgresses ?? [])
        .map((percent) => this.readNodeProgressPercent(percent))
        .filter((percent): percent is number => percent !== null);
      const visible = selectVisibleNodeProgress(node.status, this.readNodeProgressPercent(node.progressPercent), childPercents, visibility, showChildRings);
      this.applyProgressTraceOverlay(element, visible.percent, visible.childPercents);
      this.applyNodeReadout(element, node, nowMs);
      this.applyFarLabel(element, node, nowMs);
    }
  }

  /**
   * Applies the `selected` class and its outline overlay to `selectedId`'s
   * node, removing both from any other node.
   *
   * VALUE: Leaves the already-selected node's overlay untouched when called
   * again with the same id (e.g. from `onChartMutation`, which calls this
   * unconditionally on every mutation) — appending/removing an SVG element is
   * a `childList` mutation the observer can't attribute to the child that
   * moved (its `target` is the parent `.node` group, not the overlay), so an
   * unconditional destroy-then-recreate here would re-trigger the observer on
   * every one of its own passes: an infinite mutate → observe → mutate loop
   * that freezes the tab.
   */
  private applySelectedNodeClass(selectedId: string | null): void {
    const host = this.readRenderedGraphHost();
    if (!host) return;
    const selectedLink = selectedId ? (Array.from(host.querySelectorAll("a")) as Element[]).find((linkElement) => this.readNodeIdFromLink(linkElement) === selectedId) : undefined;
    const selectedNode = selectedLink?.querySelector(".node") ?? selectedLink?.closest(".node") ?? null;

    for (const nodeElement of Array.from(host.querySelectorAll(".node.selected"))) {
      if (nodeElement === selectedNode) continue;
      nodeElement.classList.remove("selected");
      this.removeShapeOutlineOverlay(nodeElement, SELECTED_OUTLINE_CLASS);
    }
    if (!selectedNode) return;

    selectedNode.classList.add("selected");
    this.applyShapeOutlineOverlay(selectedNode, SELECTED_OUTLINE_CLASS, NODE_OUTLINE_OFFSET_PX);
  }

  // ── Subgraph inline preview ───────────────────────────────────────

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
  private applySubgraphPreviews(): void {
    if (!this.showSubgraphPreview()) {
      this.removeSubgraphPreviews();
      return;
    }

    const activeNodeIds = new Set(this.activeNodes().map((n) => n.id));

    // Cleanup hashes for nodes that are no longer active
    for (const nodeId of Array.from(this.subgraphStructureHashes.keys())) {
      if (!activeNodeIds.has(nodeId)) {
        this.subgraphStructureHashes.delete(nodeId);
      }
    }

    for (const node of this.activeNodes()) {
      const element = this.findNodeElement(node.id);
      const label = element?.querySelector(".nodeLabel") ?? element?.querySelector("span");
      if (!element || !label) {
        this.subgraphStructureHashes.delete(node.id);
        continue;
      }

      const graph = this.resolveSubgraph(node);
      if (!graph) {
        label.querySelector(".task-graph-node-subgraph-preview")?.remove();
        this.subgraphStructureHashes.delete(node.id);
        continue;
      }

      const structHash = hashPreviewStructure(graph);
      const statusHash = hashPreviewStatuses(graph);
      const combinedHash = `${structHash}::${statusHash}`;

      let wrap = label.querySelector(".task-graph-node-subgraph-preview") as HTMLElement;
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.classList.add("task-graph-node-subgraph-preview");
        label.append(wrap);
      }

      // If the structure or status changed, we render/update
      const lastHash = this.subgraphStructureHashes.get(node.id);
      if (lastHash !== combinedHash) {
        this.subgraphStructureHashes.set(node.id, combinedHash);
        this.renderSubgraphMermaid(node.id, graph, wrap);
      }
    }
  }

  /** Strip every injected subgraph thumbnail (toggle off). */
  private removeSubgraphPreviews(): void {
    this.subgraphStructureHashes.clear();
    for (const preview of Array.from(this.readRenderedGraphHost()?.querySelectorAll(".task-graph-node-subgraph-preview") ?? [])) {
      preview.remove();
    }
  }

  private renderSubgraphMermaid(nodeId: string, graph: MermaidRuntime.Graph, wrap: HTMLElement): void {
    const aliasByNodeId = new Map<string, string>();
    graph.nodes.forEach((node, index) => aliasByNodeId.set(node.id, `n${index}`));

    const edges = resolvePreviewEdges(graph);
    const lines = [
      `flowchart TD`,
      ...graph.nodes.map((node) => `  ${aliasByNodeId.get(node.id)}((" "))`),
      ...edges
        .map((edge) => {
          const from = aliasByNodeId.get(edge.from);
          const to = aliasByNodeId.get(edge.to);
          return from && to ? `  ${from} --> ${to}` : null;
        })
        .filter((line): line is string => line !== null),
    ];
    const source = lines.join("\n");

    const renderId = `mr-sg-preview-${nodeId.replace(/[^a-zA-Z0-9-]/g, "")}-${Math.random().toString(36).substring(2, 9)}`;
    const config: MermaidRuntimeConfig = {
      ...this.mermaidOptions(),
      flowchart: {
        ...this.mermaidOptions().flowchart,
        htmlLabels: false,
        useMaxWidth: true,
        rankSpacing: 16,
        nodeSpacing: 16,
        curve: "basis",
      },
    };

    ensureMermaidConfigured(config);
    ensureMermaidTemporaryRenderIsolation(this.hostElement.nativeElement.ownerDocument);
    mermaid
      .render(renderId, source)
      .then((result: { svg: string }) => {
        // Check if this node is still active and this render is still the current hash
        if (this.subgraphStructureHashes.has(nodeId)) {
          wrap.innerHTML = `<div class="gp-simple-root">${result.svg}</div>`;
          this.applySubgraphStatusClasses(nodeId, graph, aliasByNodeId, wrap);
        }
      })
      .catch((err: unknown) => {
        console.error("Failed to render subgraph preview", err);
      });
  }

  private applySubgraphStatusClasses(nodeId: string, graph: MermaidRuntime.Graph, aliasByNodeId: Map<string, string>, wrap: HTMLElement): void {
    const styles = this.effectiveStatusStyles();
    for (const node of graph.nodes) {
      const alias = aliasByNodeId.get(node.id);
      if (!alias) continue;
      const element = wrap.querySelector(`.node[id^="${alias}-"]`);
      if (!element) continue;

      const statusClassNames = Object.values(styles)
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => s.className);
      element.classList.remove(...statusClassNames);

      const statusClass = resolvePreviewStatusClass(node.status, styles);
      if (statusClass) element.classList.add(statusClass);
    }
  }

  // ── Subgraph navigation ─────────────────────────────────────────

  /** Resolve a node's child graph via the host resolver, else its inline graph. */
  private resolveSubgraph(node: MermaidRuntime.Node): MermaidRuntime.Graph | null {
    const resolver = this.subgraphResolver();
    return (resolver ? resolver(node) : null) ?? node.subgraph ?? null;
  }

  /** Drill into a node's subgraph, pushing one level onto the stack. */
  enterSubgraph(node: MermaidRuntime.Node): void {
    const graph = this.resolveSubgraph(node);
    if (!graph) return;
    const frame: GraphFrame = {
      nodeId: node.id,
      label: node.subgraphLabel ?? node.title,
      graph,
    };
    const next = [...this.graphStack(), frame];
    this.graphStack.set(next);
    this.onNavigated(next, "enter");
  }

  /** Enter the currently-selected node's subgraph (inspector affordance). */
  enterSelectedSubgraph(): void {
    const node = this.selectedNode();
    if (node) this.enterSubgraph(node);
  }

  /** Pop the stack back to `depth` (0 = root). Backs the breadcrumb crumbs. */
  goToDepth(depth: number): void {
    if (depth >= this.graphStack().length) return;
    const next = this.graphStack().slice(0, depth);
    this.graphStack.set(next);
    this.onNavigated(next, "leave");
  }

  /** Leave the current subgraph, one level up. */
  leaveSubgraph(): void {
    this.goToDepth(Math.max(0, this.graphStack().length - 1));
  }

  /**
   * Shared after-navigation bookkeeping.
   *
   * PURPOSE: Reset per-level selection, re-fit the new level, and tell the host
   * where we are via the nav outputs.
   *
   * VALUE: Enter, leave, and breadcrumb jumps all emit one consistent path so the
   * host's history stays in lockstep with the viewer.
   */
  private onNavigated(stack: GraphFrame[], direction: "enter" | "leave"): void {
    this.internalSelectedNodeId.set(null);
    this.internalContextMenuTarget.set(null);
    this.hasFitInitialView = false;
    const top = stack[stack.length - 1] ?? null;
    const path = stack.map((frame) => frame.nodeId);
    const event: SubgraphNavEvent = {
      path,
      nodeId: top?.nodeId ?? null,
      label: top?.label ?? null,
    };
    if (direction === "enter") this.subgraphEntered.emit(event);
    else this.subgraphLeft.emit(event);
    this.graphPathChange.emit(path);
  }

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
  private reconcileStackToPath(desired: readonly string[]): void {
    const current = untracked(() => this.graphStack()).map((frame) => frame.nodeId);
    if (this.samePath(current, desired)) return;

    const frames: GraphFrame[] = [];
    let nodes = untracked(() => this.nodes());
    for (const nodeId of desired) {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) break;
      const graph = this.resolveSubgraph(node);
      if (!graph) break;
      frames.push({ nodeId, label: node.subgraphLabel ?? node.title, graph });
      nodes = graph.nodes;
    }
    this.graphStack.set(frames);
    this.internalSelectedNodeId.set(null);
    this.hasFitInitialView = false;
  }

  /** Shallow ordered equality for two node-id paths. */
  private samePath(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  /**
   * Remove transient live execution pulse classes from Mermaid edge paths.
   *
   * PURPOSE: Replay owns its own overlay animation and should not reuse the live
   * execution pulse classes.
   *
   * VALUE: The base graph lines remain stable while replay paints a separate
   * current-event trace above them.
   */
  private clearEdgePulseClasses(): void {
    const host = this.readRenderedGraphHost();
    if (!host) return;
    for (const edgeEl of Array.from(host.querySelectorAll(".flowchart-link"))) {
      const toRemove: string[] = [];
      for (let i = 0; i < edgeEl.classList.length; i++) {
        const cls = edgeEl.classList[i];
        if (cls.startsWith("edge-pulse--")) {
          toRemove.push(cls);
        }
      }
      if (toRemove.length > 0) {
        edgeEl.classList.remove(...toRemove);
      }
    }
  }

  /**
   * Schedule the visual for the current replay event after DOM status updates land.
   *
   * PURPOSE: Replay animation is event-driven, so each tick paints exactly one
   * node flash or edge trace.
   *
   * VALUE: The completed graph never enters an all-animated final state, and the
   * overlay follows the recorded sequence including loops and parallel branches.
   */
  private scheduleReplayEventAnimation(replayActive: boolean, replayEvent: MermaidRuntime.ExecutionEvent | null): void {
    if (!replayActive) {
      this.lastReplayEventKey = null;
      this.clearReplayAnimationFrame();
      this.clearReplayEventVisuals();
      return;
    }

    const eventKey = replayEvent ? this.buildReplayEventKey(replayEvent) : null;
    if (eventKey === this.lastReplayEventKey) return;
    this.lastReplayEventKey = eventKey;

    this.clearReplayAnimationFrame();
    this.clearReplayEventVisuals();
    if (!replayEvent) return;

    this.replayAnimationFrame = requestAnimationFrame(() => {
      this.replayAnimationFrame = null;
      this.playReplayEventAnimation(replayEvent);
    });
  }

  /**
   * Build a stable identity for one replay event.
   *
   * PURPOSE: Avoid repainting the same event when unrelated signal effects run.
   *
   * VALUE: Replay visuals advance once per timeline sequence entry.
   */
  private buildReplayEventKey(event: MermaidRuntime.ExecutionEvent): string {
    return `${event.seq}:${event.kind}:${event.nodeId ?? ""}:${event.edgeId ?? ""}`;
  }

  /**
   * Paint the visual for the current replay event.
   *
   * PURPOSE: Route each timeline event kind to its matching one-shot animation.
   *
   * VALUE: Node events flash nodes; edge traversal events draw a temporary trace
   * over Mermaid's exact edge path.
   */
  private playReplayEventAnimation(event: MermaidRuntime.ExecutionEvent): void {
    if (event.kind === "node-started" && event.nodeId) {
      this.flashReplayNode(event.nodeId);
    } else if (event.kind === "edge-traversed") {
      const edge = this.resolveReplayEdge(event);
      if (edge) this.traceReplayEdge(edge);
    }

    this.replayAnimationTimer = setTimeout(() => this.clearReplayEventVisuals(), REPLAY_EVENT_CLEAR_DELAY_MS);
  }

  /**
   * Resolve a replay event's edge from its stable graph-execution edge id.
   *
   * PURPOSE: Decode the daemon's `kind:from:to[:label]` edge identity without
   * relying on final node state.
   *
   * VALUE: Loop backs, repeated traversals, and parallel branches animate in the
   * exact order they were recorded.
   */
  private resolveReplayEdge(event: MermaidRuntime.ExecutionEvent): GraphEdge | null {
    const edgeId = event.edgeId;
    if (!edgeId) return null;

    const parts = edgeId.split(":");
    if (parts.length < GRAPH_EDGE_ID_MIN_PARTS) return null;

    const from = parts[GRAPH_EDGE_ID_FROM_INDEX];
    const to = parts[GRAPH_EDGE_ID_TO_INDEX];
    if (!from || !to) return null;

    return { from, to };
  }

  /**
   * Flash one node for the active replay event.
   *
   * PURPOSE: Give node execution a short surface-sheen effect without changing
   * the node's persistent status styling.
   *
   * VALUE: Replay reads as a sequence of current events rather than a completed
   * graph blinking forever.
   */
  private flashReplayNode(nodeId: string): void {
    const element = this.findNodeElement(nodeId);
    if (!element) return;

    element.classList.remove(REPLAY_NODE_FLASH_CLASS);
    void (element as HTMLElement).offsetWidth;
    element.classList.add(REPLAY_NODE_FLASH_CLASS);
    setTimeout(() => element.classList.remove(REPLAY_NODE_FLASH_CLASS), REPLAY_NODE_FLASH_DURATION_MS);
  }

  /**
   * Draw a temporary trace over the current replay edge.
   *
   * PURPOSE: Reuse Mermaid's own edge route instead of reconstructing geometry
   * from node positions.
   *
   * VALUE: The replay path follows the exact rendered connector and avoids the
   * top-left origin collapse caused by assembled SVG path data.
   */
  private traceReplayEdge(edge: GraphEdge): void {
    const { toAlias } = this.aliasMap();
    const parentAlias = toAlias.get(edge.from);
    const childAlias = toAlias.get(edge.to);
    if (!parentAlias || !childAlias) return;

    const edgeElement = this.findEdgeElement(parentAlias, childAlias);
    const pathElement = this.findEdgePathElement(edgeElement);
    const pathData = pathElement?.getAttribute("d");
    const overlayGroup = this.getReplayOverlayGroup();
    if (!pathData || !overlayGroup) return;

    const tracePath = document.createElementNS(SVG_NAMESPACE, "path");
    tracePath.setAttribute("d", pathData);
    tracePath.setAttribute("pathLength", REPLAY_EDGE_TRACE_PATH_LENGTH);
    tracePath.classList.add(REPLAY_EDGE_TRACE_CLASS);
    overlayGroup.append(tracePath);
  }

  /**
   * Resolve the actual SVG path inside a Mermaid edge element.
   *
   * PURPOSE: Mermaid may return either the path itself or a wrapper, depending on
   * render version and selector match.
   *
   * VALUE: Replay tracing always copies from the real connector path.
   */
  private findEdgePathElement(edgeElement: Element | null): SVGPathElement | null {
    if (edgeElement instanceof SVGPathElement) return edgeElement;
    const childPath = edgeElement?.querySelector("path");
    return childPath instanceof SVGPathElement ? childPath : null;
  }

  /**
   * Get or create the replay overlay group inside Mermaid's SVG.
   *
   * PURPOSE: Keep transient replay paths in the same SVG coordinate space as the
   * rendered graph.
   *
   * VALUE: Cloned edge path data lands on top of the graph without touching the
   * original Mermaid edge elements.
   */
  private getReplayOverlayGroup(): SVGGElement | null {
    const svgElement = this.readRenderedGraphHost()?.querySelector("svg");
    if (!(svgElement instanceof SVGSVGElement)) return null;

    const existing = svgElement.querySelector(`.${REPLAY_ANIMATION_OVERLAY_CLASS}`);
    if (existing instanceof SVGGElement) return existing;

    const overlayGroup = document.createElementNS(SVG_NAMESPACE, "g");
    overlayGroup.classList.add(REPLAY_ANIMATION_OVERLAY_CLASS);
    const rootGroup = svgElement.querySelector("g.output") ?? svgElement.querySelector("g") ?? svgElement;
    rootGroup.append(overlayGroup);
    return overlayGroup;
  }

  /**
   * Remove current replay event visuals from the graph.
   *
   * PURPOSE: Ensure each replay step starts from a clean overlay.
   *
   * VALUE: Only the active timeline event animates; previous traces do not build
   * up or leave the main graph altered.
   */
  private clearReplayEventVisuals(): void {
    this.clearReplayAnimationTimer();
    this.clearReplayAnimationOverlay();
    for (const nodeElement of Array.from(this.readRenderedGraphHost()?.querySelectorAll(`.node.${REPLAY_NODE_FLASH_CLASS}`) ?? [])) {
      nodeElement.classList.remove(REPLAY_NODE_FLASH_CLASS);
    }
  }

  /**
   * Remove the replay SVG overlay group.
   *
   * PURPOSE: Clean up transient paths without touching Mermaid's generated graph.
   *
   * VALUE: Replay can stop or advance without leaving extra SVG elements behind.
   */
  private clearReplayAnimationOverlay(): void {
    this.readRenderedGraphHost()?.querySelector(`.${REPLAY_ANIMATION_OVERLAY_CLASS}`)?.remove();
  }

  /**
   * Cancel a queued replay animation frame.
   *
   * PURPOSE: Prevent stale event animations from painting after replay stops or
   * a newer event arrives.
   *
   * VALUE: Fast scrubbing cannot paint an out-of-date node or edge after the
   * selected sequence changes.
   */
  private clearReplayAnimationFrame(): void {
    if (this.replayAnimationFrame === null) return;
    cancelAnimationFrame(this.replayAnimationFrame);
    this.replayAnimationFrame = null;
  }

  /**
   * Clear the replay visual cleanup timer.
   *
   * PURPOSE: Avoid overlapping cleanup timers while the user scrubs quickly.
   *
   * VALUE: The latest replay event controls the overlay lifecycle.
   */
  private clearReplayAnimationTimer(): void {
    if (this.replayAnimationTimer === null) return;
    clearTimeout(this.replayAnimationTimer);
    this.replayAnimationTimer = null;
  }
}
