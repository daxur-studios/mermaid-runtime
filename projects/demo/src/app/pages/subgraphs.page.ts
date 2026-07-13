import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TaskGraphComponent } from '@daxur-studios/mermaid-runtime';
import { nestedGroups, nestedNodes, nestedTransitions } from '../demo-data';

@Component({
  imports: [TaskGraphComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="shell"><div class="page-copy"><h1>Subgraphs & groups</h1><p>Double-click “Run content pipeline” to drill down; then open “Fact check” for a second level.</p></div><div class="graph"><mr-task-graph [nodes]="nodes" [transitions]="transitions" [groups]="groups" [showInspector]="true" rootLabel="Publishing workflow" /></div></section>`,
  styles: `:host,.shell{display:block;height:100%;min-height:0}.shell{display:grid;grid-template-rows:auto minmax(0,1fr)}.graph{min-height:0;padding:0 1.25rem 1.25rem}.graph mr-task-graph{display:block;width:100%;height:100%;border:1px solid var(--line);border-radius:1rem;overflow:hidden}`,
})
export class SubgraphsPage { protected readonly nodes = nestedNodes; protected readonly transitions = nestedTransitions; protected readonly groups = nestedGroups; }
