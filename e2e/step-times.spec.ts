import { expect, test, type Page } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

/** Ticks to advance so several steps are done and some are still waiting. */
const TICKS_MID_RUN = 12;

/** Longest wait (ms) for the zoom band to change after a camera move. */
const BAND_TIMEOUT_MS = 5_000;

/** Zoom-out clicks that are enough to pass the far-zoom threshold from a fitted view. */
const ZOOM_OUT_CLICKS = 8;

/** Longest wait (ms) for the band to settle after one zoom-in click, before clicking again. */
const ZOOM_SETTLE_MS = 300;

const CANVAS = 'mr-graph-canvas';
const BADGE = '.mr-node-progress-badge';
const TIME_PATTERN = /^\d+(\.\d)? (ms|s)$|^\d+m \d{2}s$/;
const PERCENT_PATTERN = /^\d+%$/;

/** Text between a badge's percentage and its time. */
const READOUT_SEPARATOR = ' · ';

/** Longest name (characters) a node shows in the middle when zoomed far out. */
const FAR_NAME_MAX_CHARS = 10;

/** Opacity of a far-zoom icon on a step that has not started yet. */
const FAR_PENDING_OPACITY = '0.5';

async function openGroupedRun(page: Page): Promise<void> {
  await page.goto('/work-e2e');
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });
  await page.getByRole('checkbox', { name: 'Step times' }).check();
  await page.getByRole('checkbox', { name: 'Step details' }).uncheck();
  await waitForStableGraph(page);
}

async function advance(page: Page, ticks: number): Promise<void> {
  for (let tick = 0; tick < ticks; tick++) await page.getByRole('button', { name: 'Advance tick' }).click();
}

/** How much bigger than normal the first group title's pill is drawn (1 = normal). */
function readGroupLabelScale(page: Page): Promise<number> {
  return page.locator('.mr-group-labels .cluster-label > rect.mr-group-label-backdrop').first().evaluate((backdrop) => {
    const transform = getComputedStyle(backdrop).transform;
    return transform === 'none' ? 1 : new DOMMatrix(transform).a;
  });
}

/** The text of every node badge, one string per badge. */
function readBadgeTexts(page: Page): Promise<string[]> {
  return page.locator(`${BADGE} text`).allTextContents();
}

/** Zooms in from the fitted view until the canvas is in the near band (the fitted view may already be far). */
async function zoomToNearBand(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByTitle('Zoom in').click();
    await expect(page.locator(CANVAS)).toHaveAttribute('data-zoom-band', 'near', { timeout: ZOOM_SETTLE_MS });
  }, 'zooming in reaches the near band').toPass({ timeout: BAND_TIMEOUT_MS });
}

test('finished steps and groups show their time in the badge, a running step shows both, and a tick never re-renders the graph', async ({ page }) => {
  await openGroupedRun(page);
  const generation = await page.locator(CANVAS).getAttribute('data-render-generation');
  expect((await readBadgeTexts(page)).filter((text) => text.split(READOUT_SEPARATOR).some((part) => TIME_PATTERN.test(part))), 'no times before the run starts').toEqual([]);
  await expect(page.locator('.mr-node-time'), 'times no longer sit in the node label').toHaveCount(0);

  await advance(page, TICKS_MID_RUN);
  await zoomToNearBand(page);
  await expect(page.locator(BADGE).first()).toBeVisible();
  await expect(async () => {
    await advance(page, 1);
    expect((await readBadgeTexts(page)).some((text) => PERCENT_PATTERN.test(text.split(READOUT_SEPARATOR)[0]) && text.includes(READOUT_SEPARATOR))).toBe(true);
  }, 'a running step shows its percentage and time together').toPass({ timeout: BAND_TIMEOUT_MS });
  const texts = await readBadgeTexts(page);
  const parts = texts.flatMap((text) => text.split(READOUT_SEPARATOR));
  for (const part of parts) expect(part, 'a badge holds only a percentage or a time').toMatch(new RegExp(`${PERCENT_PATTERN.source}|${TIME_PATTERN.source}`));
  expect(parts.some((part) => TIME_PATTERN.test(part)), 'some steps show a time').toBe(true);
  expect(texts.length, 'waiting steps still show none').toBeLessThan(await page.locator('.node').count());

  const groupTimes = await page.locator('.mr-group-time text').allTextContents();
  expect(groupTimes.length, 'groups with timed steps show a time').toBeGreaterThan(0);
  for (const text of groupTimes) expect(text).toMatch(TIME_PATTERN);
  await expect(page.locator(CANVAS), 'times are drawn without a Mermaid re-render').toHaveAttribute('data-render-generation', generation!);
});

