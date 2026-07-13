export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LayoutStabilitySample = 'missing' | 'changed' | 'stable' | 'settled';

/**
 * Tracks consecutive equal layout samples without depending on the browser clock.
 * The browser component supplies one SVG measurement per animation frame; unit
 * tests can feed synthetic measurements to cover the same settling rules.
 */
export class LayoutStabilityTracker {
  private previous: LayoutBounds | null = null;
  private stableFrames = 0;

  constructor(
    private readonly requiredStableFrames: number,
    private readonly epsilonPx: number,
  ) {}

  sample(bounds: LayoutBounds | null): LayoutStabilitySample {
    if (!bounds) {
      this.previous = null;
      this.stableFrames = 0;
      return 'missing';
    }

    if (!this.previous || !sameLayoutBounds(bounds, this.previous, this.epsilonPx)) {
      this.previous = bounds;
      this.stableFrames = 1;
      return 'changed';
    }

    this.previous = bounds;
    this.stableFrames++;
    return this.stableFrames >= this.requiredStableFrames ? 'settled' : 'stable';
  }
}

export function sameLayoutBounds(a: LayoutBounds, b: LayoutBounds, epsilonPx: number): boolean {
  return Math.abs(a.x - b.x) <= epsilonPx
    && Math.abs(a.y - b.y) <= epsilonPx
    && Math.abs(a.width - b.width) <= epsilonPx
    && Math.abs(a.height - b.height) <= epsilonPx;
}
