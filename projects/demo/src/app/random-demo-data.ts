import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';
import { buildCommand, buildLongTitle, buildSubflowNode, DemoView, SIM_MS_PER_TICK } from './work-demo-data';

/** How big a random graph is: the number of groups, and how many steps each holds. */
export type RandomSize = 'small' | 'medium' | 'large';

/** The ranges one {@link RandomSize} draws from. Each pair is `[fewest, most]`, both included. */
interface SizeProfile {
  /** Groups in the graph. */
  groups: readonly [number, number];
  /** Rows of steps inside a group (steps in a row run side by side). */
  layers: readonly [number, number];
  /** Steps in one row. */
  width: readonly [number, number];
}

/**
 * Size presets for random graphs.
 *
 * VALUE: Small fits the screen and shows every detail, medium needs the camera, and large
 * (up to a couple of hundred steps) is for checking zoomed-out views and speed.
 */
export const RANDOM_SIZE_PROFILES: Readonly<Record<RandomSize, SizeProfile>> = {
  small: { groups: [3, 4], layers: [2, 3], width: [1, 2] },
  medium: { groups: [5, 8], layers: [2, 4], width: [1, 3] },
  large: { groups: [10, 16], layers: [2, 5], width: [1, 3] },
};

/** The size used when the page first opens a random graph. */
export const DEFAULT_RANDOM_SIZE: RandomSize = 'medium';

/** Seeds are whole numbers below this, so they stay short enough to read out and retype. */
const SEED_RANGE = 1_000_000;

/** Chance that a step is skipped (it keeps its place but takes no time). */
const SKIP_CHANCE = 0.06;

/** Chance that a step in a later row also waits on a second step of the row before (a join). */
const JOIN_CHANCE = 0.3;

/** Chance that a group also gets an arrow from the group two before it, skipping the one between. */
const SKIP_EDGE_CHANCE = 0.2;

/** Chance that an arrow between two groups carries a label. */
const EDGE_LABEL_CHANCE = 0.15;

/** Chance that a step title is stretched with extra words, to check wrapping. */
const LONG_TITLE_CHANCE = 0.12;

/** Shortest a step runs, in demo ticks. */
const MIN_DURATION_TICKS = 1;

/** How many half-tick increments a step's run can grow beyond the minimum. */
const DURATION_VARIETY = 5;

/** Size of one duration increment, in demo ticks. */
const DURATION_INCREMENT_TICKS = 0.5;

/** Share of the non-skipped steps, by order, before which the failing step is not chosen. */
const FAIL_WINDOW_START = 0.35;

/** Share of the non-skipped steps that the failing step's position can span after the start. */
const FAIL_WINDOW_SPAN = 0.35;

/** The demo clock moves in this many ticks at a time; run ends are rounded up to it. */
const TICK_STEP = 0.25;

/** Step types and how often each is drawn. `shell` has no kind style, so it shows the plain look. */
const STEP_TYPES: readonly string[] = ['assert', 'assert', 'SQL', 'SQL', 'Kafka', 'Kafka', 'HTTP', 'HTTP', 'Playwright', 'context', 'shell'];

/** Step titles for each type. SQL titles that start with `Poll` get the demo's polling decoration. */
const TITLES_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  assert: ['Assert trip mapping', 'Assert API result', 'Assert sync evidence', 'Assert seed ready', 'Assert environment'],
  SQL: ['Poll SQL cache', 'Poll sync status', 'Seed reference data', 'Reset local cache', 'Check required tables'],
  Kafka: ['Subscribe trip topic', 'Await Kafka message', 'Await listener readiness', 'Close subscriptions'],
  HTTP: ['Check trip APIs', 'Read public trip API', 'Post trip update', 'Check identity API'],
  Playwright: ['Open trip-entry page', 'Fill trip parameters', 'Submit trip leg', 'Check legacy UI'],
  context: ['Capture trip number', 'Capture public GUID', 'Arm message buffer'],
  shell: ['Run migration script', 'Warm up service', 'Export run report'],
};

/** Extra words that stretch a title past the wrap width. */
const LONG_TITLE_SUFFIXES: readonly string[] = [
  'for the synthetic regional depot fixture, retrying until the correlated message arrives',
  'across every vehicle, route and depot that the previous step seeded',
];

