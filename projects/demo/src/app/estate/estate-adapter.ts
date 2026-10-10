import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';
import { DATABASE_ICON, REFRESH_ICON, SEND_ICON } from '../demo-node-kinds';
import { SYSTEM_NODE_KINDS } from '../system-overview-data';
import {
  ComponentKind,
  EstateComponent,
  EstateFeature,
  EstateHealthRow,
  EstateLink,
  EstateRegistry,
  SyncLink,
} from './estate-model';

/**
 * Host adapter for the plan 15 contract: turns a registry, a feature selection, an
 * environment and health rows into a `MermaidRuntime` graph. Pure functions, no Angular.
 *
 * PURPOSE: Keep the library host-agnostic. The registry shapes live in the host; only this
 * file knows how they map to nodes, transitions and groups.
 *
 * VALUE: A host with real data writes its own adapter to the same graph shape and gets the
 * same views, health overlay and link actions.
 */

/** Shapes and chips for every component kind, including the hop kinds of an expanded sync link. */
export const ESTATE_NODE_KINDS: Record<string, MermaidRuntime.NodeKindStyle> = {
  ...SYSTEM_NODE_KINDS,
  console: { shape: 'subroutine', icon: REFRESH_ICON, chip: 'console', tone: 'violet' },
  topic: { shape: 'parallelogram', icon: SEND_ICON, chip: 'kafka', tone: 'violet' },
  table: { shape: 'rounded', icon: DATABASE_ICON, chip: 'outbox', tone: 'amber' },
  job: { shape: 'subroutine', chip: 'job', tone: 'slate' },
};

/** Status for a component with no health row in the chosen environment (not checked or not running). */
export const UNKNOWN_STATUS = 'unknown';

/** The components and links a feature selects. */
export interface FeatureSlice {
  componentIds: Set<string>;
  links: EstateLink[];
}

/**
 * Selects a feature's parts: roots and includes, plus everything reachable along outgoing
 * links within `depth` hops (a sync link counts as one hop), minus excludes.
 */
export function resolveFeature(registry: EstateRegistry, feature: EstateFeature): FeatureSlice {
  const excluded = new Set(feature.exclude ?? []);
  const distance = new Map<string, number>();
  const queue: string[] = [];
  for (const id of [...feature.roots, ...(feature.include ?? [])]) {
    if (excluded.has(id) || distance.has(id)) continue;
    distance.set(id, 0);
    queue.push(id);
  }
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const next = distance.get(current)! + 1;
    if (next > feature.depth) continue;
    for (const link of registry.links) {
      if (link.from !== current || excluded.has(link.to) || distance.has(link.to)) continue;
      distance.set(link.to, next);
      queue.push(link.to);
    }
  }
  const componentIds = new Set(distance.keys());
  const links = registry.links.filter(l => componentIds.has(l.from) && componentIds.has(l.to));
  return { componentIds, links };
}

/** Looks a component up, or makes a placeholder so a link to a missing repo still draws. */
function componentOrPlaceholder(registry: EstateRegistry, id: string, kind: ComponentKind): EstateComponent {
  return registry.components.find(c => c.id === id) ?? { id, kind, domain: 'Unknown' };
}

/** The hops of one sync link, as node references and transitions (outbox table and consoles included). */
function syncHops(registry: EstateRegistry, link: SyncLink): { components: EstateComponent[]; transitions: MermaidRuntime.Transition[] } {
  const producer = componentOrPlaceholder(registry, link.producer.console, 'console');
  const topic = componentOrPlaceholder(registry, link.topic, 'topic');
  const consumer = componentOrPlaceholder(registry, link.consumer.console, 'console');
  const components = [producer, topic, consumer];
  const transitions: MermaidRuntime.Transition[] = [];

  if (link.producer.outbox) {
    const { db, table } = link.producer.outbox;
    const dbComponent = componentOrPlaceholder(registry, db, 'db');
    components.unshift({ id: `${db}.${table}`, kind: 'table', domain: dbComponent.domain, summary: { business: 'Messages waiting to be sent.', technical: `Outbox table in ${db}.` } });
    transitions.push({ from: link.from, to: `${db}.${table}`, label: 'insert' });
    transitions.push({ from: `${db}.${table}`, to: producer.id, label: 'poll' });
  } else {
    transitions.push({ from: link.from, to: producer.id, label: 'read' });
  }
  transitions.push({ from: producer.id, to: topic.id, label: link.messageType });
  transitions.push({ from: topic.id, to: consumer.id, label: 'consume' });
  transitions.push({ from: consumer.id, to: link.to, label: 'apply' });
  return { components, transitions };
}

