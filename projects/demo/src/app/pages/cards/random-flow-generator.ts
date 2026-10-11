import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';

export type FlowTopologyType =
  | 'diamond'
  | 'fan-out-in'
  | 'bypass'
  | 'mesh'
  | 'parallel-checks'
  | 'tree'
  | 'conditional-fallback'
  | 'random-dag';

export type FlowStatusProfile = 'running' | 'complete' | 'failed' | 'idle' | 'random';

export interface GeneratedFlow {
  topology: FlowTopologyType;
  topologyName: string;
  graph: MermaidRuntime.Graph;
}

/**
 * Creates a diamond topology:
 * Ingress -> (Branch A, Branch B) -> Join -> Output
 */
export function createDiamondFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const statuses = resolveStatuses(['complete', 'complete', 'running', 'undone', 'undone'], profile, 2);
  const nodes: MermaidRuntime.Node[] = [
    { id: 'in', title: 'Ingress Gateway', status: statuses[0] },
    { id: 'branchA', title: 'Paypal Route', status: statuses[1] },
    { id: 'branchB', title: 'Stripe Route', status: statuses[2] },
    { id: 'join', title: 'Ledger Settlement', status: statuses[3] },
    { id: 'out', title: 'Receipt Webhook', status: statuses[4] },
  ];

  const transitions: MermaidRuntime.Transition[] = [
    { from: 'in', to: 'branchA' },
    { from: 'in', to: 'branchB' },
    { from: 'branchA', to: 'join' },
    { from: 'branchB', to: 'join' },
    { from: 'join', to: 'out' },
  ];

  return {
    topology: 'diamond',
    topologyName: 'Diamond (Split & Join)',
    graph: { nodes, transitions },
  };
}

/**
 * Creates a wide fan-out to fan-in topology (1 to 4 to 1):
 * Dispatcher -> (Worker 1..4) -> Collector -> Notify
 */
export function createFanOutInFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const statuses = resolveStatuses(
    ['complete', 'complete', 'complete', 'running', 'undone', 'undone', 'undone'],
    profile,
    3
  );

  const nodes: MermaidRuntime.Node[] = [
    { id: 'dispatch', title: 'Job Dispatcher', status: statuses[0] },
    { id: 'w1', title: 'Worker A (Chunk 1)', status: statuses[1] },
    { id: 'w2', title: 'Worker B (Chunk 2)', status: statuses[2] },
    { id: 'w3', title: 'Worker C (Chunk 3)', status: statuses[3] },
    { id: 'w4', title: 'Worker D (Chunk 4)', status: statuses[4] },
    { id: 'collect', title: 'Reduce Results', status: statuses[5] },
    { id: 'notify', title: 'Notify Complete', status: statuses[6] },
  ];

  const transitions: MermaidRuntime.Transition[] = [
    { from: 'dispatch', to: 'w1' },
    { from: 'dispatch', to: 'w2' },
    { from: 'dispatch', to: 'w3' },
    { from: 'dispatch', to: 'w4' },
    { from: 'w1', to: 'collect' },
    { from: 'w2', to: 'collect' },
    { from: 'w3', to: 'collect' },
    { from: 'w4', to: 'collect' },
    { from: 'collect', to: 'notify' },
  ];

  return {
    topology: 'fan-out-in',
    topologyName: 'Fan-out / Fan-in (Worker Pool)',
    graph: { nodes, transitions },
  };
}

/**
 * Creates a pipeline with shortcut / bypass edges:
 * Fetch -> Validate -> (Normal Path -> Enrich) -> Store
 * Plus shortcut: Fetch -> Fast Cache -> Store
 */
export function createBypassFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const statuses = resolveStatuses(['complete', 'complete', 'running', 'undone', 'complete', 'undone'], profile, 2);

  const nodes: MermaidRuntime.Node[] = [
    { id: 'fetch', title: 'Fetch Input', status: statuses[0] },
    { id: 'val', title: 'Validate Schema', status: statuses[1] },
    { id: 'enrich', title: 'Deep Enrichment', status: statuses[2] },
    { id: 'cache', title: 'Cache Shortcut', status: statuses[4] },
    { id: 'store', title: 'Write Postgres', status: statuses[3] },
    { id: 'audit', title: 'Audit Trail', status: statuses[5] },
  ];

  const transitions: MermaidRuntime.Transition[] = [
    { from: 'fetch', to: 'val' },
    { from: 'val', to: 'enrich' },
    { from: 'enrich', to: 'store' },
    { from: 'fetch', to: 'cache' },
    { from: 'cache', to: 'store' },
    { from: 'store', to: 'audit' },
  ];

  return {
    topology: 'bypass',
    topologyName: 'Pipeline with Bypass Shortcut',
    graph: { nodes, transitions },
  };
}

/**
 * Creates a mesh / multi-producer to multi-consumer topology:
 * (Ingest A, Ingest B) -> Broker -> (Analytics, CRM, Search Index)
 */
