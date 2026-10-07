import { expect, test, type Page } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

/** Longest wait (ms) for a demo run to reach its end at 10 updates a second. */
const RUN_TIMEOUT_MS = 30_000;

/** Longest wait (ms) for the result banner to slide away on its own; the library holds it for 6 s. */
const BANNER_FADE_TIMEOUT_MS = 12_000;

/** How far (px) from the viewport centre the graph's centre may sit after Reset. */
const CENTRE_TOLERANCE_PX = 60;

/** Number of drags used to push the graph off screen. */
const PAN_AWAY_DRAGS = 4;

const BANNER = 'mr-graph-banner .mr-graph-banner[data-banner]';

async function startRun(page: Page, scenario?: string): Promise<void> {
  await page.goto('/work-e2e');
  await waitForStableGraph(page);
  if (scenario) await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption({ label: scenario });
  await page.getByRole('combobox', { name: 'Update cadence', exact: true }).selectOption({ label: '10 / second' });
  await expect(page.locator(BANNER), 'no banner before the run').toHaveCount(0);
  await expect(page.locator('[data-run-pill]'), 'no pill before the run').toHaveCount(0);
  await page.getByRole('button', { name: 'Run simulation' }).click();
}

async function panAway(page: Page): Promise<void> {
  const viewport = (await page.locator('.graph-canvas__viewport').boundingBox())!;
  const y = viewport.y + viewport.height / 2;
  for (let drag = 0; drag < PAN_AWAY_DRAGS; drag++) {
    await page.mouse.move(viewport.x + viewport.width * 0.05, y);
    await page.mouse.down();
    await page.mouse.move(viewport.x + viewport.width * 0.95, y, { steps: 8 });
    await page.mouse.up();
  }
}

async function graphCentreOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.graph-canvas__viewport')!.getBoundingClientRect();
    const svg = document.querySelector('.graph-canvas__mermaid:not(.graph-canvas__render-sandbox) svg')!.getBoundingClientRect();
    return Math.hypot(svg.x + svg.width / 2 - (viewport.x + viewport.width / 2), svg.y + svg.height / 2 - (viewport.y + viewport.height / 2));
  });
}

test('a finished run shows a result banner that fades, and a pill that stays', async ({ page }) => {
  test.setTimeout(60_000);
  await startRun(page);
  await expect(page.locator(BANNER)).toHaveAttribute('data-banner', 'run-complete', { timeout: RUN_TIMEOUT_MS });
  await expect(page.locator('mr-graph-banner')).toContainText('Run complete');
  await expect(page.locator('[data-run-pill]')).toContainText('Complete');
  await expect(page.locator(BANNER), 'the banner slides away on its own').toHaveCount(0, { timeout: BANNER_FADE_TIMEOUT_MS });
  await expect(page.locator('[data-run-pill]'), 'the pill stays').toBeVisible();
});

test('a failed run says so, and a new run clears the result', async ({ page }) => {
  test.setTimeout(60_000);
  await startRun(page, 'SQL timeout');
  await expect(page.locator(BANNER)).toHaveAttribute('data-banner', 'run-failed', { timeout: RUN_TIMEOUT_MS });
  await expect(page.locator('mr-graph-banner')).toContainText('Run failed');
  await expect(page.locator('[data-run-pill]')).toHaveClass(/graph-canvas__run-pill--failed/);
  await page.getByRole('region', { name: 'Simulation controls' }).getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('[data-run-pill]'), 'a reset run has no result').toHaveCount(0);
});

test('panning away offers a way back, and Reset centres the graph', async ({ page }) => {
  await page.goto('/work-e2e');
  await waitForStableGraph(page);
  await page.getByTitle('Fit all').click();
  await expect.poll(() => graphCentreOffset(page)).toBeLessThan(CENTRE_TOLERANCE_PX);
  await expect(page.locator(BANNER)).toHaveCount(0);

  await panAway(page);
  await expect(page.locator(BANNER)).toHaveAttribute('data-banner', 'back-to-graph');
  await page.locator('mr-graph-banner button').click();
  await expect(page.locator(BANNER), 'the prompt goes once the graph is back').toHaveCount(0);
  await expect.poll(() => graphCentreOffset(page)).toBeLessThan(CENTRE_TOLERANCE_PX);

  await panAway(page);
  await page.getByTitle('Reset view').click();
  await expect.poll(() => graphCentreOffset(page), 'Reset lands on the graph, not the top-left corner').toBeLessThan(CENTRE_TOLERANCE_PX);
});
