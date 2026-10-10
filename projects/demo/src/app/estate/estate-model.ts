/**
 * Target data contract from plan 15 (ideal estate model), as TypeScript types.
 *
 * PURPOSE: Let the demo prove the contract end to end: a registry of components and links,
 * feature selections, per-environment link templates and health rows are turned into a
 * `MermaidRuntime` graph by the adapter in `estate-adapter.ts`.
 *
 * VALUE: A host with real data can match these shapes (or write its own adapter to them)
 * and get the same views. Nothing here is library API.
 */

/** What a component is. `table` only appears as a hop in an expanded sync link. */
export type ComponentKind = 'web' | 'api' | 'db' | 'console' | 'topic' | 'queue' | 'cache' | 'job' | 'table';

/** Where a link came from: typed by a person, read from config, or seen at runtime. */
export type Provenance = 'declared' | 'harvested' | 'observed';

/** One repo (or part of a repo). The id is the repo name. */
export interface EstateComponent {
  id: string;
  kind: ComponentKind;
  domain: string;
  tags?: string[];
  summary?: { business: string; technical: string };
  custodians?: string[];
  /** For a db: the tables that matter (outbox tables are found through sync links). */
  tables?: string[];
}

/** A plain request/response or read/write link. */
export interface CallLink {
  id: string;
  type: 'call';
  from: string;
  to: string;
  protocol: string;
  provenance: Provenance;
}

/**
 * Information sync between two components through Kafka and custom consoles.
 *
 * With `producer.outbox` the API writes the message to its own SQL table and the producer
 * console publishes it; without it, the console reads from the API and publishes directly.
 */
export interface SyncLink {
  id: string;
  type: 'sync';
  from: string;
  to: string;
  topic: string;
  messageType: string;
  producer: { console: string; outbox?: { db: string; table: string } };
  consumer: { console: string };
  provenance: Provenance;
  verifiedAt?: string;
}

export type EstateLink = CallLink | SyncLink;

/** A selection, not a description: roots plus everything connected within `depth` link hops. */
export interface EstateFeature {
  id: string;
  name: string;
  roots: string[];
  include?: string[];
  exclude?: string[];
  depth: number;
}

/** One environment. Templates use `{id}` and `{env}`; `null` means the link does not exist there. */
export interface EstateEnvironment {
  id: string;
  label: string;
  templates: Record<string, string | null>;
}

export type EstateHealthStatus = 'healthy' | 'degraded' | 'down' | 'maintenance';

/** The latest check result for one component in one environment. */
export interface EstateHealthRow {
  component: string;
  env: string;
  status: EstateHealthStatus;
  at: string;
  detail?: string;
}

export interface EstateRegistry {
  components: EstateComponent[];
  links: EstateLink[];
  features: EstateFeature[];
  environments: EstateEnvironment[];
  health: EstateHealthRow[];
}
