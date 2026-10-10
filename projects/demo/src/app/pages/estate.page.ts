import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MermaidRuntime, TaskGraphComponent } from '@daxur-studios/mermaid-runtime';
import {
  buildEstateGraph,
  ESTATE_NODE_KINDS,
  healthByComponent,
  linksFor,
  resolveFeature,
  syncSummaries,
  UNKNOWN_STATUS,
} from '../estate/estate-adapter';
import { ESTATE_REGISTRY } from '../estate/estate-data';
import { EstateComponent } from '../estate/estate-model';
import { HEALTH_STATUS_STYLES } from '../system-overview-data';

/** Delay between one component's check finishing and the next, in the simulated health run. */
const CHECK_STEP_MS = 120;

@Component({
  imports: [TaskGraphComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="shell">
      <div class="page-copy">
        <h1>Estate map</h1>
        <p>Proof of concept for the target data contract (plan 15): pick a feature, pick an environment, run a health check, click a node for links to copy.</p>
      </div>

      <div class="toolbar">
        <label>Feature
          <select (change)="setFeature($any($event.target).value)">
            @for (f of features; track f.id) {
              <option [value]="f.id" [selected]="f.id === featureId()">{{ f.name }}</option>
            }
          </select>
        </label>
        <div class="tabs" role="tablist">
          @for (e of environments; track e.id) {
            <button role="tab" [attr.aria-selected]="env() === e.id" [class.on]="env() === e.id" (click)="env.set(e.id)">{{ e.label }}</button>
          }
        </div>
        <label class="check"><input type="checkbox" [checked]="expandSync()" (change)="expandSync.set($any($event.target).checked)"> Show sync hops</label>
        <button class="run" [disabled]="checking()" (click)="runHealthCheck()">{{ checking() ? 'Checking…' : 'Run health check' }}</button>
        <div class="counts">
          @for (c of counts(); track c.status) {
            <span class="count" [class]="c.status"><b>{{ c.n }}</b> {{ c.status }}</span>
          }
        </div>
      </div>

      <div class="body">
        <div class="graph">
          <mr-task-graph
            [nodes]="graph().nodes"
            [transitions]="graph().transitions"
            [groups]="graph().groups"
            [decorations]="graph().decorations"
            [nodeKinds]="kinds"
            [statusStyles]="statusStyles"
            [farLabel]="farLabel"
            [selectedNodeId]="selectedId()"
            [showInspector]="false"
            rootLabel="Estate"
            backgroundEffect="dots"
            groupArrangement="mermaid"
            (nodeSelected)="selectedId.set($event)"
            (selectionCleared)="selectedId.set(null)"
          />
        </div>

        <aside class="panel" aria-label="Component details">
          @if (selected(); as s) {
            <header>
              <h2>{{ s.component.id }}</h2>
              <span class="kind">{{ s.component.kind }}</span>
              <span class="badge" [class]="s.status">{{ s.status }}</span>
            </header>
            @if (s.detail) { <p class="muted">{{ s.detail }}</p> }
            @if (s.component.summary; as sum) {
              <h3>Business</h3><p>{{ sum.business }}</p>
              <h3>Technical</h3><p>{{ sum.technical }}</p>
            }
            @if (s.component.custodians?.length) { <h3>Custodians</h3><p>{{ s.component.custodians!.join(', ') }}</p> }
            @if (s.component.tags?.length) {
              <div class="tags">@for (t of s.component.tags; track t) { <span>{{ t }}</span> }</div>
            }
            @if (s.links.length) {
              <h3>Links ({{ envLabel() }})</h3>
              <ul class="links">
                @for (l of s.links; track l.label) {
                  <li>
                    <button (click)="copy(l.url, s.component.id + l.label)">{{ copied() === s.component.id + l.label ? 'Copied' : 'Copy ' + l.label }}</button>
                    <code>{{ l.url }}</code>
                  </li>
                }
              </ul>
            }
            @if (s.sync.length) {
              <h3>Sync</h3>
              <ul class="sync">@for (line of s.sync; track line) { <li>{{ line }}</li> }</ul>
            }
          } @else {
            <p class="muted">Click a node to see its summary, health detail and links to copy for the chosen environment.</p>
          }
        </aside>
      </div>
    </section>
  `,
  styles: `
    :host, .shell { display: block; height: 100%; min-height: 0 }
    .shell { display: grid; grid-template-rows: auto auto minmax(0, 1fr) }
    .toolbar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; padding: 0 1.5rem .8rem }
    .toolbar label { color: #cbd5e1; font-size: .9rem }
    select { background: #1e293b; color: #e2e8f0; border: 1px solid var(--line); border-radius: .4rem; padding: .35rem .5rem; margin-left: .4rem }
    .tabs { display: flex; border: 1px solid var(--line); border-radius: .6rem; overflow: hidden }
    .tabs button { border: 0; background: #131a30; color: #cbd5e1; padding: .45rem .8rem; cursor: pointer }
    .tabs button.on { background: #292e61; color: #fff }
    .run { border: 1px solid var(--line); background: #1e293b; color: #e2e8f0; border-radius: .5rem; padding: .45rem .8rem; cursor: pointer }
    .run:disabled { opacity: .6; cursor: default }
    .counts { display: flex; gap: .5rem; margin-left: auto }
    .count { font-size: .8rem; padding: .2rem .55rem; border-radius: 999px; border: 1px solid var(--line); color: #94a3b8 }
    .count b { color: #e2e8f0 }
    .count.healthy { border-color: var(--app-color-pass) }
    .count.degraded { border-color: var(--app-color-warn) }
    .count.down { border-color: var(--app-color-fail) }
    .body { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 1rem; min-height: 0; padding: 0 1.25rem 1.25rem }
    .graph { min-height: 0 }
    .graph mr-task-graph { display: block; width: 100%; height: 100%; border: 1px solid var(--line); border-radius: 1rem; overflow: hidden }
    .panel { overflow: auto; border: 1px solid var(--line); border-radius: 1rem; background: #0f1428; padding: 1rem; font-size: .88rem }
    .panel header { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap }
    .panel h2 { margin: 0; font-size: 1.05rem }
    .panel h3 { margin: 1rem 0 .25rem; font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8 }
    .panel p { margin: 0 0 .4rem }
    .muted { color: #94a3b8 }
    .kind, .badge, .tags span { font-size: .72rem; padding: .1rem .45rem; border-radius: 999px; border: 1px solid var(--line); color: #cbd5e1 }
    .badge.healthy { border-color: var(--app-color-pass); color: var(--app-color-pass) }
    .badge.degraded { border-color: var(--app-color-warn); color: var(--app-color-warn) }
    .badge.down { border-color: var(--app-color-fail); color: var(--app-color-fail) }
    .tags { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem }
    .links, .sync { list-style: none; margin: 0; padding: 0; display: grid; gap: .45rem }
    .links li { display: grid; gap: .2rem }
    .links button { justify-self: start; border: 1px solid var(--line); background: #1e293b; color: #e2e8f0; border-radius: .4rem; padding: .25rem .55rem; cursor: pointer }
    .links code { color: #94a3b8; font-size: .75rem; word-break: break-all }
    .sync li { color: #cbd5e1 }
  `,
})
export class EstatePage {
  private readonly destroyRef = inject(DestroyRef);
  private readonly registry = ESTATE_REGISTRY;

  protected readonly features = this.registry.features;
  protected readonly environments = this.registry.environments;
  protected readonly kinds = ESTATE_NODE_KINDS;
  protected readonly statusStyles = HEALTH_STATUS_STYLES;
  /** Zoomed out, a repo name is worth more than its kind chip. */
  protected readonly farLabel = (node: MermaidRuntime.Node): string => node.title;

  protected readonly featureId = signal(this.features[0].id);
  protected readonly env = signal(this.environments[1].id);
  protected readonly expandSync = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly copied = signal<string | null>(null);

  /** Components currently being checked or already resolved during a run; empty when idle. */
  private readonly override = signal<Record<string, string>>({});
  protected readonly checking = signal(false);
  private timers: ReturnType<typeof setTimeout>[] = [];

  private readonly slice = computed(() => {
    const feature = this.features.find(f => f.id === this.featureId()) ?? this.features[0];
    return resolveFeature(this.registry, feature);
  });

  protected readonly graph = computed(() =>
    buildEstateGraph(this.registry, this.slice(), { env: this.env(), expandSync: this.expandSync(), statusOverride: this.override() }),
  );

  protected readonly envLabel = computed(() => this.environments.find(e => e.id === this.env())?.label ?? this.env());

  protected readonly counts = computed(() => {
    const tally = new Map<string, number>();
    for (const n of this.graph().nodes) tally.set(n.status, (tally.get(n.status) ?? 0) + 1);
    return ['healthy', 'degraded', 'down', 'maintenance', UNKNOWN_STATUS, 'running']
      .filter(status => tally.has(status))
      .map(status => ({ status, n: tally.get(status)! }));
  });

  protected readonly selected = computed(() => {
    const id = this.selectedId();
    const node = id ? this.graph().nodes.find(n => n.id === id) : null;
    if (!id || !node) return null;
    const component: EstateComponent = this.registry.components.find(c => c.id === id) ?? {
      id, kind: 'table', domain: this.graph().groups.find(g => g.nodeIds.includes(id))?.label ?? '', summary: { business: 'Messages waiting to be sent.', technical: `Outbox table in ${id.split('.')[0]}.` },
    };
    const row = healthByComponent(this.registry.health, this.env()).get(id);
    return {
      component,
      status: node.status,
      detail: row?.detail ? `${row.detail} · checked ${row.at.slice(0, 16).replace('T', ' ')}` : null,
      links: component.kind === 'table' ? [] : linksFor(this.registry, id, this.env()),
      sync: syncSummaries(this.registry, id),
    };
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimers());
  }

  protected setFeature(id: string): void {
    this.featureId.set(id);
    this.selectedId.set(null);
  }

  /** Simulates a health run: every visible component shows `running`, then settles to its stored status in turn. */
  protected runHealthCheck(): void {
    this.clearTimers();
    const ids = this.graph().nodes.map(n => n.id);
    this.checking.set(true);
    this.override.set(Object.fromEntries(ids.map(id => [id, 'running'])));
    ids.forEach((id, i) => {
      this.timers.push(setTimeout(() => {
        this.override.update(({ [id]: _settled, ...rest }) => rest);
        if (i === ids.length - 1) this.checking.set(false);
      }, (i + 1) * CHECK_STEP_MS));
    });
  }

  protected async copy(url: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(key);
      this.timers.push(setTimeout(() => this.copied.set(null), 1200));
    } catch {
      // Clipboard can be unavailable (insecure context, permissions); the URL stays visible to copy by hand.
    }
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
