import { computeVisibleContentFraction, isGraphOutOfView } from './camera-visibility.utils';

const VIEWPORT = { width: 1000, height: 600 };
const CONTENT = { x: 0, y: 0, width: 500, height: 300 };

describe('camera visibility', () => {
  it('scores 1 for a graph fully in view', () => {
    expect(computeVisibleContentFraction(CONTENT, { x: 100, y: 100, scale: 1 }, VIEWPORT)).toBe(1);
  });

  it('scores 0 and is out of view when the graph is panned away', () => {
    const camera = { x: 5000, y: 0, scale: 1 };
    expect(computeVisibleContentFraction(CONTENT, camera, VIEWPORT)).toBe(0);
    expect(isGraphOutOfView(CONTENT, camera, VIEWPORT)).toBeTrue();
  });

  it('is out of view when only a sliver is left at the edge', () => {
    expect(isGraphOutOfView(CONTENT, { x: 980, y: 0, scale: 1 }, VIEWPORT)).toBeTrue();
  });

  it('is in view when half the graph shows', () => {
    expect(isGraphOutOfView(CONTENT, { x: 750, y: 0, scale: 1 }, VIEWPORT)).toBeFalse();
  });

  it('does not flag a big graph that fills the viewport, however far in', () => {
    const big = { x: 0, y: 0, width: 5000, height: 5000 };
    expect(isGraphOutOfView(big, { x: -2000, y: -2000, scale: 1 }, VIEWPORT)).toBeFalse();
  });

  it('does not flag a graph zoomed far out', () => {
    expect(isGraphOutOfView(CONTENT, { x: 400, y: 250, scale: 0.1 }, VIEWPORT)).toBeFalse();
  });

  it('never flags an unmeasured graph or viewport', () => {
    expect(isGraphOutOfView({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, scale: 1 }, VIEWPORT)).toBeFalse();
    expect(isGraphOutOfView(CONTENT, { x: 0, y: 0, scale: 1 }, { width: 0, height: 0 })).toBeFalse();
  });
});
