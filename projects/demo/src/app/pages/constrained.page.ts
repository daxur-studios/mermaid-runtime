import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TaskGraphComponent } from '@daxur-studios/mermaid-runtime';
import { workflowNodes, workflowTransitions } from '../demo-data';

@Component({
  imports: [TaskGraphComponent], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="page-copy"><h1>Constrained container</h1><p>Resize the host card and toggle chrome to test embedded layouts.</p></section>
    <div class="toolbar"><label>Width <input type="range" min="320" max="900" [value]="width()" (input)="setWidth($event)"> {{ width() }}px</label><button (click)="toggleInspector()">Inspector: {{ inspector() ? 'on' : 'off' }}</button><button (click)="toggleMinimap()">Minimap: {{ minimap() ? 'on' : 'off' }}</button></div>
    <div class="stage"><div class="card" [style.width.px]="width()"><mr-task-graph [nodes]="nodes" [transitions]="transitions" [showInspector]="inspector()" [showMinimap]="minimap()" backgroundEffect="dots" /></div></div>`,
  styles: `:host{display:block;min-height:100%}.toolbar{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;padding:0 1.5rem 1rem}.toolbar label{color:#cbd5e1}.toolbar button{border:1px solid var(--line);background:#1e293b;color:#e2e8f0;border-radius:.5rem;padding:.5rem .7rem}.stage{padding:0 1.5rem 2rem;overflow:auto}.card{height:430px;max-width:100%;border:1px solid #475569;border-radius:1rem;overflow:hidden;resize:both;background:#111827;box-shadow:0 20px 50px #0006}.card mr-task-graph{display:block;width:100%;height:100%}input{vertical-align:middle}`,
})
export class ConstrainedPage {
  protected readonly nodes = workflowNodes; protected readonly transitions = workflowTransitions;
  protected readonly width = signal(620); protected readonly inspector = signal(true); protected readonly minimap = signal(true);
  protected setWidth(event: Event): void { this.width.set(Number((event.target as HTMLInputElement).value)); }
  protected toggleInspector(): void { this.inspector.update(value => !value); }
  protected toggleMinimap(): void { this.minimap.update(value => !value); }
}
