import { expect, test, type Page } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

/** Ticks to advance so several steps are done and some are still waiting. */
const TICKS_MID_RUN = 12;

/** Longest wait (ms) for the zoom band to change after a camera move. */
const BAND_TIMEOUT_MS = 5_000;

/** Zoom-out clicks that are enough to pass the far-zoom threshold from a fitted view. */
const ZOOM_OUT_CLICKS = 8;

const CANVAS = 'mr-graph-canvas';
const TIME_PATTERN = /^\d+(\.\d)? (ms|s)$|^\d+m \d{2}s$/;

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

test('finished steps and groups show their time, and a tick never re-renders the graph', async ({ page }) => {
  await openGroupedRun(page);
  const generation = await page.locator(CANVAS).getAttribute('data-render-generation');
  const before = await page.locator('.mr-node-time').evaluateAll((slots) => slots.map((slot) => slot.textContent));
  expect(before.length, 'every node reserves a time slot').toBeGreaterThan(0);
  expect(before.every((text) => text === ''), 'no times before the run starts').toBe(true);

  await advance(page, TICKS_MID_RUN);
  await expect(page.locator('.mr-node-time:not(:empty)').first()).toBeVisible();
  const texts = await page.locator('.mr-node-time').evaluateAll((slots) => slots.map((slot) => slot.textContent ?? ''));
  const shown = texts.filter(Boolean);
  expect(shown.length, 'some steps show a time').toBeGreaterThan(0);
  expect(shown.length, 'waiting steps still show none').toBeLessThan(texts.length);
  for (const text of shown) expect(text).toMatch(TIME_PATTERN);

  const groupTimes = await page.locator('.mr-group-time text').allTextContents();
  expect(groupTimes.length, 'groups with timed steps show a time').toBeGreaterThan(0);
  for (const text of groupTimes) expect(text).toMatch(TIME_PATTERN);
  await expect(page.locator(CANVAS), 'times are drawn without a Mermaid re-render').toHaveAttribute('data-render-generation', generation!);
});

test('times that are off reserve no room and draw nothing', async ({ page }) => {
  await page.goto('/work-e2e');
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });
  await waitForStableGraph(page);
  await advance(page, TICKS_MID_RUN);
  await expect(page.locator('.mr-node-time')).toHaveCount(0);
  await expect(page.locator('.mr-group-time')).toHaveCount(0);
});

test('zoomed far out, nodes show a large time instead of their text, and come back up close', async ({ page }) => {
  await openGroupedRun(page);
  await advance(page, TICKS_MID_RUN);
  await page.getByTitle('Fit all').click();
  await expect(page.locator(CANVAS)).toHaveAttribute('data-zoom-band', 'near', { timeout: BAND_TIMEOUT_MS });
  await expect(page.locator('.mr-node-far').first()).toBeHidden();

  for (let click = 0; click < ZOOM_OUT_CLICKS; click++) await page.getByTitle('Zoom out').click();
  await expect(page.locator(CANVAS)).toHaveAttribute('data-zoom-band', 'far', { timeout: BAND_TIMEOUT_MS });
  const far = await page.locator('.mr-node-far').evaluateAll((labels) => labels.map((label) => ({ text: label.textContent ?? '', display: getComputedStyle(label).display })));
  expect(far.some((label) => TIME_PATTERN.test(label.text) && label.display !== 'none'), 'finished steps show their time').toBe(true);
  expect(far.some((label) => label.text === ''), 'waiting steps show nothing').toBe(true);
  const labelOpacity = await page.locator('.node foreignObject').first().evaluate((element) => getComputedStyle(element).opacity);
  expect(labelOpacity, 'the small text is hidden').toBe('0');

  for (let click = 0; click < ZOOM_OUT_CLICKS * 2; click++) await page.getByTitle('Zoom in').click();
  await expect(page.locator(CANVAS)).toHaveAttribute('data-zoom-band', 'near', { timeout: BAND_TIMEOUT_MS });
});