export interface EstateGraphOptions {
  env: string;
  /** Show the outbox table, consoles and topic of each sync link instead of one labelled edge. */
  expandSync: boolean;
  /** Status to use instead of the stored health row, e.g. `running` during a check. */
  statusOverride?: Record<string, string>;
}

export interface EstateGraph {
  nodes: MermaidRuntime.Node[];
  transitions: MermaidRuntime.Transition[];
  groups: MermaidRuntime.NodeGroup[];
  decorations: Record<string, MermaidRuntime.NodeDecoration>;
}

/** Health row lookup for one environment. */
export function healthByComponent(rows: EstateHealthRow[], env: string): Map<string, EstateHealthRow> {
  return new Map(rows.filter(r => r.env === env).map(r => [r.component, r]));
}

/** Chip text for a database from its tags (e.g. `postgres`), or null to keep the kind's default. */
function engineChip(component: EstateComponent): string | null {
  return component.kind === 'db' ? (component.tags ?? []).find(t => t === 'postgres' || t === 'mongo') ?? null : null;
}

/** Builds the graph for one slice, environment and view mode. */
export function buildEstateGraph(registry: EstateRegistry, slice: FeatureSlice, options: EstateGraphOptions): EstateGraph {
  const health = healthByComponent(registry.health, options.env);
  const components = new Map<string, EstateComponent>();
  for (const id of slice.componentIds) components.set(id, componentOrPlaceholder(registry, id, 'api'));

  const transitions = new Map<string, MermaidRuntime.Transition>();
  const addTransition = (t: MermaidRuntime.Transition): void => { transitions.set(`${t.from}>${t.to}>${t.label}`, t); };

  for (const link of slice.links) {
    if (link.type === 'call') {
      addTransition({ from: link.from, to: link.to, label: link.protocol });
    } else if (options.expandSync) {
      const hops = syncHops(registry, link);
      for (const c of hops.components) components.set(c.id, c);
      hops.transitions.forEach(addTransition);
    } else {
      addTransition({ from: link.from, to: link.to, label: `${link.topic} / ${link.messageType}` });
    }
  }

  const directStatus = (id: string): string | undefined => options.statusOverride?.[id] ?? health.get(id)?.status;
  // An outbox table (`db.table`, not a registry component) has no health of its own: it takes its database's.
  const statusOf = (id: string): string => {
    const isTable = id.includes('.') && !registry.components.some(c => c.id === id);
    return directStatus(id) ?? (isTable ? directStatus(id.split('.')[0]) : undefined) ?? UNKNOWN_STATUS;
  };

  const nodes: MermaidRuntime.Node[] = [...components.values()].map(c => ({
    id: c.id,
    title: c.id,
    subtitle: c.custodians?.[0] ?? null,
    type: c.kind,
    status: statusOf(c.id),
    detail: c.summary?.business ?? null,
  }));

  const byDomain = new Map<string, string[]>();
  for (const c of components.values()) byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c.id]);
  const groups: MermaidRuntime.NodeGroup[] = [...byDomain].map(([label, nodeIds]) => ({
    id: `g-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    nodeIds,
  }));

  const decorations: Record<string, MermaidRuntime.NodeDecoration> = {};
  for (const c of components.values()) {
    const chip = engineChip(c);
    if (chip) decorations[c.id] = { chip };
  }

  return { nodes, transitions: [...transitions.values()], groups, decorations };
}

/** Fills `{id}` and `{env}` in a link template. */
export function expandTemplate(template: string, id: string, env: string): string {
  return template.replaceAll('{id}', id).replaceAll('{env}', env);
}

export interface NodeLink {
  label: string;
  url: string;
}

/** Links to copy for one component in one environment; templates set to `null` are left out. */
export function linksFor(registry: EstateRegistry, id: string, env: string): NodeLink[] {
  const environment = registry.environments.find(e => e.id === env);
  if (!environment) return [];
  return Object.entries(environment.templates)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([label, template]) => ({ label, url: expandTemplate(template, id, env) }));
}

/** One line per sync link touching a component, e.g. `sends orders.created / OrderPlaced to inventory-api`. */
export function syncSummaries(registry: EstateRegistry, id: string): string[] {
  return registry.links
    .filter((l): l is SyncLink => l.type === 'sync')
    .flatMap(l => {
      const how = l.producer.outbox ? `outbox ${l.producer.outbox.table}` : 'direct read';
      const lines: string[] = [];
      if (l.from === id) lines.push(`sends ${l.topic} / ${l.messageType} to ${l.to} (${how}, via ${l.producer.console})`);
      if (l.to === id) lines.push(`receives ${l.topic} / ${l.messageType} from ${l.from} (via ${l.consumer.console})`);
      return lines;
    });
}
