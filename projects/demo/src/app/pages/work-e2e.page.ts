import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { GraphCanvasComponent, MermaidRuntime, NodeContextMenuEvent } from '@daxur-studios/mermaid-runtime';
import { DEMO_NODE_KINDS, REFRESH_ICON } from '../demo-node-kinds';
import { buildWorkDemo, DEMO_END, DemoEnvironment, DemoView } from '../work-demo-data';

@Component({
  imports: [FormsModule, GraphCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work-e2e.page.html',
  styleUrl: './work-e2e.page.scss',
})
export class WorkE2ePage {
  protected readonly stress = inject(ActivatedRoute).snapshot.data['stress'] === true;
  protected readonly trips = signal(this.stress ? 5 : 1);
  protected readonly environment = signal<DemoEnvironment>('local');
  protected readonly view = signal<DemoView>('subflows');
  protected readonly tick = signal(0);
  protected readonly playing = signal(false);
  protected readonly fail = signal(false);
  protected readonly follow = signal(false);
  protected readonly motion = signal(true);
  protected readonly inspector = signal(true);
  protected readonly longLabels = signal(false);
  protected readonly commands = signal(false);
  protected readonly shapes = signal(false);
  protected readonly direction = signal<'TD' | 'LR'>('LR');
  protected readonly groupFlow = signal<'alternate' | 'same'>('alternate');
  protected readonly path = signal<string[]>([]);
  protected readonly selected = signal<string | null>(null);
  protected readonly menu = signal({ x: 0, y: 0 });
  protected readonly headed = signal(false);
  protected readonly depot = signal('North depot');
  protected readonly speed = signal(250);
  protected readonly graph = computed(() => buildWorkDemo(this.trips(), this.environment(), this.tick(), this.view(), this.fail(), this.longLabels(), this.commands()));
  /** Demo kinds: assertions are green hexagons, SQL steps rounded with a database icon, Kafka steps slanted violet. */
  protected readonly nodeKinds = computed<Record<string, MermaidRuntime.NodeKindStyle>>(() => (this.shapes() ? DEMO_NODE_KINDS : {}));
  /** One step overrides its kind: a polling SQL step gets a refresh icon and a "poll 5s" chip. */
  protected readonly decorations = computed<Record<string, MermaidRuntime.NodeDecoration>>(() => {
    if (!this.shapes()) return {};
    const result: Record<string, MermaidRuntime.NodeDecoration> = {};
    for (const node of this.graph().nodes) {
      if (node.type === 'SQL' && node.title.startsWith('Poll')) result[node.id] = { icon: REFRESH_ICON, chip: 'poll 5s', tone: 'amber' };
    }
    return result;
  });
  protected readonly locked = computed(() => this.tick() > 0 || this.playing());
  protected readonly outcome = computed(() => this.fail() && this.tick() >= 17 ? 'Failed' : this.tick() >= DEMO_END ? 'Complete' : this.playing() ? 'Running' : this.tick() > 0 ? 'Paused' : 'Ready');
  protected readonly context = computed(() => JSON.stringify({
    environment: this.environment() === 'local' ? 'Local sandbox' : 'Shared dev',
    profile: 'trip-creation', depot: this.depot(), headed: this.headed(),
    ...(this.tick() >= 16 ? { tripNumber: 'DEMO-1042' } : {}),
    ...(this.tick() >= 19 && !this.fail() ? { publicGuid: '00000000-0000-4000-8000-000000001042' } : {}),
  }, null, 2));
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() { inject(DestroyRef).onDestroy(() => this.pause()); }

  protected toggleRun(): void {
    if (this.playing()) { this.pause(); return; }
    if (this.outcome() === 'Complete' || this.outcome() === 'Failed') this.tick.set(0);
    this.playing.set(true);
    this.timer = setInterval(() => this.advance(), this.speed());
  }

  protected advance(): void {
    const limit = this.fail() ? 17 : DEMO_END;
    this.tick.update(tick => Math.min(limit, tick + 0.25));
    if (this.tick() >= limit) this.pause();
  }

  protected pause(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.playing.set(false);
  }

  protected reset(): void { this.pause(); this.tick.set(0); }

  protected changeView(value: DemoView): void {
    this.path.set([]); this.selected.set(null); this.view.set(value);
  }

  protected navigate(path: string[]): void { this.path.set(path); this.selected.set(null); }

  protected openMenu(event: NodeContextMenuEvent): void {
    this.menu.set({ x: event.x, y: event.y });
    this.selected.set(event.nodeId);
  }

  protected inspect(node: MermaidRuntime.Node, canvas: GraphCanvasComponent): void {
    this.selected.set(node.id); this.inspector.set(true); canvas.closeContextMenu();
  }
}