/** Group names. A graph with more groups than names repeats them with a number. */
const GROUP_NAMES: readonly string[] = [
  'Feature readiness', 'Local preparation', 'Subscribe before action', 'Create trip in legacy UI', 'Parallel synchronization',
  'Assert and clean up', 'Warm caches', 'Seed fixtures', 'Verify identity', 'Publish events', 'Reconcile ledger', 'Check notifications',
  'Replay history', 'Tear down', 'Snapshot state', 'Compare results',
];

/** Labels an arrow between groups can carry. */
const EDGE_LABELS: readonly string[] = ['on success', 'retry', 'fallback'];

/** One step of a generated graph: its place in the run and how it behaves. */
export interface RandomStep {
  readonly id: string;
  /** Position of the step's group. */
  readonly phase: number;
  readonly title: string;
  readonly type: string;
  readonly detail: string;
  /** Demo tick at which the step starts, once all the steps it waits on are done. */
  readonly startTick: number;
  /** Demo ticks the step runs for; 0 for a skipped step. */
  readonly durationTicks: number;
  readonly skipped: boolean;
}

/** One group of steps. */
export interface RandomPhase {
  readonly id: string;
  readonly title: string;
  readonly stepIds: readonly string[];
}

/**
 * A generated graph with its schedule, before any tick is applied.
 *
 * PURPOSE: Keep what a seed decides (shape, names, who waits on whom, when each step runs)
 * apart from what the clock decides (status, progress, times).
 *
 * VALUE: The same seed always gives the same flow, so a layout problem found on one
 * random graph can be reproduced by typing its seed back in.
 */
export interface RandomFlow {
  readonly seed: number;
  readonly phases: readonly RandomPhase[];
  readonly steps: readonly RandomStep[];
  readonly edges: readonly MermaidRuntime.Transition[];
  /** The step that fails in the failing scenario. */
  readonly failStepId: string;
  /** Ids of the steps that wait, directly or not, on the failing step. */
  readonly blockedStepIds: ReadonlySet<string>;
  /** Tick at which the last step finishes. */
  readonly endTick: number;
  /** Tick at which the failing step fails; the run stops there in the failing scenario. */
  readonly failTick: number;
}

/** Draws a seed at random. */
export function createRandomSeed(): number {
  return Math.floor(Math.random() * SEED_RANGE);
}

/** Turns anything typed into the seed box into a usable seed (a whole number, never negative). */
export function normaliseSeed(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.abs(parsed) % SEED_RANGE : 0;
}

/** Number of values a 32-bit unsigned integer can take; divides the generator's output into 0 up to 1. */
const UINT32_RANGE = 2 ** 32;

/**
 * A small seeded random number generator (the public-domain mulberry32): the same seed
 * gives the same numbers. The odd-looking constants are part of that algorithm.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** A whole number from `min` to `max`, both included. */
function randomInt(rng: () => number, [min, max]: readonly [number, number]): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One random item of a list. */
function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** The list in a random order. */
function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Rounds a tick up to the next step of the demo clock, so a run ends exactly on a tick the clock reaches. */
function roundUpToClock(tick: number): number {
  return Math.ceil(tick / TICK_STEP) * TICK_STEP;
}

/**
 * Generates a random graph of groups and steps from a seed.
 *
 * PURPOSE: Hand-made fixtures only cover the shapes someone thought of. Random ones turn up
 * the awkward cases: a lone step beside a wide row, a join, an arrow that skips a group,
 * a long title, a skipped step in the middle.
 *
 * VALUE: Always a valid forward-only graph with a fixed run schedule, and always the same
 * for one seed and size, so a bad case can be reported as "medium, seed 48213".
 */
