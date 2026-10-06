import { ROUTED_EDGE_ATTRIBUTE, routeGroupCrossings, type GroupCrossingPlan } from './group-edge-routing.utils';

/**
 * Two phases stacked top to bottom (as Mermaid draws them), one step on the
 * right of each, the whole graph shifted by `translate(10, 20)` like a nested root.
 * The arrow is Mermaid's own border-to-border path, with a label.
 */
const MERMAID_TWO_GROUPS_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="500">
    <g class="root" transform="translate(10, 20)">
      <g class="clusters">
        <g class="cluster" id="mr-main-graph-0-1-tgGrp0"><rect x="0" y="0" width="800" height="140"></rect></g>
        <g class="cluster" id="mr-main-graph-0-1-tgGrp1"><rect x="0" y="190" width="800" height="140"></rect></g>
      </g>
      <g class="edgePaths">
        <path id="mr-main-graph-0-1-L_tg0_tg1_0" data-id="L_tg0_tg1_0" class="flowchart-link" d="M400,140 C400,160 400,170 400,190"></path>
      </g>
      <g class="edgeLabels">
        <g class="edgeLabel"><g class="label" data-id="L_tg0_tg1_0" transform="translate(-20, -10)"><text>hand off</text></g></g>
      </g>
      <g class="nodes">
        <g class="node" id="mr-main-graph-0-1-flowchart-tg0-0"><rect x="640" y="40" width="120" height="60"></rect></g>
        <g class="node" id="mr-main-graph-0-1-flowchart-tg1-1"><rect x="640" y="230" width="120" height="60"></rect></g>
      </g>
    </g>
  </svg>`;

const PLAN: GroupCrossingPlan = {
  flow: 'TD',
  groupOfNode: new Map([['tg0', 'tgGrp0'], ['tg1', 'tgGrp1']]),
  routedGroups: new Set(['tgGrp0', 'tgGrp1']),
  edges: [{ from: 'tg0', to: 'tg1' }],
};

describe('routeGroupCrossings', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.innerHTML = MERMAID_TWO_GROUPS_SVG;
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('redraws the arrow from the step it leaves to the step it enters', () => {
    routeGroupCrossings(host, PLAN);

    const path = host.querySelector('path[data-id="L_tg0_tg1_0"]')!;
    const d = path.getAttribute('d')!;
    // in the path's own coordinates: out of the right edge of the first step, into the right edge of the second
    expect(d.startsWith('M760,70 ')).toBeTrue();
    expect(d.endsWith(' L760,260')).toBeTrue();
    expect(path.getAttribute(ROUTED_EDGE_ATTRIBUTE)).toBe('true');
    expect(path.classList).toContain('flowchart-link');
  });

  it('moves the arrow label onto the new route', () => {
    routeGroupCrossings(host, PLAN);

    const label = host.querySelector('g.edgeLabel')!;
    const match = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(label.getAttribute('transform') ?? '');
    expect(match).not.toBeNull();
    // the longest run is the lane between the two steps, to the right of them
    expect(Number(match![1])).toBeGreaterThan(760);
    expect(Number(match![2])).toBeGreaterThan(70);
    expect(Number(match![2])).toBeLessThan(260);
  });

  it('leaves arrows alone when neither end is in a redrawn group', () => {
    routeGroupCrossings(host, { ...PLAN, routedGroups: new Set() });

    const path = host.querySelector('path[data-id="L_tg0_tg1_0"]')!;
    expect(path.getAttribute('d')).toBe('M400,140 C400,160 400,170 400,190');
    expect(path.hasAttribute(ROUTED_EDGE_ATTRIBUTE)).toBeFalse();
  });

  it('leaves arrows inside one group alone', () => {
    routeGroupCrossings(host, { ...PLAN, groupOfNode: new Map([['tg0', 'tgGrp0'], ['tg1', 'tgGrp0']]) });

    expect(host.querySelector('path[data-id="L_tg0_tg1_0"]')!.hasAttribute(ROUTED_EDGE_ATTRIBUTE)).toBeFalse();
  });

  it('is safe to run twice', () => {
    routeGroupCrossings(host, PLAN);
    const first = host.querySelector('path[data-id="L_tg0_tg1_0"]')!.getAttribute('d');
    routeGroupCrossings(host, PLAN);

    expect(host.querySelector('path[data-id="L_tg0_tg1_0"]')!.getAttribute('d')).toBe(first);
  });
});
