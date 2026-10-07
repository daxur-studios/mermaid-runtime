import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';

export type DemoEnvironment = 'local' | 'dev';
export type DemoView = 'grouped' | 'flat' | 'subflows';

interface StepDefinition { title: string; type: string; detail: string; }
interface PhaseDefinition { title: string; steps: StepDefinition[]; }

const phases: PhaseDefinition[] = [
  { title: 'Feature readiness', steps: [
    { title: 'Assert environment', type: 'assert', detail: 'Capture the selected target for this synthetic run.' },
    { title: 'Check trip APIs', type: 'HTTP', detail: 'Feature profile: trip API and identity API are available.' },
    { title: 'Check required tables', type: 'SQL', detail: 'Feature profile: legacy trip, cache, and public trip tables are available.' },
    { title: 'Check legacy UI', type: 'Playwright', detail: 'Feature profile: the legacy trip-entry UI is reachable.' },
  ] },
  { title: 'Local preparation', steps: [
    { title: 'Flush local trip DB', type: 'SQL', detail: 'Local-only preparation. Shared dev never executes this operation.' },
    { title: 'Seed reference data', type: 'SQL', detail: 'Seed synthetic depots, vehicles, and routes.' },
    { title: 'Reset local cache', type: 'SQL', detail: 'Clear the local synchronization cache.' },
    { title: 'Assert seed ready', type: 'assert', detail: 'Validate the local fixture before creating a trip.' },
  ] },
  { title: 'Subscribe before action', steps: [
    { title: 'Subscribe trip topic', type: 'Kafka', detail: 'Create a synthetic trip-created subscription before submitting the UI.' },
    { title: 'Subscribe sync topic', type: 'Kafka', detail: 'Create a synthetic trip-synchronized subscription.' },
    { title: 'Await listener readiness', type: 'Kafka', detail: 'Model the readiness barrier before a message-producing action.' },
    { title: 'Arm message buffer', type: 'context', detail: 'The host retains matching messages even before the explicit wait step.' },
  ] },
  { title: 'Create trip in legacy UI', steps: [
    { title: 'Open trip-entry page', type: 'Playwright', detail: 'Start a parameterized legacy UI script. No browser is actually launched.' },
    { title: 'Fill trip parameters', type: 'Playwright', detail: 'Use the synthetic depot and headed/headless draft configuration.' },
    { title: 'Submit trip leg', type: 'Playwright', detail: 'Simulate submitting the legacy form.' },
    { title: 'Capture trip number', type: 'context', detail: 'Capture a synthetic legacy trip number into run context.' },
  ] },
  { title: 'Parallel synchronization', steps: [
    { title: 'Await Kafka message', type: 'Kafka', detail: 'Consume the correlated synthetic message from the pre-armed buffer.' },
    { title: 'Poll SQL cache', type: 'SQL', detail: 'In parallel with Kafka, poll until the synthetic trip cache row is ready.' },
    { title: 'Read public trip API', type: 'HTTP', detail: 'Join both waits, then GET /api/trips/by-legacy-number/{tripNumber}.' },
    { title: 'Capture public GUID', type: 'context', detail: 'Store the synthetic public GUID alongside the legacy trip number.' },
  ] },
  { title: 'Assert and clean up', steps: [
    { title: 'Assert trip mapping', type: 'assert', detail: 'Expected: the public GUID maps to the captured legacy trip number.' },
    { title: 'Assert API result', type: 'assert', detail: 'Expected: the public trip API returns the requested depot and trip leg.' },
    { title: 'Assert sync evidence', type: 'assert', detail: 'Expected: matching Kafka and cache evidence exists for this run.' },
    { title: 'Close subscriptions', type: 'Kafka', detail: 'Release the synthetic listeners. The fixture makes no external connections.' },
  ] },
];

export const DEMO_END = 24;

/** A synthetic CLI call for a step. Assert steps carry quotes and angle brackets, to check they are escaped. */
function buildCommand(step: StepDefinition): string {
  const slug = step.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return step.type === 'assert'
    ? `tripcli assert ${slug} --expect "<public_guid>" --depot {{depotId}}`
    : `tripcli ${step.type.toLowerCase()} ${slug} {{tripId}}`;
}

/** Long, realistic step names, so label wrapping can be checked. SQL steps also carry one unbreakable identifier. */
function buildLongTitle(step: StepDefinition): string {
  const identifier = step.type === 'SQL' ? ' [trip_cache.public_guid_mapping_by_legacy_number]' : '';
  return `${step.title}: ${step.detail}${identifier}`;
}

/**
 * Simulated milliseconds that one demo tick stands for.
 *
 * VALUE: Lets running steps show a counting-up time that matches the simulated clock.
 */
const SIM_MS_PER_TICK = 1000;

/** Shortest synthetic step time, in milliseconds. */
const MIN_STEP_MS = 700;

/** How much a step's synthetic time can grow beyond the minimum, in steps of {@link STEP_MS_INCREMENT}. */
const STEP_MS_VARIETY = 9;

/** Size of one increment of synthetic step time, in milliseconds. */
const STEP_MS_INCREMENT = 450;

/** Time the failing SQL wait ran before it gave up, in milliseconds (matches its error text). */
const TIMEOUT_STEP_MS = 30_000;

