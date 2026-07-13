import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MermaidRuntime, TaskGraphComponent, TaskGraphReplayComponent } from '@daxur-studios/mermaid-runtime';
import { replayBaseNodes, replayEvents, workflowTransitions } from '../demo-data';

@Component({
  imports: [TaskGraphComponent, TaskGraphReplayComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="shell"><div class="page-copy"><h1>Execution replay</h1><p>Play, pause, step, or scrub through a recorded workflow run.</p></div><div class="graph"><mr-task-graph [nodes]="nodes()" [transitions]="transitions" [currentNodeId]="currentNodeId()" [replayActive]="replaying()" [replayEvent]="currentEvent()" [followExecution]="true" /></div><mr-task-graph-replay [events]="events" [baseNodes]="baseNodes" [transitions]="transitions" [progressNodeIds]="['plan','build']" (stateChange)="onState($event)" /></section>`,
  styles: `:host,.shell{display:block;height:100%;min-height:0}.shell{display:grid;grid-template-rows:auto minmax(0,1fr) auto}.graph{min-height:0;padding:0 1.25rem}.graph mr-task-graph{display:block;width:100%;height:100%;border:1px solid var(--line);border-radius:1rem;overflow:hidden}mr-task-graph-replay{margin:1rem 1.25rem;}`,
})
export class ReplayPage {
  protected readonly events = replayEvents; protected readonly baseNodes = replayBaseNodes; protected readonly transitions = workflowTransitions;
  protected readonly nodes = signal(replayBaseNodes); protected readonly currentNodeId = signal<string | null>(null);
  protected readonly currentEvent = signal<MermaidRuntime.ExecutionEvent | null>(null); protected readonly replaying = signal(false);
  protected onState(state: { nodes: MermaidRuntime.Node[]; currentNodeId: string | null; currentEvent: MermaidRuntime.ExecutionEvent | null; isReplaying: boolean }): void {
    this.nodes.set(state.nodes); this.currentNodeId.set(state.currentNodeId); this.currentEvent.set(state.currentEvent); this.replaying.set(state.isReplaying);
  }
}
