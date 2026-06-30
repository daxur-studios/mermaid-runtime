import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { from } from 'rxjs';

import { MermaidRuntime } from '../task-graph-model';
import { TASK_GRAPH_REF_LOADER } from '../task-graph-ref-loader';

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
 * Number of milliseconds the "Copied!" confirmation stays visible.
 *
 * VALUE: Long enough to read, short enough not to linger past the next action.
 */
const COPY_FEEDBACK_DURATION_MS = 2000;

/**
 * JSON indentation used in node-ref previews.
 *
 * Value: Structured context snapshots stay readable in the compact inspector
 * without hiding a bare formatting number.
 */
const TASK_RUN_REF_JSON_INDENT_SPACES = 2;

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
@Component({
  selector: 'app-graph-inspector',
  templateUrl: './graph-inspector.component.html',
  styleUrl: './graph-inspector.component.scss',
  host: { class: 'app-graph-inspector' },
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphInspectorComponent {
  private readonly destroyRef = inject(DestroyRef);
  /** Host-supplied loader for node-ref previews; absent when no inspector backend. */
  private readonly refLoader = inject(TASK_GRAPH_REF_LOADER, { optional: true });

  /** The node to inspect — the canvas's `selectedNode`, or null for the empty state. */
  readonly node = input<MermaidRuntime.Node | null>(null);

  /** Durable run id used for loading ref previews. */
  readonly runId = input<string | null>(null);

  /** Whether the inspected node can be drilled into (drives the enter-subgraph button). */
  readonly hasSubgraph = input<boolean>(false);

  /** Emits when the user asks to drill into the inspected node's subgraph. */
  readonly enterSubgraph = output<void>();

  protected readonly copiedNodeId = signal<string | null>(null);

  protected readonly selectedNodeRefGroups = computed<InspectorRefGroup[]>(() => {
    const node = this.node();
    if (!node) return [];
    return this.buildRefGroups(node);
  });

  protected readonly selectedRef = signal<SelectedInspectorRef | null>(null);

  protected readonly selectedRefContent = signal<MermaidRuntime.RefContent | null>(null);

  protected readonly selectedRefLoading = signal(false);

  protected readonly selectedRefError = signal<string | null>(null);

  protected readonly selectedRefDisplayText = computed(() => {
    const content = this.selectedRefContent();
    return content ? this.formatTaskRunRefContent(content) : '';
  });

  /** Id of the node whose ref preview is currently shown — guards stale clears. */
  private lastInspectedNodeId: string | null = null;

  constructor() {
    // Clear the ref preview only when the selected node's *id* changes — not on
    // every status tick (which hands us a fresh node object with the same id).
    effect(() => {
      const id = this.node()?.id ?? null;
      if (id === this.lastInspectedNodeId) return;
      this.lastInspectedNodeId = id;
      untracked(() => this.clearSelectedRef());
    });
  }

  /**
   * Copy a compact, agent-friendly summary of the node to the clipboard.
   *
   * PURPOSE: Let the Human hand a node's status/progress/detail to a coding agent
   * in one click.
   *
   * VALUE: No manual transcription of run id, node id, status, and error text.
   */
  protected copyNodeForAgent(node: MermaidRuntime.Node): void {
    const lines: string[] = [];
    const runId = this.runId();
    if (runId) {
      lines.push(`Run ID: ${runId}`);
    }
    lines.push(`Node: ${node.title} (${node.id})`);
    lines.push(`Status: ${node.status}`);
    if (node.progressPercent != null || node.progressLabel) {
      const pct = node.progressPercent != null ? `${node.progressPercent}%` : '';
      const label = node.progressLabel || '';
      lines.push(`Progress: ${label}${pct ? ` (${pct})` : ''}`);
    }
    if (node.detail) {
      lines.push(`Detail: ${node.detail}`);
    }
    if (node.error) {
      lines.push(`Error: ${node.error}`);
    }
    const text = lines.join('\n');
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this.copiedNodeId.set(node.id);
        setTimeout(() => {
          if (this.copiedNodeId() === node.id) {
            this.copiedNodeId.set(null);
          }
        }, COPY_FEEDBACK_DURATION_MS);
      });
    }
  }

  /**
   * Build non-empty ref groups for the selected node.
   *
   * PURPOSE: Present all evidence types through one inspector path while keeping
   * the persisted node shape separated by ref purpose.
   *
   * VALUE: Any task that publishes refs gets clickable inputs, outputs, context,
   * logs, and artifacts without a task-specific component.
   */
  private buildRefGroups(node: MermaidRuntime.Node): InspectorRefGroup[] {
    const groups: InspectorRefGroup[] = [
      { title: 'Inputs', kind: 'input', refs: node.inputRefs ?? [] },
      { title: 'Outputs', kind: 'output', refs: node.outputRefs ?? [] },
      { title: 'Context', kind: 'context', refs: node.contextRefs ?? [] },
      { title: 'Logs', kind: 'log', refs: node.logRefs ?? [] },
      { title: 'Artifacts', kind: 'artifact', refs: node.artifactRefs ?? [] },
    ];
    return groups.filter((group) => group.refs.length > 0);
  }

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
  protected openNodeRef(
    nodeId: string,
    refKind: MermaidRuntime.InspectableRefKind,
    ref: MermaidRuntime.InspectableRef,
  ): void {
    const runId = this.runId();
    this.selectedRef.set({ nodeId, refKind, ref });
    this.selectedRefContent.set(null);
    this.selectedRefError.set(null);

    const loader = this.refLoader;
    if (!loader) {
      this.selectedRefError.set('No ref loader is configured for this graph.');
      return;
    }
    if (!runId) {
      this.selectedRefError.set('No task run id is available for this ref.');
      return;
    }

    this.selectedRefLoading.set(true);
    from(loader.loadRef({ runId, nodeId, refKind, refId: ref.id, ref }))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (content) => {
          if (!this.isSelectedRef(nodeId, refKind, ref.id)) return;
          this.selectedRefContent.set(content);
          this.selectedRefLoading.set(false);
        },
        error: (error: unknown) => {
          if (!this.isSelectedRef(nodeId, refKind, ref.id)) return;
          this.selectedRefError.set(
            error instanceof Error ? error.message : 'Could not load this ref.',
          );
          this.selectedRefLoading.set(false);
        },
      });
  }

  /**
   * Check whether a ref row is currently selected.
   *
   * PURPOSE: Keep row highlighting aligned with the preview block.
   *
   * VALUE: The Human can see exactly which published ref produced the visible
   * content below the node details.
   */
  protected isSelectedRef(
    nodeId: string,
    refKind: MermaidRuntime.InspectableRefKind,
    refId: string,
  ): boolean {
    const selected = this.selectedRef();
    return selected?.nodeId === nodeId && selected.refKind === refKind && selected.ref.id === refId;
  }

  /**
   * Read a concise label from any task-run ref.
   *
   * PURPOSE: Normalize data, log, and artifact refs for compact row rendering.
   *
   * VALUE: The template stays readable while preserving each ref's original shape.
   */
  protected readRefLabel(ref: MermaidRuntime.InspectableRef): string {
    return 'label' in ref && ref.label ? ref.label : ref.id;
  }

  /**
   * Read the main summary line from any task-run ref.
   *
   * PURPOSE: Prefer human-authored summaries and fall back to the stored path or event id.
   *
   * VALUE: Ref rows remain useful even when a task only publishes a file pointer.
   */
  protected readRefSummary(ref: MermaidRuntime.InspectableRef): string {
    const pathValue = this.readRefPath(ref);
    return ref.summary || pathValue || ('eventId' in ref && ref.eventId ? ref.eventId : '');
  }

  /**
   * Read the path display value from any task-run ref.
   *
   * PURPOSE: Hide optional-path branching from the template.
   *
   * VALUE: Event-only refs can render without showing an empty path row.
   */
  protected readRefPath(ref: MermaidRuntime.InspectableRef): string | null {
    return 'path' in ref && typeof ref.path === 'string' && ref.path.trim().length > 0
      ? ref.path
      : null;
  }

  /**
   * Format loaded ref content for display.
   *
   * PURPOSE: Pretty-print JSON snapshots while leaving logs and text artifacts untouched.
   *
   * VALUE: Structured node context is easier to inspect without changing how refs are stored.
   */
  private formatTaskRunRefContent(content: MermaidRuntime.RefContent): string {
    if (content.contentType !== 'application/json') {
      return content.content;
    }

    try {
      return JSON.stringify(JSON.parse(content.content), null, TASK_RUN_REF_JSON_INDENT_SPACES);
    } catch {
      return content.content;
    }
  }

  /**
   * Clear the current ref preview when the selected node changes.
   *
   * PURPOSE: Avoid showing stale evidence for a node that is no longer selected.
   *
   * VALUE: The side panel always reads as one coherent node inspection.
   */
  private clearSelectedRef(): void {
    this.selectedRef.set(null);
    this.selectedRefContent.set(null);
    this.selectedRefLoading.set(false);
    this.selectedRefError.set(null);
  }
}