/** Deterministic step time from its position, so the demo looks the same on every run. */
function syntheticStepMs(phase: number, index: number): number {
  return MIN_STEP_MS + ((phase * 7 + index * 13) % STEP_MS_VARIETY) * STEP_MS_INCREMENT;
}

/** Pure synthetic fixture; IDs stay stable across ticks, views, and environments. */
export function buildWorkDemo(trips: number, environment: DemoEnvironment, tick: number, view: DemoView, fail: boolean, longLabels = false, commands = false): MermaidRuntime.Graph {
  const nodes: MermaidRuntime.Node[] = [];
  const transitions: MermaidRuntime.Transition[] = [];
  const groups: MermaidRuntime.NodeGroup[] = [];
  const anchorMs = Date.now() - tick * SIM_MS_PER_TICK;
  for (let trip = 0; trip < trips; trip++) {
    let previous: string | null = null;
    for (let phase = 0; phase < phases.length; phase++) {
      const definition = phases[phase];
      const phaseId = `trip-${trip + 1}-phase-${phase}`;
      const childNodes = definition.steps.map((step, index): MermaidRuntime.Node => {
        // The first two synchronization steps are concurrent; their join starts next.
        const start = phase * 4 + (phase === 4 ? Math.max(0, index - 1) : index);
        const skipped = environment === 'dev' && phase === 1;
        const failed = fail && phase === 4 && index === 1 && tick >= 17;
        const blocked = fail && tick >= 17 && (phase > 4 || (phase === 4 && index > 1));
        const status = skipped ? 'skipped' : failed ? 'failed' : blocked ? 'undone' : tick >= start + 1 ? 'complete' : tick > start ? 'running' : 'undone';
        const startedMs = anchorMs + start * SIM_MS_PER_TICK;
        const stepMs = failed ? TIMEOUT_STEP_MS : syntheticStepMs(phase, index);
        const finished = status === 'complete' || status === 'failed';
        const timing = status === 'running' || finished
          ? { startedAt: new Date(startedMs).toISOString(), ...(finished ? { endedAt: new Date(startedMs + stepMs).toISOString(), durationMs: stepMs } : {}) }
          : {};
        return {
          ...timing,
          id: `${phaseId}-step-${index}`, title: longLabels ? buildLongTitle(step) : step.title, subtitle: commands ? buildCommand(step) : null, type: step.type, status,
          detail: skipped ? 'Skipped: local-only preparation is ineligible in shared dev.' : blocked ? 'Blocked: the SQL cache wait failed. This synthetic scenario stops at the failure.' : step.detail,
          error: failed ? 'Synthetic timeout: no matching cache row after 30 seconds.' : null,
          progressPercent: status === 'running' ? Math.round((tick - start) * 100) : status === 'complete' ? 100 : null,
        };
      });
      const childEdges: MermaidRuntime.Transition[] = phase === 4
        ? [{ from: childNodes[0].id, to: childNodes[2].id }, { from: childNodes[1].id, to: childNodes[2].id }, { from: childNodes[2].id, to: childNodes[3].id }]
        : childNodes.slice(1).map((node, i) => ({ from: childNodes[i].id, to: node.id }));
      if (view === 'subflows') {
        const status = childNodes.every(n => n.status === 'skipped') ? 'skipped'
          : childNodes.some(n => n.status === 'failed') ? 'failed'
          : childNodes.every(n => n.status === 'complete') ? 'complete'
          : childNodes.some(n => n.status === 'running' || n.status === 'complete') ? 'running' : 'undone';
        const startedAts = childNodes.flatMap(n => (n.startedAt ? [n.startedAt] : [])).sort();
        const endedAts = childNodes.flatMap(n => (n.endedAt ? [n.endedAt] : [])).sort();
        const spanTiming = startedAts.length > 0
          ? { startedAt: startedAts[0], ...(status === 'complete' || status === 'failed' ? { endedAt: endedAts[endedAts.length - 1], durationMs: Date.parse(endedAts[endedAts.length - 1]) - Date.parse(startedAts[0]) } : {}) }
          : {};
        nodes.push({ ...spanTiming, id: phaseId, title: definition.title, type: 'subflow', status,
          detail: `Trip ${trip + 1}: four steps. Double-click to inspect this invocation.`,
          subgraphLabel: definition.title, subgraph: { nodes: childNodes, transitions: childEdges },
          progressPercent: Math.round(childNodes.filter(n => n.status === 'complete' || n.status === 'skipped').length / 4 * 100),
        });
        if (previous) transitions.push({ from: previous, to: phaseId });
        previous = phaseId;
      } else {
        nodes.push(...childNodes);
        transitions.push(...childEdges);
        if (previous) {
          transitions.push({ from: previous, to: childNodes[0].id });
          if (phase === 4) transitions.push({ from: previous, to: childNodes[1].id });
        }
        previous = childNodes[3].id;
        if (view === 'grouped') groups.push({ id: phaseId, label: `${trips > 1 ? `Trip ${trip + 1} / ` : ''}${definition.title}`, nodeIds: childNodes.map(n => n.id) });
      }
    }
    if (view === 'subflows' && trips > 1) groups.push({ id: `trip-${trip + 1}`, label: `Trip ${trip + 1}`, nodeIds: nodes.slice(-6).map(n => n.id) });
  }
  return { nodes, transitions, groups };
}
