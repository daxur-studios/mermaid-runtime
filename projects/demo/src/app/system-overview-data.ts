import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';
import { DATABASE_ICON, REFRESH_ICON, SEND_ICON } from './demo-node-kinds';

/**
 * Synthetic "system overview" data: a CMDB-style inventory of an imaginary shop.
 *
 * Mapping used by the demo (nothing here is library API):
 *   service      -> Node            health      -> Node.status (via statusStyles)
 *   kind of item -> Node.type       call / flow -> Transition (label = protocol)
 *   layer/domain -> NodeGroup       internals   -> Node.subgraph (drill-down)
 */

/** Health states of one item. `healthy`, `degraded`, `down`, `maintenance` map to node colours. */
export type Health = 'healthy' | 'degraded' | 'down' | 'maintenance';

/** Whether an edge is a synchronous call (failure propagates to the caller) or async (decoupled). */
export type EdgeMode = 'sync' | 'async';

export interface ServiceInfo {
  id: string;
  title: string;
  /** Short version/owner line shown under the title. */
  subtitle: string;
  /** Node kind key (see {@link SYSTEM_NODE_KINDS}). */
  type: 'web' | 'gateway' | 'api' | 'topic' | 'queue' | 'consumer' | 'console' | 'db' | 'cache';
  /** Chip text that overrides the kind's default (e.g. `postgres`). */
  chip?: string;
  layer: 'Web apps' | 'Edge' | 'APIs' | 'Messaging' | 'Consumers' | 'Data stores';
  domain: 'Checkout' | 'Catalog' | 'Identity' | 'Comms & analytics' | 'Platform';
  description: string;
  /** Baseline health when no incident is simulated. */
  health: Health;
  /** Optional 0-100 gauge, drawn as the progress ring (e.g. consumer catch-up). */
  gauge?: { percent: number; label: string };
}

export const SERVICES: ServiceInfo[] = [
  { id: 'web-storefront', title: 'Storefront', subtitle: 'v4.2 · team-shop', type: 'web', layer: 'Web apps', domain: 'Checkout', health: 'healthy', description: 'Customer-facing web app. 12k sessions/h at peak.' },
  { id: 'web-admin', title: 'Back office', subtitle: 'v2.9 · team-ops', type: 'web', layer: 'Web apps', domain: 'Platform', health: 'healthy', description: 'Internal admin for orders, catalog and refunds.' },
  { id: 'web-support', title: 'Support desk', subtitle: 'v1.7 · team-care', type: 'web', layer: 'Web apps', domain: 'Platform', health: 'maintenance', description: 'Agent tool. Scheduled maintenance window until 04:00.' },

  { id: 'gateway', title: 'API gateway', subtitle: 'v6.0 · team-platform', type: 'gateway', layer: 'Edge', domain: 'Platform', health: 'healthy', description: 'Auth, rate limiting and routing for every public API.' },

  { id: 'orders-api', title: 'Orders API', subtitle: 'v3.8 · team-shop', type: 'api', layer: 'APIs', domain: 'Checkout', health: 'healthy', description: 'Creates and tracks orders. Emits order events.' },
  { id: 'payments-api', title: 'Payments API', subtitle: 'v2.3 · team-pay', type: 'api', chip: 'grpc', layer: 'APIs', domain: 'Checkout', health: 'healthy', description: 'Card and wallet payments through the external processor.' },
  { id: 'catalog-api', title: 'Catalog API', subtitle: 'v5.1 · team-catalog', type: 'api', layer: 'APIs', domain: 'Catalog', health: 'healthy', description: 'Products, prices and stock levels.' },
  { id: 'users-api', title: 'Users API', subtitle: 'v1.12 · team-identity', type: 'api', layer: 'APIs', domain: 'Identity', health: 'healthy', description: 'Accounts, sessions and addresses.' },

  { id: 'orders-created', title: 'orders.created', subtitle: '12 partitions · 7d', type: 'topic', layer: 'Messaging', domain: 'Checkout', health: 'healthy', description: 'One event per placed order.' },
  { id: 'payments-settled', title: 'payments.settled', subtitle: '6 partitions · 30d', type: 'topic', layer: 'Messaging', domain: 'Checkout', health: 'healthy', description: 'Emitted when the processor confirms a payment.' },
  { id: 'email-queue', title: 'email-queue', subtitle: 'rabbit · 2 consumers', type: 'queue', layer: 'Messaging', domain: 'Comms & analytics', health: 'healthy', description: 'Outbound email jobs. Dead-letter queue is empty.' },

  { id: 'inventory-consumer', title: 'Inventory sync', subtitle: 'group inv-sync', type: 'consumer', layer: 'Consumers', domain: 'Catalog', health: 'healthy', description: 'Reserves and releases stock for each order.' },
  { id: 'notification-consumer', title: 'Notifier', subtitle: 'group notify', type: 'consumer', layer: 'Consumers', domain: 'Comms & analytics', health: 'degraded', description: 'Turns order and payment events into email jobs. Lagging after a deploy.', gauge: { percent: 38, label: 'lag 12k' } },
  { id: 'analytics-consumer', title: 'Analytics ingest', subtitle: 'group analytics', type: 'consumer', layer: 'Consumers', domain: 'Comms & analytics', health: 'healthy', description: 'Streams events into the warehouse.' },
  { id: 'mail-worker', title: 'Mail worker', subtitle: 'v1.4 · team-comms', type: 'consumer', layer: 'Consumers', domain: 'Comms & analytics', health: 'healthy', description: 'Sends the queued emails.' },
  { id: 'kafka-console', title: 'Kafka console', subtitle: 'read-only UI', type: 'console', layer: 'Consumers', domain: 'Platform', health: 'healthy', description: 'Browse topics, consumer groups and lag.' },

  { id: 'orders-db', title: 'orders-db', subtitle: 'pg 16 · 1 primary + 2 replicas', type: 'db', chip: 'postgres', layer: 'Data stores', domain: 'Checkout', health: 'healthy', description: 'Order records. 410 GB.' },
  { id: 'payments-db', title: 'payments-db', subtitle: 'pg 16 · 1 primary + 1 replica', type: 'db', chip: 'postgres', layer: 'Data stores', domain: 'Checkout', health: 'healthy', description: 'Payment attempts and ledger.' },
  { id: 'catalog-db', title: 'catalog-db', subtitle: 'mongo 7 · 3 nodes', type: 'db', chip: 'mongo', layer: 'Data stores', domain: 'Catalog', health: 'healthy', description: 'Product documents.' },
  { id: 'catalog-cache', title: 'catalog-cache', subtitle: 'redis 7 · 3 shards', type: 'cache', layer: 'Data stores', domain: 'Catalog', health: 'healthy', description: 'Hot product reads. 94% hit rate.' },
  { id: 'users-db', title: 'users-db', subtitle: 'pg 16 · 1 primary + 1 replica', type: 'db', chip: 'postgres', layer: 'Data stores', domain: 'Identity', health: 'healthy', description: 'Accounts and sessions.' },
  { id: 'warehouse', title: 'warehouse', subtitle: 'columnar · nightly compaction', type: 'db', chip: 'olap', layer: 'Data stores', domain: 'Comms & analytics', health: 'healthy', description: 'Reporting store fed by the analytics consumer.' },
];