export function createMeshFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const statuses = resolveStatuses(['complete', 'complete', 'running', 'running', 'undone', 'undone'], profile, 2);

  const nodes: MermaidRuntime.Node[] = [
    { id: 'prodA', title: 'Kafka Topic Orders', status: statuses[0] },
    { id: 'prodB', title: 'Webhook Ingest', status: statuses[1] },
    { id: 'broker', title: 'Event Router', status: statuses[2] },
    { id: 'cons1', title: 'Search Indexer', status: statuses[3] },
    { id: 'cons2', title: 'Analytics Warehouse', status: statuses[4] },
    { id: 'cons3', title: 'Customer Notification', status: statuses[5] },
  ];

  const transitions: MermaidRuntime.Transition[] = [
    { from: 'prodA', to: 'broker' },
    { from: 'prodB', to: 'broker' },
    { from: 'broker', to: 'cons1' },
    { from: 'broker', to: 'cons2' },
    { from: 'broker', to: 'cons3' },
  ];

  return {
    topology: 'mesh',
    topologyName: 'Mesh (2-Producers to 3-Consumers)',
    graph: { nodes, transitions },
  };
}

/**
 * Creates a parallel validation gatekeeper:
 * Trigger -> (Lint, Types, Unit, E2E, Security) -> Release
 */
export function createParallelChecksFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const statuses = resolveStatuses(
    ['complete', 'complete', 'complete', 'complete', 'running', 'undone', 'undone'],
    profile,
    4
  );

  const nodes: MermaidRuntime.Node[] = [
    { id: 'commit', title: 'Git Push', status: statuses[0] },
    { id: 'lint', title: 'ESLint', status: statuses[1] },
    { id: 'types', title: 'TypeScript Build', status: statuses[2] },
    { id: 'unit', title: 'Unit Tests', status: statuses[3] },
    { id: 'sec', title: 'Security Scan', status: statuses[4] },
    { id: 'e2e', title: 'Playwright E2E', status: statuses[5] },
    { id: 'deploy', title: 'Prod Deployment', status: statuses[6] },
  ];

  const transitions: MermaidRuntime.Transition[] = [
    { from: 'commit', to: 'lint' },
    { from: 'commit', to: 'types' },
    { from: 'commit', to: 'unit' },
    { from: 'commit', to: 'sec' },
    { from: 'commit', to: 'e2e' },
    { from: 'lint', to: 'deploy' },
    { from: 'types', to: 'deploy' },
    { from: 'unit', to: 'deploy' },
    { from: 'sec', to: 'deploy' },
    { from: 'e2e', to: 'deploy' },
  ];

  return {
    topology: 'parallel-checks',
    topologyName: 'Validation Matrix (5 Parallel Checks)',
    graph: { nodes, transitions },
  };
}

/**
 * Creates a tree / hierarchical branching flow:
 * Root -> (Alpha, Beta) -> (Alpha1, Alpha2, Beta1, Beta2)
 */
export function createTreeFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const statuses = resolveStatuses(
    ['complete', 'complete', 'running', 'complete', 'undone', 'undone', 'undone'],
    profile,
    2
  );

  const nodes: MermaidRuntime.Node[] = [
    { id: 'root', title: 'Orchestrator Root', status: statuses[0] },
    { id: 'stageA', title: 'Data Prep Stage', status: statuses[1] },
    { id: 'stageB', title: 'Model Train Stage', status: statuses[2] },
    { id: 'taskA1', title: 'Clean CSVs', status: statuses[3] },
    { id: 'taskA2', title: 'Tokenize Text', status: statuses[4] },
    { id: 'taskB1', title: 'Fine-tune LoRA', status: statuses[5] },
    { id: 'taskB2', title: 'Eval Benchmark', status: statuses[6] },
  ];

  const transitions: MermaidRuntime.Transition[] = [
    { from: 'root', to: 'stageA' },
    { from: 'root', to: 'stageB' },
    { from: 'stageA', to: 'taskA1' },
    { from: 'stageA', to: 'taskA2' },
    { from: 'stageB', to: 'taskB1' },
    { from: 'stageB', to: 'taskB2' },
  ];

  return {
    topology: 'tree',
    topologyName: 'Hierarchical Tree Branching',
    graph: { nodes, transitions },
  };
}

/**
 * Creates a conditional fallback flow:
 * Request -> Auth -> Route -> (Primary Success, Fallback Alternate) -> Audit
 */