test('times that are off draw nothing in the badge up close', async ({ page }) => {
  await page.goto('/work-e2e');
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });
  await waitForStableGraph(page);
  await advance(page, TICKS_MID_RUN);
  await zoomToNearBand(page);
  for (const text of await readBadgeTexts(page)) expect(text, 'only percentages remain').toMatch(PERCENT_PATTERN);
  await expect(page.locator('.mr-group-time')).toHaveCount(0);
});

test('zoomed far out, nodes centre their icon, chip, percentage and time, and group titles grow', async ({ page }) => {
  await openGroupedRun(page);
  await page.getByRole('checkbox', { name: 'Kinds by step type' }).check();
  await waitForStableGraph(page);
  await advance(page, TICKS_MID_RUN);
  await waitForStableGraph(page);
  await page.getByTitle('Fit all').click();
  await zoomToNearBand(page);
  await expect(page.locator('.mr-node-far').first()).toBeHidden();
  await expect(page.locator(BADGE).first()).toBeVisible();
  expect(await readGroupLabelScale(page), 'group titles are normal size up close').toBe(1);

  for (let click = 0; click < ZOOM_OUT_CLICKS; click++) await page.getByTitle('Zoom out').click();
  await expect(page.locator(CANVAS)).toHaveAttribute('data-zoom-band', 'far', { timeout: BAND_TIMEOUT_MS });
  await expect(page.locator(BADGE).first(), 'the corner badge gives way to the centred text').toBeHidden();
  const readouts = await page.locator('.mr-node-far-readout').allTextContents();
  expect(readouts.some((text) => text.split(READOUT_SEPARATOR).some((part) => TIME_PATTERN.test(part))), 'finished steps show their time in the middle').toBe(true);
  expect(readouts.every((text) => text.split(READOUT_SEPARATOR).every((part) => PERCENT_PATTERN.test(part) || TIME_PATTERN.test(part) || text.length <= FAR_NAME_MAX_CHARS)), 'readouts hold only percentages, times, or a short name').toBe(true);
  const chips = await page.locator('.mr-node-far-chip').allTextContents();
  expect(chips.length, 'steps with a kind show its chip').toBeGreaterThan(0);
  expect(chips.every((text) => text.trim() !== '')).toBe(true);
  expect(await page.locator('.mr-node-far-icon').count(), 'steps with a kind show its icon').toBeGreaterThan(0);
  const icons = await page.locator('svg.mr-node-far-icon').evaluateAll((elements) =>
    elements.map((element) => {
      const shape = element.querySelector('path, ellipse') as SVGElement;
      const node = element.closest('g.node')!;
      return {
        started: node.matches('.running, .done, .failed'),
        failed: node.matches('.failed'),
        opacity: getComputedStyle(element).opacity,
        color: getComputedStyle(element).color,
        fill: getComputedStyle(shape).fill,
        stroke: getComputedStyle(shape).stroke,
      };
    }),
  );
  expect(icons.length, 'host SVG icons are drawn when zoomed far out').toBeGreaterThan(0);
  expect(icons.every((icon) => icon.fill === 'none' && icon.stroke === icon.color), 'stroke-style icons keep their outline detail and take the status colour').toBe(true);
  expect(icons.filter((icon) => icon.started && !icon.failed).every((icon) => icon.opacity === '1'), 'started icons are not dimmed').toBe(true);
  expect(icons.filter((icon) => !icon.started).every((icon) => icon.opacity === FAR_PENDING_OPACITY), 'icons of steps that have not started are dimmed').toBe(true);
  const labelOpacity = await page.locator('.node foreignObject').first().evaluate((element) => getComputedStyle(element).opacity);
  expect(labelOpacity, 'the small text is hidden').toBe('0');
  expect(await readGroupLabelScale(page), 'group titles grow when zoomed far out').toBeGreaterThan(1);

  for (let click = 0; click < ZOOM_OUT_CLICKS * 2; click++) await page.getByTitle('Zoom in').click();
  await expect(page.locator(CANVAS)).toHaveAttribute('data-zoom-band', 'near', { timeout: BAND_TIMEOUT_MS });
});
