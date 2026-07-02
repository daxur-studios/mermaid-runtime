import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MermaidRuntime } from '../task-graph-model';

/**
 * Reusable execution timeline replay player.
 *
 * PURPOSE: Allow scrubbing through a history of TaskGraphExecutionEvents
 * to reconstruct and animate the state of nodes and transitions over time.
 *
 * VALUE: Shared between the workflows POC and the live task execution page,
 * ensuring consistent playback controls, slider UI, and event tickers.
 */
@Component({
  selector: 'mr-task-graph-replay',
  templateUrl: './task-graph-replay.component.html',
  styleUrl: './task-graph-replay.component.scss',
  imports: [CommonModule],
})
export class TaskGraphReplayComponent {
  private readonly destroyRef = inject(DestroyRef);

  // Inputs
  readonly events = input.required<MermaidRuntime.ExecutionEvent[]>();
  readonly baseNodes = input.required<MermaidRuntime.Node[]>();
  readonly transitions = input.required<MermaidRuntime.Transition[]>();

  /** Node IDs that support visual progress filling during playback. */
  readonly progressNodeIds = input<string[] | Set<string>>([]);

  /** Labels shown beneath progress bars during playback, keyed by node ID. */
  readonly progressLabels = input<Record<string, string>>({});

  // Outputs
  readonly stateChange = output<{
    nodes: MermaidRuntime.Node[];
    currentNodeId: string | null;
    currentEvent: MermaidRuntime.ExecutionEvent | null;
    isReplaying: boolean;
  }>();

  // Internal Player State
  protected readonly isReplaying = signal(false);
  protected readonly isPlaying = signal(false);
  protected readonly currentSeq = signal(0);
  protected readonly playbackSpeed = signal(1100); // delay in ms

  protected readonly maxSeq = computed(() => this.events().length);

  protected readonly progressNodeIdsSet = computed(() => {
    const ids = this.progressNodeIds();
    return ids instanceof Set ? ids : new Set(ids);
  });

  private readonly reconstructedState = computed(() => {
    return reconstructStateAtSeq(
      this.baseNodes(),
      this.transitions(),
      this.events(),
      this.currentSeq()
    );
  });

  protected readonly currentEvent = computed(() => {
    const seq = this.currentSeq();
    return this.events().find((e) => e.seq === seq) ?? null;
  });

  protected readonly currentNodeId = computed(() => {
    return this.reconstructedState().currentNodeId;
  });

  private readonly progressMap = signal<Record<string, number>>({});
  private readonly progressFills = new Map<string, { startedAt: number; fillMs: number }>();
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private replayTimer: ReturnType<typeof setTimeout> | null = null;

  // Constants for progress ticking
  private readonly PROGRESS_FILL_MS = 2200;
  private readonly PROGRESS_STEP_PERCENT = 10;
  private readonly PROGRESS_RUNNING_CAP_PERCENT = 90;
  private readonly PROGRESS_COMPLETE_PERCENT = 100;
  private readonly PROGRESS_START_PERCENT = 0;
  private readonly PROGRESS_TICK_MS = (this.PROGRESS_FILL_MS * this.PROGRESS_STEP_PERCENT) / this.PROGRESS_COMPLETE_PERCENT;

  protected readonly nodes = computed<MermaidRuntime.Node[]>(() => {
    const state = this.reconstructedState();
    const progress = this.progressMap();
    const labels = this.progressLabels();

    return this.baseNodes().map((def) => {
      const progressPercent = progress[def.id];
      const time = state.timestampsMap[def.id];
      return {
        ...def,
        status: state.statusMap[def.id] ?? 'undone',
        ...(time ? { startedAt: time.startedAt, endedAt: time.endedAt } : {}),
        ...(progressPercent != null
          ? { progressPercent, progressLabel: labels[def.id] }
          : {}),
      };
    });
  });

