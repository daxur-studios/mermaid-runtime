import {
  CallLink,
  ComponentKind,
  EstateComponent,
  EstateHealthRow,
  EstateHealthStatus,
  EstateRegistry,
  SyncLink,
} from './estate-model';

/**
 * Synthetic registry: a small imaginary shop that follows the plan 15 contract.
 * Every name and URL is made up (`.example.test` hosts only).
 */

const CHECK_TIME = '2026-10-08T09:00:00Z';

function component(
  id: string,
  kind: ComponentKind,
  domain: string,
  business: string,
  technical: string,
  extra: Partial<EstateComponent> = {},
): EstateComponent {
  return { id, kind, domain, summary: { business, technical }, custodians: [`team-${domain.toLowerCase()}`], ...extra };
}

const COMPONENTS: EstateComponent[] = [
  // Checkout
  component('orders-web', 'web', 'Checkout', 'Where customers place and follow orders.', 'Angular SPA behind the gateway.', { tags: ['spa', 'orders'] }),
  component('orders-api', 'api', 'Checkout', 'Creates and tracks orders.', '.NET API. Writes order events to its outbox table.', { tags: ['orders', 'dotnet', 'outbox'] }),
  component('orders-db', 'db', 'Checkout', 'Order records.', 'Postgres. Tables: orders, order_items, order_outbox.', { tags: ['postgres'], tables: ['orders', 'order_items', 'order_outbox'] }),
  component('payments-api', 'api', 'Checkout', 'Takes card and wallet payments.', '.NET API in front of the external processor. Legacy: no outbox.', { tags: ['payments', 'dotnet', 'legacy'] }),
  component('payments-db', 'db', 'Checkout', 'Payment attempts and ledger.', 'Postgres.', { tags: ['postgres'], tables: ['attempts', 'ledger'] }),
  component('orders-relay', 'console', 'Checkout', 'Publishes order events.', 'Console runner. Polls order_outbox and publishes to Kafka.', { tags: ['console', 'outbox'] }),
  component('payments-publisher', 'console', 'Checkout', 'Publishes payment results.', 'Console runner. Reads settled payments from the API and publishes.', { tags: ['console', 'legacy'] }),
  component('orders-ingest', 'console', 'Checkout', 'Applies payment results to orders.', 'Console runner. Consumes payments.settled and calls the Orders API.', { tags: ['console'] }),
  component('orders.created', 'topic', 'Checkout', 'One event per placed order.', 'Kafka topic, 12 partitions.', { tags: ['kafka'] }),
  component('payments.settled', 'topic', 'Checkout', 'One event per confirmed payment.', 'Kafka topic, 6 partitions.', { tags: ['kafka'] }),

  // Catalog
  component('catalog-web', 'web', 'Catalog', 'Product browsing.', 'Angular SPA.', { tags: ['spa'] }),
  component('catalog-api', 'api', 'Catalog', 'Products, prices and stock levels.', '.NET API.', { tags: ['catalog', 'dotnet'] }),
  component('catalog-db', 'db', 'Catalog', 'Product documents.', 'Mongo.', { tags: ['mongo'] }),
  component('inventory-api', 'api', 'Catalog', 'Stock reservations.', '.NET API. Writes stock events to its outbox.', { tags: ['inventory', 'dotnet', 'outbox'] }),
  component('inventory-db', 'db', 'Catalog', 'Stock levels and reservations.', 'Postgres. Tables: stock, stock_outbox.', { tags: ['postgres'], tables: ['stock', 'stock_outbox'] }),
  component('inventory-ingest', 'console', 'Catalog', 'Reserves stock for each order.', 'Console runner. Consumes orders.created.', { tags: ['console'] }),
  component('inventory-relay', 'console', 'Catalog', 'Publishes stock changes.', 'Console runner. Polls stock_outbox and publishes to Kafka.', { tags: ['console', 'outbox'] }),
  component('catalog-ingest', 'console', 'Catalog', 'Updates catalog stock levels.', 'Console runner. Consumes inventory.adjusted.', { tags: ['console'] }),
  component('inventory.adjusted', 'topic', 'Catalog', 'One event per stock change.', 'Kafka topic, 6 partitions.', { tags: ['kafka'] }),

  // Identity
  component('users-web', 'web', 'Identity', 'Sign-up and account pages.', 'Angular SPA.', { tags: ['spa'] }),
  component('users-api', 'api', 'Identity', 'Accounts and sessions.', '.NET API. Writes user events to its outbox.', { tags: ['identity', 'dotnet', 'outbox'] }),
  component('users-db', 'db', 'Identity', 'Accounts.', 'Postgres. Tables: users, users_outbox.', { tags: ['postgres'], tables: ['users', 'users_outbox'] }),
  component('users-relay', 'console', 'Identity', 'Publishes account events.', 'Console runner. Polls users_outbox and publishes to Kafka.', { tags: ['console', 'outbox'] }),
  component('users.registered', 'topic', 'Identity', 'One event per new account.', 'Kafka topic, 3 partitions.', { tags: ['kafka'] }),

  // Comms
  component('notifications-api', 'api', 'Comms', 'Customer emails and push messages.', '.NET API.', { tags: ['comms', 'dotnet'] }),
  component('notifications-db', 'db', 'Comms', 'Message history.', 'Postgres.', { tags: ['postgres'], tables: ['messages'] }),
  component('notify-ingest', 'console', 'Comms', 'Turns events into messages.', 'Console runner. Consumes orders.created and users.registered.', { tags: ['console'] }),
];