export function createConditionalFallbackFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const statuses = resolveStatuses(['complete', 'complete', 'complete', 'failed', 'running', 'undone'], profile, 3);

  const nodes: MermaidRuntime.Node[] = [
    { id: 'req', title: 'API Request', status: statuses[0] },
    { id: 'auth', title: 'JWT Validate', status: statuses[1] },
    { id: 'eval', title: 'Feature Flag Check', status: statuses[2] },
    { id: 'primary', title: 'Primary V2 API', status: statuses[3] },
    { id: 'fallback', title: 'Legacy V1 Fallback', status: statuses[4] },
    { id: 'resp', title: 'Return Response', status: statuses[5] },
  ];

  const transitions: MermaidRuntime.Transition[] = [
    { from: 'req', to: 'auth' },
    { from: 'auth', to: 'eval' },
    { from: 'eval', to: 'primary' },
    { from: 'eval', to: 'fallback' },
    { from: 'primary', to: 'resp' },
    { from: 'fallback', to: 'resp' },
  ];

  return {
    topology: 'conditional-fallback',
    topologyName: 'Conditional Branch & Fallback',
    graph: { nodes, transitions },
  };
}

/**
 * Procedurally generates a random DAG with 5-8 nodes and non-linear branching.
 */
export function createRandomDagFlow(profile: FlowStatusProfile = 'random'): GeneratedFlow {
  const nodeCount = 5 + Math.floor(Math.random() * 4); // 5 to 8 nodes
  const nodes: MermaidRuntime.Node[] = [];
  const titles = [
    'Init Context',
    'Fetch Spec',
    'Parse AST',
    'Compile Module',
    'Run Lint',
    'Emit Artifact',
    'Sign Binary',
    'Publish S3',
  ];

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `node_${i}`,
      title: titles[i] || `Stage ${i + 1}`,
      status: 'undone',
    });
  }

  // Assign statuses based on profile
  const assigned = resolveStatuses(
    nodes.map((_, i) => (i < Math.floor(nodeCount / 2) ? 'complete' : i === Math.floor(nodeCount / 2) ? 'running' : 'undone')),
    profile,
    Math.floor(nodeCount / 2)
  );

  for (let i = 0; i < nodeCount; i++) {
    nodes[i].status = assigned[i] || 'undone';
  }

  // Create random non-linear forward transitions
  const transitions: MermaidRuntime.Transition[] = [];
  // Ensure connectivity from 0 to 1 and 0 to 2
  transitions.push({ from: nodes[0].id, to: nodes[1].id });
  if (nodeCount > 2) {
    transitions.push({ from: nodes[0].id, to: nodes[2].id });
  }

  // Add random forward branches
  for (let i = 1; i < nodeCount - 1; i++) {
    const nextHop = i + 1;
    transitions.push({ from: nodes[i].id, to: nodes[nextHop].id });

    // Optional cross-hop skip link
    if (i + 2 < nodeCount && Math.random() > 0.4) {
      transitions.push({ from: nodes[i].id, to: nodes[i + 2].id });
    }
  }

  return {
    topology: 'random-dag',
    topologyName: `Custom DAG (${nodeCount} Nodes, Non-Linear)`,
    graph: { nodes, transitions },
  };
}

/**
 * Returns a flow with a specific or random topology.
 */
export function generateVariedFlow(
  topology?: FlowTopologyType,
  profile: FlowStatusProfile = 'random'
): GeneratedFlow {
  const types: FlowTopologyType[] = [
    'diamond',
    'fan-out-in',
    'bypass',
    'mesh',
    'parallel-checks',
    'tree',
    'conditional-fallback',
    'random-dag',
  ];

  const chosen = topology || types[Math.floor(Math.random() * types.length)];

  switch (chosen) {
    case 'diamond':
      return createDiamondFlow(profile);
    case 'fan-out-in':
      return createFanOutInFlow(profile);
    case 'bypass':
      return createBypassFlow(profile);
    case 'mesh':
      return createMeshFlow(profile);
    case 'parallel-checks':
      return createParallelChecksFlow(profile);
    case 'tree':
      return createTreeFlow(profile);
    case 'conditional-fallback':
      return createConditionalFallbackFlow(profile);
    case 'random-dag':
    default:
      return createRandomDagFlow(profile);
  }
}

/**
 * Helper to resolve node statuses according to profile.
 */
function resolveStatuses(
  defaults: MermaidRuntime.NodeStatus[],
  profile: FlowStatusProfile,
  failIndex = 2
): MermaidRuntime.NodeStatus[] {
  if (profile === 'complete') {
    return defaults.map(() => 'complete');
  }
  if (profile === 'idle') {
    return defaults.map(() => 'undone');
  }
  if (profile === 'failed') {
    return defaults.map((_, i) => (i < failIndex ? 'complete' : i === failIndex ? 'failed' : 'undone'));
  }
  if (profile === 'running') {
    return defaults;
  }
  // Random profile
  const rand = Math.random();
  if (rand < 0.35) {
    return defaults; // running
  }
  if (rand < 0.6) {
    return defaults.map(() => 'complete');
  }
  if (rand < 0.8) {
    return defaults.map((_, i) => (i < failIndex ? 'complete' : i === failIndex ? 'failed' : 'undone'));
  }
  return defaults.map(() => 'undone');
}
