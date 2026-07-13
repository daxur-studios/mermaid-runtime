import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TaskGraphComponent } from '@daxur-studios/mermaid-runtime';
import { nestedGroups, nestedNodes, nestedTransitions } from '../demo-data';

@Component({
  imports: [TaskGraphComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="regression-toolbar" data-testid="regression-toolbar">
      <button data-testid="direction-toggle" type="button" (click)="toggleDirection()">
        Direction {{ direction() }}
      </button>
      <button data-testid="enter-subgraph" type="button" (click)="path.set(['pipeline'])">Enter subgraph</button>
      <button data-testid="enter-nested-subgraph" type="button" (click)="path.set(['pipeline', 'fact-check'])">Enter nested</button>
      <button data-testid="return-root" type="button" (click)="path.set([])">Return root</button>
      <button data-testid="rapid-sequence" type="button" (click)="runRapidSequence()">Rapid sequence</button>
      <button data-testid="toggle-inspector" type="button" (click)="toggleInspector()">Inspector</button>
      <button data-testid="toggle-minimap" type="button" (click)="toggleMinimap()">Minimap</button>
      <button data-testid="size-full" type="button" (click)="fullscreen.set(true)">Full</button>
      @for (size of sizes; track size) {
        <button [attr.data-testid]="'size-' + size" type="button" (click)="setSize(size)">{{ size }}</button>
      }
    </div>

    <div class="regression-stage" data-testid="regression-stage">
      <div
        class="graph-host"
        data-testid="graph-host"
        [class.graph-host--fullscreen]="fullscreen()"
        [style.width.px]="fullscreen() ? null : width()"
        [attr.data-direction]="direction()"
        [attr.data-path]="path().join('/')"
      >
        <mr-task-graph
          [nodes]="nodes"
          [transitions]="transitions"
          [groups]="groups"
          [(direction)]="direction"
          [path]="path()"
          (graphPathChange)="path.set($event)"
          [showInspector]="inspector()"
          [showMinimap]="minimap()"
          rootLabel="Regression root"
        />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .regression-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: .4rem;
      padding: .55rem .75rem;
      border-bottom: 1px solid var(--line);
      background: #11182b;
    }
    button {
      padding: .35rem .55rem;
      border: 1px solid #475569;
      border-radius: .4rem;
      background: #1e293b;
      color: #e2e8f0;
      cursor: pointer;
    }
    .regression-stage {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      min-height: 0;
      padding: 1rem;
      overflow: hidden;
    }
    .graph-host {
      height: min(430px, 100%);
      max-width: 100%;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      border: 1px solid #475569;
      border-radius: .75rem;
      background: #0f172a;
    }
    .graph-host--fullscreen {
      width: 100%;
      height: 100%;
    }
    mr-task-graph {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
    }
  `,
})
export class LayoutRegressionPage {
  protected readonly nodes = nestedNodes;
  protected readonly transitions = nestedTransitions;
  protected readonly groups = nestedGroups;
  protected readonly sizes = [320, 480, 620, 900] as const;
  protected readonly direction = signal<'TD' | 'LR'>('TD');
  protected readonly path = signal<string[]>([]);
  protected readonly inspector = signal(true);
  protected readonly minimap = signal(true);
  protected readonly fullscreen = signal(false);
  protected readonly width = signal(620);

  protected toggleDirection(): void {
    this.direction.update(value => value === 'TD' ? 'LR' : 'TD');
  }

  protected setSize(width: number): void {
    this.width.set(width);
    this.fullscreen.set(false);
  }

  protected toggleInspector(): void {
    this.inspector.update(value => !value);
  }

  protected toggleMinimap(): void {
    this.minimap.update(value => !value);
  }

  protected runRapidSequence(): void {
    this.direction.set('LR');
    window.setTimeout(() => this.path.set(['pipeline']), 0);
    window.setTimeout(() => this.direction.set('TD'), 8);
    window.setTimeout(() => this.path.set(['pipeline', 'fact-check']), 16);
    window.setTimeout(() => this.path.set([]), 24);
    window.setTimeout(() => this.direction.set('LR'), 32);
  }
}
