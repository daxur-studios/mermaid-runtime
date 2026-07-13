import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TaskGraphComponent } from '@daxur-studios/mermaid-runtime';
import { workflowNodes, workflowTransitions } from '../demo-data';

@Component({
  imports: [TaskGraphComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="scenario-page"><mr-task-graph [nodes]="nodes" [transitions]="transitions" [showInspector]="true" currentNodeId="plan" [followExecution]="true" /></section>`,
  styles: `:host { display:block; height:100%; min-height:0 } mr-task-graph { display:block; width:100%; height:100%; }`,
})
export class FullscreenPage { protected readonly nodes = workflowNodes; protected readonly transitions = workflowTransitions; }