  constructor() {
    // Reset player whenever events input changes
    effect(() => {
      const _ = this.events();
      this.resetReplay();
    });

    // Sync progress ticks whenever state changes
    effect(() => {
      const state = this.reconstructedState();
      this.syncProgressWithState(state.statusMap);
    });

    // Emit state changes to host
    effect(() => {
      const nodes = this.nodes();
      const currentNodeId = this.currentNodeId();
      const currentEvent = this.currentEvent();
      const isReplaying = this.isReplaying();

      this.stateChange.emit({
        nodes,
        currentNodeId,
        currentEvent,
        isReplaying,
      });
    });

    this.destroyRef.onDestroy(() => {
      this.clearReplayTimer();
      this.clearProgressTicker();
    });
  }

  // Playback Control Actions
  protected startReplay(): void {
    this.clearReplayTimer();
    this.resetProgress();
    this.currentSeq.set(0);
    this.isReplaying.set(true);
    this.isPlaying.set(true);
    this.runPlayback();
  }

  protected stopReplay(): void {
    this.clearReplayTimer();
    this.isPlaying.set(false);
    this.isReplaying.set(false);
    this.currentSeq.set(0);
  }

  protected resetReplay(): void {
    this.clearReplayTimer();
    this.isPlaying.set(false);
    this.currentSeq.set(0);
    this.resetProgress();
  }

  protected playReplay(): void {
    if (this.currentSeq() >= this.maxSeq()) {
      this.currentSeq.set(0);
    }
    this.isPlaying.set(true);
    this.runPlayback();
  }

  protected pauseReplay(): void {
    this.clearReplayTimer();
    this.isPlaying.set(false);
  }

  protected stepForward(): void {
    this.pauseReplay();
    if (this.currentSeq() < this.maxSeq()) {
      this.currentSeq.update((seq) => seq + 1);
    }
  }

  protected stepBack(): void {
    this.pauseReplay();
    if (this.currentSeq() > 0) {
      this.currentSeq.update((seq) => seq - 1);
    }
  }

  protected goToStart(): void {
    this.pauseReplay();
    this.currentSeq.set(0);
    this.resetProgress();
  }

  protected goToEnd(): void {
    this.pauseReplay();
    this.currentSeq.set(this.maxSeq());
  }

  protected onSliderInput(event: Event): void {
    this.pauseReplay();
    const val = Number((event.target as HTMLInputElement).value);
    this.currentSeq.set(val);
  }

  protected setPlaybackSpeed(speedStr: string): void {
    const speed = Number(speedStr);
    this.playbackSpeed.set(speed);
    if (this.isPlaying()) {
      this.clearReplayTimer();
      this.runPlayback();
    }
  }

  private runPlayback(): void {
    if (this.currentSeq() >= this.maxSeq()) {
      this.isPlaying.set(false);
      return;
    }
    const delay = this.playbackSpeed();
    this.replayTimer = setTimeout(() => {
      this.currentSeq.update((seq) => seq + 1);
      this.runPlayback();
    }, delay);
  }

  private clearReplayTimer(): void {
    if (this.replayTimer !== null) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
  }

  // Progress Bar ticking
  private syncProgressWithState(statuses: Record<string, MermaidRuntime.NodeStatus>): void {
    const now = performance.now();
    const next = { ...this.progressMap() };
    let changed = false;

    const progressIds = this.progressNodeIdsSet();

    for (const node of this.baseNodes()) {
      const status = statuses[node.id] ?? 'undone';
      if (status === 'running' && progressIds.has(node.id)) {
        if (!this.progressFills.has(node.id)) {
          this.progressFills.set(node.id, { startedAt: now, fillMs: this.PROGRESS_FILL_MS });
          next[node.id] = this.PROGRESS_START_PERCENT;
          changed = true;
        }
      } else if (status === 'complete') {
        const wasFilling = this.progressFills.delete(node.id);
        if (wasFilling || next[node.id] !== this.PROGRESS_COMPLETE_PERCENT) {
          next[node.id] = this.PROGRESS_COMPLETE_PERCENT;
          changed = true;
        }
      } else {
        const wasFilling = this.progressFills.delete(node.id);
        if (wasFilling || next[node.id] != null) {
          delete next[node.id];
          changed = true;
        }
      }
    }

    if (changed) {
      this.progressMap.set(next);
    }
    this.ensureProgressTicker();
  }

