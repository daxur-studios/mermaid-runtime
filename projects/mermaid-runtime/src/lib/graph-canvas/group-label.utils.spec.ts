import { GROUP_LABEL_BACKDROP_CLASS, GROUP_LABEL_FOR_ATTRIBUTE, GROUP_LABEL_LAYER_CLASS, raiseGroupLabels } from './group-label.utils';

/** A trimmed copy of the structure Mermaid renders for one group with one arrow and one node. */
const MERMAID_GROUP_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <g class="root">
      <g class="clusters">
        <g class="cluster" id="flowchart-trip1" data-look="classic">
          <rect x="0" y="0" width="300" height="200"></rect>
          <g class="cluster-label" transform="translate(120, 8)">
            <foreignObject width="60" height="24">
              <div xmlns="http://www.w3.org/1999/xhtml" style="display: table-cell; white-space: nowrap; line-height: 1.5;">
                <span class="nodeLabel"><p style="margin: 0">Trip 1</p></span>
              </div>
            </foreignObject>
          </g>
        </g>
      </g>
      <g class="edgePaths"><path d="M150,0 L150,200"></path></g>
      <g class="edgeLabels"></g>
      <g class="nodes"><g class="node" id="n1"></g></g>
    </g>
  </svg>`;

describe('raiseGroupLabels', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.innerHTML = MERMAID_GROUP_SVG;
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('moves group titles into a layer drawn after the arrows and before the nodes', () => {
    raiseGroupLabels(host);

    const root = host.querySelector('g.root')!;
    const layerOrder = Array.from(root.children).map((child) => child.getAttribute('class'));
    expect(layerOrder).toEqual(['clusters', 'edgePaths', 'edgeLabels', GROUP_LABEL_LAYER_CLASS, 'nodes']);
    expect(host.querySelector('g.cluster .cluster-label')).toBeNull();

    const label = root.querySelector(`.${GROUP_LABEL_LAYER_CLASS} > .cluster-label`)!;
    expect(label.textContent?.trim()).toBe('Trip 1');
    expect(label.getAttribute(GROUP_LABEL_FOR_ATTRIBUTE)).toBe('flowchart-trip1');
  });

  it('keeps the title where Mermaid placed it', () => {
    const before = host.querySelector('.cluster-label p')!.getBoundingClientRect();
    raiseGroupLabels(host);
    const after = host.querySelector('.cluster-label p')!.getBoundingClientRect();
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });

  it('folds ancestor transforms into the title so it does not move', () => {
    host.querySelector('g.cluster')!.setAttribute('transform', 'translate(10, 20)');
    const before = host.querySelector('.cluster-label p')!.getBoundingClientRect();
    raiseGroupLabels(host);
    const after = host.querySelector('.cluster-label p')!.getBoundingClientRect();
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  });

  it('puts a padded pill behind the title text', () => {
    raiseGroupLabels(host);
    const label = host.querySelector('.cluster-label')!;
    const backdrop = label.firstElementChild!;
    expect(backdrop.classList).toContain(GROUP_LABEL_BACKDROP_CLASS);

    const pill = backdrop.getBoundingClientRect();
    const text = label.querySelector('p')!.getBoundingClientRect();
    expect(pill.left).toBeLessThan(text.left);
    expect(pill.right).toBeGreaterThan(text.right);
    expect(pill.top).toBeLessThanOrEqual(text.top);
    expect(pill.bottom).toBeGreaterThanOrEqual(text.bottom);
  });

  it('is idempotent', () => {
    raiseGroupLabels(host);
    raiseGroupLabels(host);
    expect(host.querySelectorAll(`.${GROUP_LABEL_LAYER_CLASS}`).length).toBe(1);
    expect(host.querySelectorAll(`.${GROUP_LABEL_BACKDROP_CLASS}`).length).toBe(1);
  });
});
