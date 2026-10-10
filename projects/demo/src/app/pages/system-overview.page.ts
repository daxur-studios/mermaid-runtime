import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TaskGraphComponent } from '@daxur-studios/mermaid-runtime';
import {
  buildSystemGraph,
  HEALTH_STATUS_STYLES,
  Health,
  SERVICES,
  simulateHealth,
  SYSTEM_NODE_KINDS,
  SystemView,
} from '../system-overview-data';

const VIEWS: { id: SystemView; label: string; hint: string }[] = [
  { id: 'layers', label: 'By layer', hint: 'Web apps, edge, APIs, messaging, consumers, data stores' },
  { id: 'domains', label: 'By domain', hint: 'Who owns what: the same items regrouped by business domain' },
  { id: 'async', label: 'Event flow', hint: 'Only asynchronous links: producers, topics, queues and consumers' },
];

@Component({
  imports: [TaskGraphComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="shell">
      <div class="page-copy">
        <h1>System overview</h1>
        <p>A CMDB-style map of a synthetic shop. Switch views, then simulate a failure to see which callers and consumers it reaches.</p>
      </div>
      <div class="toolbar">
        <div class="tabs" role="tablist">
          @for (v of views; track v.id) {
            <button role="tab" [attr.aria-selected]="view() === v.id" [class.on]="view() === v.id" [title]="v.hint" (click)="view.set(v.id)">{{ v.label }}</button>
          }
        </div>
        <label>Simulate failure
          <select (change)="failing.set($any($event.target).value || null)">
            <option value="">None (baseline)</option>
            @for (s of services; track s.id) {
              <option [value]="s.id">{{ s.title }}</option>
            }
          </select>
        </label>
        <div class="counts">
          @for (c of counts(); track c.health) {
            <span class="count" [class]="c.health"><b>{{ c.n }}</b> {{ c.health }}</span>
          }
        </div>
      </div>
      <div class="graph">
        <mr-task-graph
          [nodes]="graph().nodes"
          [transitions]="graph().transitions"
          [groups]="graph().groups" groupArrangement="mermaid"
          [decorations]="graph().decorations"
          [nodeKinds]="kinds"
          [statusStyles]="statusStyles"
          [showInspector]="true"
          rootLabel="System"
          backgroundEffect="dots"
        />
      </div>
    </section>
  `,
  styles: `
    :host, .shell { display: block; height: 100%; min-height: 0 }
    .shell { display: grid; grid-template-rows: auto auto minmax(0, 1fr) }
    .toolbar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; padding: 0 1.5rem .8rem }
    .tabs { display: flex; border: 1px solid var(--line); border-radius: .6rem; overflow: hidden }
    .tabs button { border: 0; background: #131a30; color: #cbd5e1; padding: .45rem .8rem; cursor: pointer }
    .tabs button.on { background: #292e61; color: #fff }
    label { color: #cbd5e1; font-size: .9rem }
    select { background: #1e293b; color: #e2e8f0; border: 1px solid var(--line); border-radius: .4rem; padding: .35rem .5rem; margin-left: .4rem }
    .counts { display: flex; gap: .5rem; margin-left: auto }
    .count { font-size: .8rem; padding: .2rem .55rem; border-radius: 999px; border: 1px solid var(--line); color: #94a3b8 }
    .count b { color: #e2e8f0 }
    .count.healthy { border-color: var(--app-color-pass) }
    .count.degraded { border-color: var(--app-color-warn) }
    .count.down { border-color: var(--app-color-fail) }
    .graph { min-height: 0; padding: 0 1.25rem 1.25rem }
    .graph mr-task-graph { display: block; width: 100%; height: 100%; border: 1px solid var(--line); border-radius: 1rem; overflow: hidden }
  `,
})
export class SystemOverviewPage {
  protected readonly views = VIEWS;
  protected readonly services = SERVICES;
  protected readonly kinds = SYSTEM_NODE_KINDS;
  protected readonly statusStyles = HEALTH_STATUS_STYLES;

  protected readonly view = signal<SystemView>('layers');
  protected readonly failing = signal<string | null>(null);

  private readonly health = computed(() => simulateHealth(this.failing()));
  protected readonly graph = computed(() => buildSystemGraph(this.view(), this.health()));

  protected readonly counts = computed(() => {
    const tally: Record<Health, number> = { healthy: 0, degraded: 0, down: 0, maintenance: 0 };
    for (const n of this.graph().nodes) tally[n.status as Health]++;
    return (Object.keys(tally) as Health[]).map(health => ({ health, n: tally[health] }));
  });
}