interface Link {
  from: string;
  to: string;
  label: string;
  mode: EdgeMode;
}

const sync = (from: string, to: string, label: string): Link => ({ from, to, label, mode: 'sync' });
const async_ = (from: string, to: string, label: string): Link => ({ from, to, label, mode: 'async' });

export const LINKS: Link[] = [
  sync('web-storefront', 'gateway', 'REST'),
  sync('web-admin', 'gateway', 'REST'),
  sync('web-support', 'gateway', 'REST'),
  sync('gateway', 'orders-api', 'REST'),
  sync('gateway', 'catalog-api', 'REST'),
  sync('gateway', 'users-api', 'REST'),
  sync('orders-api', 'orders-db', 'SQL'),
  sync('orders-api', 'payments-api', 'gRPC'),
  sync('payments-api', 'payments-db', 'SQL'),
  sync('catalog-api', 'catalog-db', 'query'),
  sync('catalog-api', 'catalog-cache', 'cache'),
  sync('users-api', 'users-db', 'SQL'),
  async_('orders-api', 'orders-created', 'produce'),
  async_('payments-api', 'payments-settled', 'produce'),
  async_('orders-created', 'inventory-consumer', 'consume'),
  async_('orders-created', 'notification-consumer', 'consume'),
  async_('orders-created', 'analytics-consumer', 'consume'),
  async_('payments-settled', 'notification-consumer', 'consume'),
  async_('payments-settled', 'analytics-consumer', 'consume'),
  async_('notification-consumer', 'email-queue', 'enqueue'),
  async_('email-queue', 'mail-worker', 'consume'),
  sync('inventory-consumer', 'catalog-db', 'update'),
  sync('analytics-consumer', 'warehouse', 'insert'),
  sync('kafka-console', 'orders-created', 'inspect'),
  sync('kafka-console', 'payments-settled', 'inspect'),
];

