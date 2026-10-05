/** Default world-space spacing (px) between background dots or grid lines; mirrors `--mr-pattern-size`. */
export const DEFAULT_PATTERN_GAP_PX = 24;

/**
 * Smallest on-screen spacing (px) a background pattern level may have.
 *
 * PURPOSE: Dots and lines keep their on-screen size while zoom shrinks the
 * spacing, so a tight level merges into a solid fill.
 *
 * VALUE: Below this the pattern switches to a coarser level, so the canvas
 * keeps the same density and contrast at any zoom.
 */
const PATTERN_MIN_GAP_PX = 12;

/** On-screen spacing (px) at which the fine level is fully visible; it fades in from {@link PATTERN_MIN_GAP_PX}. */
const PATTERN_FULL_GAP_PX = 30;

/**
 * Each coarser level is this many times wider than the one below it.
 *
 * VALUE: Every 4th dot or line of a level is also a dot or line of the next,
 * so levels sit on one lattice and nothing jumps when they swap.
 */
const PATTERN_LEVEL_STEP = 4;

/** Upper bound on level steps, so a zero or broken zoom scale can't loop forever. */
const PATTERN_MAX_LEVEL_STEPS = 16;

/** The two pattern levels drawn at one zoom: on-screen spacing (px) and fade (0–1) of each. */
export interface BackgroundPatternLevels {
  fineGapPx: number;
  fineFade: number;
  coarseGapPx: number;
  coarseFade: number;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Picks the background pattern levels for a zoom scale.
 *
 * PURPOSE: Keep the background readable at every zoom instead of flooding the
 * canvas when zoomed out (the way infinite canvases such as Figma behave).
 *
 * VALUE: The fine level is the densest one at least {@link PATTERN_MIN_GAP_PX}
 * apart on screen and fades in as it spreads out. The coarse level (every
 * {@link PATTERN_LEVEL_STEP}th point) is drawn over it, so its points read
 * brighter; it fades out as zoom-in spreads it, and is fully on exactly when
 * the fine level has faded away. Swapping levels is therefore seamless.
 */
export function computeBackgroundPatternLevels(worldGapPx: number, scale: number): BackgroundPatternLevels {
  const baseGapPx = worldGapPx > 0 ? worldGapPx : DEFAULT_PATTERN_GAP_PX;
  const safeScale = scale > 0 ? scale : 1;
  let gapPx = baseGapPx * safeScale;
  for (let step = 0; gapPx < PATTERN_MIN_GAP_PX && step < PATTERN_MAX_LEVEL_STEPS; step++) {
    gapPx *= PATTERN_LEVEL_STEP;
  }
  return {
    fineGapPx: gapPx,
    fineFade: clampUnit((gapPx - PATTERN_MIN_GAP_PX) / (PATTERN_FULL_GAP_PX - PATTERN_MIN_GAP_PX)),
    coarseGapPx: gapPx * PATTERN_LEVEL_STEP,
    coarseFade: clampUnit(1 - (gapPx - PATTERN_MIN_GAP_PX) / (PATTERN_MIN_GAP_PX * PATTERN_LEVEL_STEP - PATTERN_MIN_GAP_PX)),
  };
}