const call = (id: string, from: string, to: string, protocol: string): CallLink => ({ id, type: 'call', from, to, protocol, provenance: 'harvested' });

const LINKS_CALLS: CallLink[] = [
  call('orders-web-api', 'orders-web', 'orders-api', 'REST'),
  call('orders-api-db', 'orders-api', 'orders-db', 'SQL'),
  call('orders-api-payments', 'orders-api', 'payments-api', 'REST'),
  call('payments-api-db', 'payments-api', 'payments-db', 'SQL'),
  call('catalog-web-api', 'catalog-web', 'catalog-api', 'REST'),
  call('catalog-api-db', 'catalog-api', 'catalog-db', 'query'),
  call('inventory-api-db', 'inventory-api', 'inventory-db', 'SQL'),
  call('users-web-api', 'users-web', 'users-api', 'REST'),
  call('users-api-db', 'users-api', 'users-db', 'SQL'),
  call('notifications-api-db', 'notifications-api', 'notifications-db', 'SQL'),
];

const LINKS_SYNC: SyncLink[] = [
  {
    id: 'orders-to-inventory', type: 'sync', from: 'orders-api', to: 'inventory-api',
    topic: 'orders.created', messageType: 'OrderPlaced',
    producer: { console: 'orders-relay', outbox: { db: 'orders-db', table: 'order_outbox' } },
    consumer: { console: 'inventory-ingest' }, provenance: 'declared', verifiedAt: '2026-10-01',
  },
  {
    id: 'orders-to-notifications', type: 'sync', from: 'orders-api', to: 'notifications-api',
    topic: 'orders.created', messageType: 'OrderPlaced',
    producer: { console: 'orders-relay', outbox: { db: 'orders-db', table: 'order_outbox' } },
    consumer: { console: 'notify-ingest' }, provenance: 'declared', verifiedAt: '2026-10-01',
  },
  {
    id: 'payments-to-orders', type: 'sync', from: 'payments-api', to: 'orders-api',
    topic: 'payments.settled', messageType: 'PaymentSettled',
    producer: { console: 'payments-publisher' },
    consumer: { console: 'orders-ingest' }, provenance: 'harvested',
  },
  {
    id: 'inventory-to-catalog', type: 'sync', from: 'inventory-api', to: 'catalog-api',
    topic: 'inventory.adjusted', messageType: 'StockAdjusted',
    producer: { console: 'inventory-relay', outbox: { db: 'inventory-db', table: 'stock_outbox' } },
    consumer: { console: 'catalog-ingest' }, provenance: 'declared', verifiedAt: '2026-09-20',
  },
  {
    id: 'users-to-notifications', type: 'sync', from: 'users-api', to: 'notifications-api',
    topic: 'users.registered', messageType: 'UserRegistered',
    producer: { console: 'users-relay', outbox: { db: 'users-db', table: 'users_outbox' } },
    consumer: { console: 'notify-ingest' }, provenance: 'declared', verifiedAt: '2026-10-02',
  },
];