  private ensureProgressTicker(): void {
    if (this.progressTimer !== null) return;
    this.progressTimer = setInterval(() => this.tickProgress(), this.PROGRESS_TICK_MS);
  }

  private tickProgress(): void {
    if (this.progressFills.size === 0) {
      this.clearProgressTicker();
      return;
    }
    const now = performance.now();
    const next = { ...this.progressMap() };
    let changed = false;

    for (const [id, fill] of this.progressFills) {
      const elapsedPercent = ((now - fill.startedAt) / fill.fillMs) * this.PROGRESS_COMPLETE_PERCENT;
      const stepped = Math.min(
        this.PROGRESS_RUNNING_CAP_PERCENT,
        Math.floor(elapsedPercent / this.PROGRESS_STEP_PERCENT) * this.PROGRESS_STEP_PERCENT
      );
      if (next[id] !== stepped) {
        next[id] = stepped;
        changed = true;
      }
    }
    if (changed) this.progressMap.set(next);
  }

  private clearProgressTicker(): void {
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private resetProgress(): void {
    this.clearProgressTicker();
    this.progressFills.clear();
    this.progressMap.set({});
  }
}

/**
 * Reconstructs the execution status of all nodes at a given sequence number.
 */
function reconstructStateAtSeq(
  baseNodes: MermaidRuntime.Node[],
  transitions: MermaidRuntime.Transition[],
  events: MermaidRuntime.ExecutionEvent[],
  seq: number
) {
  const statusMap: Record<string, MermaidRuntime.NodeStatus> = {};
  const timestampsMap: Record<string, { startedAt?: string; endedAt?: string }> = {};
  let currentNodeId: string | null = null;

  for (const node of baseNodes) {
    statusMap[node.id] = 'undone';
  }

  const activeEvents = events.filter((e) => e.seq <= seq);

  for (const event of activeEvents) {
    if (event.kind === 'node-started' && event.nodeId) {
      statusMap[event.nodeId] = 'running';
      currentNodeId = event.nodeId;
      timestampsMap[event.nodeId] = {
        ...timestampsMap[event.nodeId],
        startedAt: event.at,
      };

      // Reset all downstream nodes reachable via transitions to 'undone'
      const downstream = getDownstreamNodes(event.nodeId, baseNodes, transitions);
      for (const downId of downstream) {
        statusMap[downId] = 'undone';
        delete timestampsMap[downId];
      }
    } else if (event.kind === 'node-ended' && event.nodeId) {
      statusMap[event.nodeId] = event.status || 'complete';
      timestampsMap[event.nodeId] = {
        ...timestampsMap[event.nodeId],
        endedAt: event.at,
      };

      if (currentNodeId === event.nodeId) {
        currentNodeId = null;
      }
    }
  }

  return {
    statusMap,
    timestampsMap,
    currentNodeId,
  };
}

/**
 * BFS traversal to find all downstream nodes reachable from a node via transitions.
 */
function getDownstreamNodes(
  startNodeId: string,
  baseNodes: MermaidRuntime.Node[],
  transitions: MermaidRuntime.Transition[]
): Set<string> {
  const nodeOrder = baseNodes.map((node) => node.id);
  const indexMap = new Map(nodeOrder.map((id, idx) => [id, idx]));

  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentIndex = indexMap.get(current) ?? 0;

    for (const edge of transitions) {
      if (edge.from === current && !visited.has(edge.to) && edge.to !== startNodeId) {
        const toIndex = indexMap.get(edge.to) ?? 0;
        // Skip loopback/back-edges (where the target node is at an earlier topological index)
        if (toIndex <= currentIndex) {
          continue;
        }
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return visited;
}