export function generateRandomFlow(seed: number, size: RandomSize): RandomFlow {
  const rng = createRng(seed);
  const profile = RANDOM_SIZE_PROFILES[size];
  const groupCount = randomInt(rng, profile.groups);
  const groupNames = shuffle(rng, GROUP_NAMES);
  const steps: RandomStep[] = [];
  const phases: RandomPhase[] = [];
  const edges: MermaidRuntime.Transition[] = [];
  const edgeKeys = new Set<string>();
  const waitsOn = new Map<string, string[]>();
  const layersByPhase: string[][][] = [];

  const addEdge = (from: string, to: string, label: string | null = null): void => {
    const key = `${from}>${to}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(label ? { from, to, label } : { from, to });
    waitsOn.set(to, [...(waitsOn.get(to) ?? []), from]);
  };

  for (let phase = 0; phase < groupCount; phase++) {
    const phaseId = `rnd-${seed}-p${phase}`;
    const layers: string[][] = [];
    const layerCount = randomInt(rng, profile.layers);
    let stepIndex = 0;
    for (let layer = 0; layer < layerCount; layer++) {
      const row: string[] = [];
      const width = randomInt(rng, profile.width);
      for (let slot = 0; slot < width; slot++) {
        const type = pick(rng, STEP_TYPES);
        const baseTitle = pick(rng, TITLES_BY_TYPE[type]);
        const title = rng() < LONG_TITLE_CHANCE ? `${baseTitle} ${pick(rng, LONG_TITLE_SUFFIXES)}` : baseTitle;
        const id = `${phaseId}-step-${stepIndex++}`;
        const skipped = rng() < SKIP_CHANCE;
        const durationTicks = skipped ? 0 : MIN_DURATION_TICKS + Math.floor(rng() * DURATION_VARIETY) * DURATION_INCREMENT_TICKS;
        steps.push({ id, phase, title, type, detail: `Synthetic ${type} step ${row.length + 1} of row ${layer + 1}.`, startTick: 0, durationTicks, skipped });
        row.push(id);
      }
      layers.push(row);
    }
    layersByPhase.push(layers);
    phases.push({
      id: phaseId,
      title: groupNames[phase] ?? `${groupNames[phase % groupNames.length]} ${Math.floor(phase / groupNames.length) + 1}`,
      stepIds: layers.flat(),
    });

    // Inside the group: every step waits on one step of the row before (some on two), and no step is left without a successor.
    for (let layer = 1; layer < layers.length; layer++) {
      const before = layers[layer - 1];
      for (const id of layers[layer]) {
        const first = pick(rng, before);
        addEdge(first, id);
        if (before.length > 1 && rng() < JOIN_CHANCE) addEdge(pick(rng, before.filter(other => other !== first)), id);
      }
      for (const id of before) {
        if (!layers[layer].some(next => edgeKeys.has(`${id}>${next}`))) addEdge(id, pick(rng, layers[layer]));
      }
    }

    // Between groups: the first row waits on the last row of the group before; a few arrows jump a group.
    if (phase > 0) {
      const previousLast = layersByPhase[phase - 1][layersByPhase[phase - 1].length - 1];
      const firstRow = layers[0];
      for (const id of firstRow) addEdge(pick(rng, previousLast), id, rng() < EDGE_LABEL_CHANCE ? pick(rng, EDGE_LABELS) : null);
      for (const id of previousLast) {
        if (!firstRow.some(next => edgeKeys.has(`${id}>${next}`))) addEdge(id, pick(rng, firstRow));
      }
      if (phase > 1 && rng() < SKIP_EDGE_CHANCE) {
        const twoBack = layersByPhase[phase - 2];
        addEdge(pick(rng, twoBack[twoBack.length - 1]), pick(rng, firstRow), rng() < EDGE_LABEL_CHANCE ? pick(rng, EDGE_LABELS) : null);
      }
    }
  }

  // Schedule: a step starts when everything it waits on has finished. Steps are already in a valid order.
  const scheduled: RandomStep[] = [];
  const endByStep = new Map<string, number>();
  for (const step of steps) {
    const startTick = Math.max(0, ...(waitsOn.get(step.id) ?? []).map(id => endByStep.get(id) ?? 0));
    endByStep.set(step.id, startTick + step.durationTicks);
    scheduled.push({ ...step, startTick });
  }

  const runnable = scheduled.filter(step => !step.skipped);
  const failCandidates = runnable.length > 0 ? runnable : scheduled;
  const failIndex = Math.floor(failCandidates.length * (FAIL_WINDOW_START + rng() * FAIL_WINDOW_SPAN));
  const failStep = failCandidates[Math.min(failIndex, failCandidates.length - 1)];
  const blocked = new Set<string>();
  const queue = [failStep.id];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const edge of edges) {
      if (edge.from === current && !blocked.has(edge.to)) {
        blocked.add(edge.to);
        queue.push(edge.to);
      }
    }
  }

  return {
    seed, phases, steps: scheduled, edges,
    failStepId: failStep.id,
    blockedStepIds: blocked,
    endTick: roundUpToClock(Math.max(...endByStep.values())),
    failTick: roundUpToClock(failStep.startTick + failStep.durationTicks),
  };
}

/** The tick the simulation stops at: the end of the run, or the failure in the failing scenario. */
export function readRandomLimit(flow: RandomFlow, fail: boolean): number {
  return fail ? flow.failTick : flow.endTick;
}

/**
 * Applies a demo tick to a generated graph: each step's status, progress and times.
 *
 * PURPOSE: Same job as `buildWorkDemo` for the trip fixture, so the random graphs can be
 * run, failed and zoomed in the same page.
 *
 * VALUE: Ids stay the same across ticks and views, so the canvas updates in place instead
 * of re-rendering. Times follow the simulated clock, so a step that runs two ticks reads 2 s.
 */
export function buildRandomDemo(flow: RandomFlow, tick: number, view: DemoView, fail: boolean, longLabels = false, commands = false): MermaidRuntime.Graph {
  const anchorMs = Date.now() - tick * SIM_MS_PER_TICK;
  const failed = fail && tick >= flow.failTick;
  const nodeById = new Map<string, MermaidRuntime.Node>();
  for (const step of flow.steps) {
    const endTick = step.startTick + step.durationTicks;
    const isFailing = failed && step.id === flow.failStepId;
    const blocked = failed && flow.blockedStepIds.has(step.id);
    const status = step.skipped ? 'skipped' : isFailing ? 'failed' : blocked ? 'undone' : tick >= endTick ? 'complete' : tick > step.startTick ? 'running' : 'undone';
    const finished = status === 'complete' || status === 'failed';
    const startedMs = anchorMs + step.startTick * SIM_MS_PER_TICK;
    const stepMs = step.durationTicks * SIM_MS_PER_TICK;
    const timing = status === 'running' || finished
      ? { startedAt: new Date(startedMs).toISOString(), ...(finished ? { endedAt: new Date(startedMs + stepMs).toISOString(), durationMs: stepMs } : {}) }
      : {};
    nodeById.set(step.id, {
      ...timing,
      id: step.id,
      title: longLabels ? buildLongTitle(step) : step.title,
      subtitle: commands ? buildCommand(step) : null,
      type: step.type,
      status,
      detail: step.skipped ? 'Skipped: this synthetic step was ineligible.' : blocked ? 'Blocked: a step it waits on failed. This synthetic scenario stops at the failure.' : step.detail,
      error: isFailing ? 'Synthetic failure: this step gave up after its retries.' : null,
      progressPercent: status === 'running' ? Math.min(100, Math.round((tick - step.startTick) / step.durationTicks * 100)) : status === 'complete' ? 100 : null,
    });
  }

  if (view === 'subflows') {
    const phaseOfStep = new Map(flow.steps.map(step => [step.id, flow.phases[step.phase].id]));
    const phaseNodes = flow.phases.map(phase => {
      const children = phase.stepIds.map(id => nodeById.get(id)!);
      const inside = flow.edges.filter(edge => phaseOfStep.get(edge.from) === phase.id && phaseOfStep.get(edge.to) === phase.id);
      return buildSubflowNode(phase.id, phase.title, `${children.length} steps. Double-click to inspect this group.`, children, inside);
    });
    const between = new Map<string, MermaidRuntime.Transition>();
    for (const edge of flow.edges) {
      const from = phaseOfStep.get(edge.from)!;
      const to = phaseOfStep.get(edge.to)!;
      if (from !== to && !between.has(`${from}>${to}`)) between.set(`${from}>${to}`, { from, to, ...(edge.label ? { label: edge.label } : {}) });
    }
    return { nodes: phaseNodes, transitions: [...between.values()], groups: [] };
  }

  return {
    nodes: flow.steps.map(step => nodeById.get(step.id)!),
    transitions: [...flow.edges],
    groups: view === 'grouped' ? flow.phases.map(phase => ({ id: phase.id, label: phase.title, nodeIds: [...phase.stepIds] })) : [],
  };
}
