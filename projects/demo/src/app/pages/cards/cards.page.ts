import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  GraphCardComponent,
  GraphCardListComponent,
  MermaidRuntime,
  type GraphPreviewMode,
} from '@daxur-studios/mermaid-runtime';
import {
  createBypassFlow,
  createConditionalFallbackFlow,
  createDiamondFlow,
  createFanOutInFlow,
  createMeshFlow,
  createParallelChecksFlow,
  createRandomDagFlow,
  createTreeFlow,
  generateVariedFlow,
  type FlowTopologyType,
} from './random-flow-generator';

export interface DemoRunItem {
  id: string;
  title: string;
  subtitle: string;
  topologyName: string;
  branch: string;
  duration: string;
  graph: MermaidRuntime.Graph | null;
  imageSrc?: string | null;
  status?: string;
  priority?: string;
}

@Component({
  selector: 'demo-cards-page',
  imports: [FormsModule, GraphCardComponent, GraphCardListComponent],
  templateUrl: './cards.page.html',
  styleUrl: './cards.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardsPage {
  readonly layout = signal<'grid' | 'list'>('grid');
  readonly columns = signal<number | 'auto'>('auto');
  readonly previewMode = signal<GraphPreviewMode>('simple');
  readonly showEmpty = signal<boolean>(false);
  readonly selectedId = signal<string | null>('run-1');
  readonly lastAction = signal<string>('None');

  readonly runs = signal<DemoRunItem[]>(this.createInitialRuns());

  private createInitialRuns(): DemoRunItem[] {
    const diamond = createDiamondFlow('running');
    const fanOutIn = createFanOutInFlow('running');
    const parallelChecks = createParallelChecksFlow('running');
    const bypass = createBypassFlow('complete');
    const mesh = createMeshFlow('failed');
    const tree = createTreeFlow('idle');

    return [
      {
        id: 'run-1',
        title: 'Multi-Gateway Checkout',
        subtitle: 'Ingress routing with parallel payment providers',
        topologyName: diamond.topologyName,
        branch: 'feature/payment-split',
        duration: '42s',
        status: 'running',
        priority: 'high',
        graph: diamond.graph,
      },
      {
        id: 'run-2',
        title: 'Parallel Worker Batch',
        subtitle: 'Fan-out to 4 workers and gather into reducer',
        topologyName: fanOutIn.topologyName,
        branch: 'main',
        duration: '1m 18s',
        status: 'running',
        graph: fanOutIn.graph,
      },
      {
        id: 'run-3',
        title: 'CI Validation Matrix',
        subtitle: '5 parallel checks (lint, types, unit, sec, e2e)',
        topologyName: parallelChecks.topologyName,
        branch: 'fix/security-audit',
        duration: '2m 04s',
        status: 'running',
        priority: 'critical',
        graph: parallelChecks.graph,
      },
      {
        id: 'run-4',
        title: 'Fast-Path Pipeline Bypass',
        subtitle: 'Sequential ETL flow with cache bypass shortcut',
        topologyName: bypass.topologyName,
        branch: 'feat/cache-bypass',
        duration: '14s',
        status: 'complete',
        graph: bypass.graph,
      },
      {
        id: 'run-5',
        title: 'Event Mesh Router',
        subtitle: '2 producers into queue broker feeding 3 consumers',
        topologyName: mesh.topologyName,
        branch: 'main',
        duration: '31s',
        status: 'failed',
        priority: 'critical',
        graph: mesh.graph,
      },
      {
        id: 'run-6',
        title: 'Hierarchical Model Training',
        subtitle: '2-tier tree dispatch for preparation and training',
        topologyName: tree.topologyName,
        branch: 'ml/lora-finetune',
        duration: '0s',
        status: 'idle',
        graph: tree.graph,
      },
      {
        id: 'run-7',
        title: 'Static Asset Banner & CDN',
        subtitle: 'Demonstrates static image header support',
        topologyName: 'Static Image Header',
        branch: 'chore/assets',
        duration: '5s',
        status: 'complete',
        imageSrc:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%231e293b"/><stop offset="1" stop-color="%23334155"/></linearGradient></defs><rect width="300" height="80" fill="url(%23g)"/><circle cx="50" cy="40" r="18" fill="%236366f1" opacity="0.8"/><circle cx="150" cy="40" r="18" fill="%2322c55e" opacity="0.8"/><circle cx="250" cy="40" r="18" fill="%2338bdf8" opacity="0.8"/><path d="M68 40 L132 40 M168 40 L232 40" stroke="%2394a3b8" stroke-width="2" stroke-dasharray="4"/></svg>',
        graph: null,
      },
    ];
  }

  selectRun(id: string): void {
    this.selectedId.set(id);
    this.lastAction.set(`Selected card #${id}`);
  }

  triggerAction(id: string, action: string, event: MouseEvent): void {
    event.stopPropagation();
    this.lastAction.set(`Clicked "${action}" on card #${id}`);
  }

  /**
   * Randomizes the flow topology and status distribution for every card in the collection.
   */
  randomizeFlows(): void {
    const topologies: FlowTopologyType[] = [
      'diamond',
      'fan-out-in',
      'bypass',
      'mesh',
      'parallel-checks',
      'tree',
      'conditional-fallback',
      'random-dag',
    ];

    this.runs.update((items) =>
      items.map((item, index) => {
        if (item.imageSrc && index === items.length - 1) {
          return item; // Keep the static image example
        }

        const randomTopo = topologies[Math.floor(Math.random() * topologies.length)];
        const generated = generateVariedFlow(randomTopo, 'random');

        return {
          ...item,
          topologyName: generated.topologyName,
          graph: generated.graph,
        };
      })
    );

    this.lastAction.set('🎲 Randomized all flow topologies (diamonds, fan-out/in, mesh, bypass, trees)');
  }

  /**
   * Applies a specific topology across all graph cards for comparison.
   */
  applyTopology(topology: FlowTopologyType): void {
    this.runs.update((items) =>
      items.map((item, index) => {
        if (item.imageSrc && index === items.length - 1) {
          return item;
        }

        const generated = generateVariedFlow(topology, 'random');
        return {
          ...item,
          topologyName: generated.topologyName,
          graph: generated.graph,
        };
      })
    );

    this.lastAction.set(`Applied topology: ${topology} to cards`);
  }

  /**
   * Adds a brand new card with a generated non-linear topology.
   */
  addRandomCard(): void {
    const generated = generateVariedFlow(undefined, 'random');
    const newId = `run-${Date.now().toString().slice(-4)}`;

    const newCard: DemoRunItem = {
      id: newId,
      title: `Ad-hoc ${generated.topologyName.split(' ')[0]} Flow`,
      subtitle: 'Dynamically generated non-linear DAG',
      topologyName: generated.topologyName,
      branch: 'feature/experimental',
      duration: '12s',
      graph: generated.graph,
    };

    this.runs.update((list) => [newCard, ...list]);
    this.selectedId.set(newId);
    this.lastAction.set(`Added new card #${newId} with ${generated.topologyName}`);
  }

  /**
   * Resets cards to default diverse setup.
   */
  resetFlows(): void {
    this.runs.set(this.createInitialRuns());
    this.lastAction.set('Reset all cards to baseline diverse flows');
  }

  /**
   * Advances the execution step of running tasks.
   */
  simulateStep(): void {
    this.runs.update((list) =>
      list.map((item) => {
        if (!item.graph) return item;
        const newNodes = [...item.graph.nodes];
        const runningIdx = newNodes.findIndex((n) => n.status === 'running');
        if (runningIdx !== -1) {
          newNodes[runningIdx] = { ...newNodes[runningIdx], status: 'complete' };
          const nextUndone = newNodes.findIndex((n) => n.status === 'undone');
          if (nextUndone !== -1) {
            newNodes[nextUndone] = { ...newNodes[nextUndone], status: 'running' };
          }
        }
        return {
          ...item,
          graph: {
            ...item.graph,
            nodes: newNodes,
          },
        };
      })
    );
    this.lastAction.set('Advanced step on running tasks');
  }
}
