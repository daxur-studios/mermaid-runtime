import { computeBackgroundPatternLevels, DEFAULT_PATTERN_GAP_PX } from './background-pattern.utils';

describe('background pattern levels', () => {
  it('shows the base spacing fully at 100% zoom, with every 4th point brighter', () => {
    const levels = computeBackgroundPatternLevels(DEFAULT_PATTERN_GAP_PX, 1);
    expect(levels.fineGapPx).toBe(24);
    expect(levels.fineFade).toBeCloseTo(2 / 3);
    expect(levels.coarseGapPx).toBe(96);
    expect(levels.coarseFade).toBeCloseTo(2 / 3);
  });

  it('never lets on-screen spacing drop below 12 px, however far out', () => {
    for (const scale of [0.5, 0.2, 0.1, 0.05, 0.01]) {
      expect(computeBackgroundPatternLevels(24, scale).fineGapPx).toBeGreaterThanOrEqual(12);
    }
  });

  it('swaps levels without a visible jump', () => {
    // 24 px world at 0.5 zoom is exactly 12 px: the fine level is about to drop.
    const before = computeBackgroundPatternLevels(24, 0.5001);
    const after = computeBackgroundPatternLevels(24, 0.4999);
    // Before: the 96 px lattice is the coarse level, fully on, and the fine level is gone.
    expect(before.fineFade).toBeCloseTo(0, 2);
    expect(before.coarseFade).toBeCloseTo(1, 2);
    // After: the same lattice is the fine level, fully on, and the new coarse level is gone.
    expect(after.fineGapPx).toBeCloseTo(before.coarseGapPx, 1);
    expect(after.fineFade).toBe(1);
    expect(after.coarseFade).toBeCloseTo(0, 2);
  });

  it('drops the brighter points once zoomed in far enough', () => {
    expect(computeBackgroundPatternLevels(24, 3).coarseFade).toBe(0);
  });

  it('falls back to safe values for a zero spacing or zoom', () => {
    expect(computeBackgroundPatternLevels(0, 0).fineGapPx).toBe(DEFAULT_PATTERN_GAP_PX);
  });
});
