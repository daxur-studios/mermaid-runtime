import { buildGroupWrapLinks, chooseGroupsPerLine, computeGroupChainLevels, connectedGroupDirection, findIndependentGroupIds, predictArrangedSize, viewportAspectChanged } from './group-arrangement.utils';

describe('group arrangement utils', () => {
  const trip = { width: 300, height: 600 };

  it('treats only groups without outside edges as independent', () => {
    const groups = [
      { id: 'a', label: 'A', nodeIds: ['a1', 'a2'] },
      { id: 'b', label: 'B', nodeIds: ['b1', 'b2'] },
      { id: 'c', label: 'C', nodeIds: ['c1'] },
    ];
    const edges = [{ from: 'a1', to: 'a2' }, { from: 'b2', to: 'c1' }];
    expect([...findIndependentGroupIds(groups, edges)]).toEqual(['a']);
  });

  it('lines groups up across the flow in both directions', () => {
    expect(predictArrangedSize([trip, trip], 2, 'TD', 50)).toEqual({ width: 650, height: 600 });
    expect(predictArrangedSize([trip, trip], 1, 'TD', 50)).toEqual({ width: 300, height: 1250 });
    const row = { width: 600, height: 300 };
    expect(predictArrangedSize([row, row], 2, 'LR', 50)).toEqual({ width: 600, height: 650 });
  });

  it('picks the wrap that fits the viewport at the largest zoom', () => {
    const tenTrips = Array.from({ length: 10 }, () => trip);
    expect(chooseGroupsPerLine(tenTrips, 'TD', { width: 1600, height: 900 })).toBe(5);
    expect(chooseGroupsPerLine(tenTrips, 'TD', { width: 4000, height: 600 })).toBe(10);
    expect(chooseGroupsPerLine(tenTrips, 'TD', { width: 0, height: 0 })).toBe(4);
  });

  it('wraps with invisible links from each group to the one a line later', () => {
    expect(buildGroupWrapLinks(['g0', 'g1', 'g2', 'g3', 'g4'], 2)).toEqual(['  g0 ~~~ g2', '  g1 ~~~ g3', '  g2 ~~~ g4']);
    expect(buildGroupWrapLinks(['g0', 'g1'], 2)).toEqual([]);
  });

  it('runs the steps of a chained group across the flow', () => {
    expect(connectedGroupDirection('TD')).toBe('LR');
    expect(connectedGroupDirection('LR')).toBe('TB');
  });

  it('reverses every second group in a chain when alternating', () => {
    expect(connectedGroupDirection('TD', 0, 'alternate')).toBe('LR');
    expect(connectedGroupDirection('TD', 1, 'alternate')).toBe('RL');
    expect(connectedGroupDirection('TD', 2, 'alternate')).toBe('LR');
    expect(connectedGroupDirection('LR', 1, 'alternate')).toBe('BT');
    expect(connectedGroupDirection('TD', 1, 'same')).toBe('LR');
  });

  it('numbers groups by their position along the chain, whatever order they are listed in', () => {
    const groups = [
      { id: 'c', label: 'C', nodeIds: ['c1'] },
      { id: 'a', label: 'A', nodeIds: ['a1'] },
      { id: 'b1', label: 'B1', nodeIds: ['b1'] },
      { id: 'b2', label: 'B2', nodeIds: ['b2'] },
    ];
    const edges = [{ from: 'a1', to: 'b1' }, { from: 'a1', to: 'b2' }, { from: 'b1', to: 'c1' }, { from: 'b2', to: 'c1' }];
    const levels = computeGroupChainLevels(groups, edges);
    expect(Object.fromEntries(levels)).toEqual({ a: 0, b1: 1, b2: 1, c: 2 });
  });

  it('does not loop forever when groups feed each other', () => {
    const groups = [
      { id: 'a', label: 'A', nodeIds: ['a1'] },
      { id: 'b', label: 'B', nodeIds: ['b1'] },
    ];
    const levels = computeGroupChainLevels(groups, [{ from: 'a1', to: 'b1' }, { from: 'b1', to: 'a1' }]);
    expect(levels.size).toBe(2);
  });

  it('ignores small viewport resizes', () => {
    const base = { width: 1600, height: 900 };
    expect(viewportAspectChanged(null, base)).toBeTrue();
    expect(viewportAspectChanged(base, { width: 1500, height: 880 })).toBeFalse();
    expect(viewportAspectChanged(base, { width: 900, height: 900 })).toBeTrue();
    expect(viewportAspectChanged(base, { width: 0, height: 0 })).toBeFalse();
  });
});