/** Shape, icon, chip and tone per kind of item: the legend of the whole diagram. */
export const SYSTEM_NODE_KINDS: Record<string, MermaidRuntime.NodeKindStyle> = {
  web: { shape: 'rounded', chip: 'web', tone: 'teal' },
  gateway: { shape: 'hexagon', chip: 'gateway', tone: 'accent' },
  api: { shape: 'rect', chip: 'rest', tone: 'accent' },
  topic: { shape: 'parallelogram', icon: SEND_ICON, chip: 'kafka', tone: 'violet' },
  queue: { shape: 'parallelogram', icon: SEND_ICON, chip: 'amqp', tone: 'amber' },
  consumer: { shape: 'subroutine', icon: REFRESH_ICON, chip: 'consumer', tone: 'violet' },
  console: { shape: 'rounded', chip: 'console', tone: 'slate' },
  db: { shape: 'rounded', icon: DATABASE_ICON, chip: 'sql', tone: 'green' },
  cache: { shape: 'rounded', icon: DATABASE_ICON, chip: 'redis', tone: 'rose' },
};

/** Health → node CSS class. `healthy` reuses the built-in green "done" treatment. */
export const HEALTH_STATUS_STYLES: MermaidRuntime.StatusStyleMap = {
  healthy: { className: 'done', label: 'Healthy' },
  degraded: { className: 'degraded', label: 'Degraded' },
  down: { className: 'failed', label: 'Down' },
  maintenance: { className: 'skipped', label: 'Maintenance' },
};

/** The three ways the same inventory can be viewed. */
export type SystemView = 'layers' | 'domains' | 'async';

/**
 * Works out each item's health when `failing` is down.
 *
 * Rule: a failed item makes its synchronous callers degraded (the call fails), and makes
 * the consumers of a failed topic degraded (no events). Asynchronous edges stop the
 * spread toward producers, which is the point of a queue.
 */
export function simulateHealth(failing: string | null): Record<string, Health> {
  const health: Record<string, Health> = Object.fromEntries(SERVICES.map(s => [s.id, s.health]));
  if (!failing) return health;
  health[failing] = 'down';
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of LINKS) {
      const from = health[link.from];
      const to = health[link.to];
      const toBroken = to === 'down' || to === 'degraded';
      const fromBroken = from === 'down';
      if (link.mode === 'sync' && toBroken && from === 'healthy') {
        health[link.from] = 'degraded';
        changed = true;
      } else if (link.mode === 'async' && fromBroken && to === 'healthy') {
        health[link.to] = 'degraded';
        changed = true;
      }
    }
  }
  return health;
}

export interface SystemGraph {
  nodes: MermaidRuntime.Node[];
  transitions: MermaidRuntime.Transition[];
  groups: MermaidRuntime.NodeGroup[];
  decorations: Record<string, MermaidRuntime.NodeDecoration>;
}

/** Builds the graph for one view and one health snapshot. */
export function buildSystemGraph(view: SystemView, health: Record<string, Health>): SystemGraph {
  const asyncOnly = view === 'async';
  const links = asyncOnly ? LINKS.filter(l => l.mode === 'async') : LINKS;
  const used = new Set(links.flatMap(l => [l.from, l.to]));
  const services = asyncOnly ? SERVICES.filter(s => used.has(s.id)) : SERVICES;

  const nodes: MermaidRuntime.Node[] = services.map(s => ({
    id: s.id,
    title: s.title,
    subtitle: s.subtitle,
    type: s.type,
    status: health[s.id],
    detail: s.description,
    progressPercent: s.gauge && health[s.id] === 'degraded' ? s.gauge.percent : null,
    progressLabel: s.gauge && health[s.id] === 'degraded' ? s.gauge.label : null,
  }));

  const transitions: MermaidRuntime.Transition[] = links.map(l => ({ from: l.from, to: l.to, label: l.label }));

  const groupKey = (s: ServiceInfo): string => (view === 'domains' ? s.domain : s.layer);
  const byGroup = new Map<string, string[]>();
  for (const s of services) {
    const key = groupKey(s);
    byGroup.set(key, [...(byGroup.get(key) ?? []), s.id]);
  }
  const groups: MermaidRuntime.NodeGroup[] = [...byGroup].map(([label, nodeIds]) => ({
    id: `g-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    label,
    nodeIds,
    direction: 'LR' as const,
  }));

  const decorations: Record<string, MermaidRuntime.NodeDecoration> = {};
  for (const s of services) if (s.chip) decorations[s.id] = { chip: s.chip };

  return { nodes, transitions, groups, decorations };
}
