import { computeProgressBadgeBox, isSettledNodeStatus, selectVisibleNodeProgress } from './node-progress.utils';
import { offsetPolygonGeometry, offsetRectGeometry } from './shape-offset.utils';

describe('node progress utils', () => {
  it('treats complete, failed and skipped as settled, and host statuses as not', () => {
    expect(['complete', 'failed', 'skipped'].every(isSettledNodeStatus)).toBeTrue();
    expect(['running', 'undone', 'queued'].some(isSettledNodeStatus)).toBeFalse();
  });

  it('hides every ring on a finished node by default', () => {
    expect(selectVisibleNodeProgress('complete', 100, [40], 'active', true)).toEqual({ percent: null, childPercents: [] });
    expect(selectVisibleNodeProgress('failed', 60, [], 'active', true)).toEqual({ percent: null, childPercents: [] });
  });

  it('hides 0% rings on a running node but keeps the rest', () => {
    expect(selectVisibleNodeProgress('running', 0, [0, 25], 'active', true)).toEqual({ percent: null, childPercents: [25] });
    expect(selectVisibleNodeProgress('running', 40, [10], 'active', true)).toEqual({ percent: 40, childPercents: [10] });
  });

  it('keeps rings on host-defined statuses', () => {
    expect(selectVisibleNodeProgress('queued', 30, [], 'active', true)).toEqual({ percent: 30, childPercents: [] });
  });

  it('draws everything in always mode', () => {
    expect(selectVisibleNodeProgress('complete', 100, [0], 'always', true)).toEqual({ percent: 100, childPercents: [0] });
  });

  it('drops child rings when they are switched off', () => {
    expect(selectVisibleNodeProgress('running', 50, [20, 90], 'active', false)).toEqual({ percent: 50, childPercents: [] });
  });

  it('puts the badge on a rect\'s bottom border, near the right corner', () => {
    const box = computeProgressBadgeBox(offsetRectGeometry(0, 0, 200, 60, 0, 0), '64%');
    expect(box.x + box.width).toBeLessThan(200);
    expect(box.x).toBeGreaterThan(100);
    expect(box.y).toBeLessThan(60);
    expect(box.y + box.height).toBeGreaterThan(60);
  });

  it('sizes the badge to its text', () => {
    const rect = offsetRectGeometry(0, 0, 200, 60, 0, 0);
    expect(computeProgressBadgeBox(rect, '100%').width).toBeGreaterThan(computeProgressBadgeBox(rect, '5%').width);
  });

  it('puts the badge on a diamond\'s lower-right side, away from its vertices', () => {
    const diamond = offsetPolygonGeometry([{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }], 0);
    const box = computeProgressBadgeBox(diamond, '64%');
    expect(box.x + box.width / 2).toBeCloseTo(75);
    expect(box.y + box.height / 2).toBeCloseTo(75);
  });
});