/** Component ids the local emulator runs for the checkout feature (everything else is not started). */
const LOCAL_RUNNING = [
  'orders-web', 'orders-api', 'orders-db', 'payments-api', 'payments-db',
  'inventory-api', 'inventory-db', 'notifications-api', 'notifications-db',
  'orders-relay', 'payments-publisher', 'orders-ingest', 'inventory-ingest', 'notify-ingest',
  'orders.created', 'payments.settled',
];

/** Deployed-environment problems to show: `env:component` -> status and detail. */
const INCIDENTS: Record<string, [EstateHealthStatus, string]> = {
  'qa:orders-relay': ['down', 'heartbeat 42 min old; oldest unsent outbox row 41 min'],
  'qa:notifications-api': ['degraded', 'p95 2.1 s (limit 800 ms)'],
  'dev:notify-ingest': ['degraded', 'consumer lag 12k messages'],
  'dev:users-web': ['maintenance', 'deploy window until 04:00'],
  'uat:payments-api': ['down', '503 from /health'],
};

function buildHealth(): EstateHealthRow[] {
  const rows: EstateHealthRow[] = [];
  for (const c of COMPONENTS) {
    for (const env of ['dev', 'qa', 'uat']) {
      const incident = INCIDENTS[`${env}:${c.id}`];
      rows.push({ component: c.id, env, status: incident?.[0] ?? 'healthy', at: CHECK_TIME, detail: incident?.[1] });
    }
    if (LOCAL_RUNNING.includes(c.id)) rows.push({ component: c.id, env: 'local', status: 'healthy', at: CHECK_TIME, detail: 'emulator' });
  }
  return rows;
}

export const ESTATE_REGISTRY: EstateRegistry = {
  components: COMPONENTS,
  links: [...LINKS_CALLS, ...LINKS_SYNC],
  features: [
    { id: 'checkout', name: 'Checkout', roots: ['orders-web'], depth: 3 },
    { id: 'catalog', name: 'Catalog and stock', roots: ['catalog-web'], include: ['inventory-api'], depth: 2 },
    { id: 'onboarding', name: 'Sign-up', roots: ['users-web'], depth: 3 },
  ],
  environments: [
    { id: 'local', label: 'Local emulator', templates: { repo: 'https://git.example.test/shop/{id}', app: 'http://localhost:5000/{id}', build: null, release: null } },
    { id: 'dev', label: 'Dev', templates: { repo: 'https://git.example.test/shop/{id}', app: 'https://{id}.{env}.example.test', build: 'https://ci.example.test/{env}/{id}/latest', release: 'https://releases.example.test/{id}/{env}' } },
    { id: 'qa', label: 'QA', templates: { repo: 'https://git.example.test/shop/{id}', app: 'https://{id}.{env}.example.test', build: 'https://ci.example.test/{env}/{id}/latest', release: 'https://releases.example.test/{id}/{env}' } },
    { id: 'uat', label: 'UAT', templates: { repo: 'https://git.example.test/shop/{id}', app: 'https://{id}.{env}.example.test', build: 'https://ci.example.test/{env}/{id}/latest', release: 'https://releases.example.test/{id}/{env}' } },
  ],
  health: buildHealth(),
};
