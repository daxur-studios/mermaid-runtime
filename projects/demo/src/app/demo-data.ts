import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';

export const workflowNodes: MermaidRuntime.Node[] = [
  { id: 'brief', title: 'Read brief', detail: 'Collect goals and constraints', status: 'complete' },
  { id: 'research', title: 'Research', detail: 'Find relevant source material', status: 'complete' },
  { id: 'plan', title: 'Plan approach', detail: 'Choose the best execution path', status: 'running', progressPercent: 64, progressLabel: 'Structuring tasks' },
  { id: 'build', title: 'Build output', detail: 'Create the requested artifacts', status: 'undone' },
  { id: 'review', title: 'Quality review', detail: 'Validate the completed work', status: 'undone' },
  { id: 'ship', title: 'Deliver', detail: 'Send the final result', status: 'undone' },
];

export const workflowTransitions: MermaidRuntime.Transition[] = [
  { from: 'brief', to: 'research' }, { from: 'research', to: 'plan' },
  { from: 'plan', to: 'build', label: 'approved' }, { from: 'plan', to: 'research', label: 'more context' },
  { from: 'build', to: 'review' }, { from: 'review', to: 'ship', label: 'passes' },
  { from: 'review', to: 'build', label: 'changes' },
];

export const nestedNodes: MermaidRuntime.Node[] = [
  { id: 'intake', title: 'Intake request', status: 'complete' },
  { id: 'pipeline', title: 'Run content pipeline', status: 'running', subgraphLabel: '3 steps', subgraph: {
    nodes: [
      { id: 'draft', title: 'Draft', status: 'complete' },
      { id: 'fact-check', title: 'Fact check', status: 'running', subgraphLabel: 'Checks', subgraph: {
        nodes: [{ id: 'sources', title: 'Verify sources', status: 'complete' }, { id: 'claims', title: 'Check claims', status: 'running' }],
        transitions: [{ from: 'sources', to: 'claims' }],
      }},
      { id: 'edit', title: 'Edit', status: 'undone' },
    ],
    transitions: [{ from: 'draft', to: 'fact-check' }, { from: 'fact-check', to: 'edit' }],
  }},
  { id: 'publish', title: 'Publish result', status: 'undone' },
  { id: 'notify', title: 'Notify owner', status: 'undone' },
];
export const nestedTransitions: MermaidRuntime.Transition[] = [
  { from: 'intake', to: 'pipeline' }, { from: 'pipeline', to: 'publish' }, { from: 'publish', to: 'notify' },
];
export const nestedGroups: MermaidRuntime.NodeGroup[] = [
  { id: 'execution', label: 'Execution', nodeIds: ['pipeline', 'publish'] },
];

export const replayBaseNodes: MermaidRuntime.Node[] = workflowNodes.map(node => ({ ...node, status: 'undone', progressPercent: null }));
export const replayEvents: MermaidRuntime.ExecutionEvent[] = [
  ['node-started', 'brief'], ['node-ended', 'brief', 'complete'], ['edge-traversed'],
  ['node-started', 'research'], ['node-ended', 'research', 'complete'], ['edge-traversed'],
  ['node-started', 'plan'], ['node-ended', 'plan', 'complete'], ['edge-traversed'],
  ['node-started', 'build'], ['node-ended', 'build', 'complete'], ['edge-traversed'],
  ['node-started', 'review'], ['node-ended', 'review', 'complete'], ['edge-traversed'],
  ['node-started', 'ship'], ['node-ended', 'ship', 'complete'],
].map(([kind, nodeId, status], index) => ({
  seq: index + 1, at: new Date(Date.UTC(2026, 6, 13, 10, 0, index * 5)).toISOString(),
  kind: kind as MermaidRuntime.ExecutionEventKind, nodeId: nodeId ?? null,
  status: status as MermaidRuntime.NodeStatus | undefined,
}));
