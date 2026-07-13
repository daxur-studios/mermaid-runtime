import { LayoutStabilityTracker, sameLayoutBounds } from './layout-stability';

describe('LayoutStabilityTracker', () => {
  const bounds = { x: 10, y: 20, width: 300, height: 200 };

  it('settles after the required number of equal samples', () => {
    const tracker = new LayoutStabilityTracker(2, 0.5);
    expect(tracker.sample(bounds)).toBe('changed');
    expect(tracker.sample(bounds)).toBe('settled');
  });

  it('resets when a meaningful layout change occurs', () => {
    const tracker = new LayoutStabilityTracker(2, 0.5);
    expect(tracker.sample(bounds)).toBe('changed');
    expect(tracker.sample({ ...bounds, width: 340 })).toBe('changed');
    expect(tracker.sample({ ...bounds, width: 340 })).toBe('settled');
  });

  it('does not treat missing bounds as stable', () => {
    const tracker = new LayoutStabilityTracker(2, 0.5);
    expect(tracker.sample(bounds)).toBe('changed');
    expect(tracker.sample(null)).toBe('missing');
    expect(tracker.sample(bounds)).toBe('changed');
  });

  it('ignores subpixel jitter within the configured epsilon', () => {
    expect(sameLayoutBounds(bounds, { x: 10.2, y: 19.8, width: 300.4, height: 199.7 }, 0.5)).toBeTrue();
    expect(sameLayoutBounds(bounds, { ...bounds, height: 201 }, 0.5)).toBeFalse();
  });
});
