import { expect, test, type Page } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

const GRAPH = '.graph-canvas__mermaid:not(.graph-canvas__render-sandbox)';
const SELECTED_RING = `${GRAPH} .mr-node-outline-selected`;

/** Updates to run so the "current" step has moved on from where it started. */
const TICKS_TO_ADVANCE = 4;

/** Distance (px) in from the viewport corner for a click on empty space. */
const CORNER_INSET_PX = 6;

/** Drag length (px) that is clearly a pan, not a click. */
const PAN_DRAG_PX = 120;

async function openWork(page: Page): Promise<void> {
  await page.goto('/work-e2e');
  await waitForStableGraph(page);
}

async function advance(page: Page, ticks: number): Promise<void> {
  for (let tick = 0; tick < ticks; tick++) await page.getByRole('button', { name: 'Advance tick' }).click();
  await page.waitForTimeout(300);
}

/** Mermaid's element id of the node carrying the selection ring. */
function ringedNodeText(page: Page): Promise<string | null> {
  return page.evaluate((selector) => document.querySelector(selector)?.closest('g.node')?.id ?? null, SELECTED_RING);
}

test('a step that just became active does not look selected', async ({ page }) => {
  await openWork(page);
  await expect(page.locator(SELECTED_RING), 'nothing is selected on load').toHaveCount(0);
  await advance(page, TICKS_TO_ADVANCE);
  await expect(page.locator(SELECTED_RING), 'a running step is not a selected step').toHaveCount(0);
});

test('the selection stays on the clicked step while the run moves on', async ({ page }) => {
  await openWork(page);
  await page.locator(`${GRAPH} g.node`).first().click({ force: true });
  await expect(page.locator(SELECTED_RING)).toHaveCount(1);
  const picked = await ringedNodeText(page);

  await advance(page, TICKS_TO_ADVANCE);
  await expect(page.locator(SELECTED_RING)).toHaveCount(1);
  expect(await ringedNodeText(page)).toBe(picked);
});

test('clicking the background clears the selection, dragging it does not', async ({ page }) => {
  await openWork(page);
  const viewport = (await page.locator('.graph-canvas__viewport').boundingBox())!;
  const cornerX = viewport.x + CORNER_INSET_PX;
  const cornerY = viewport.y + viewport.height - CORNER_INSET_PX * 4;

  await page.locator(`${GRAPH} g.node`).first().click({ force: true });
  await expect(page.locator(SELECTED_RING)).toHaveCount(1);

  await page.mouse.move(cornerX, cornerY);
  await page.mouse.down();
  await page.mouse.move(cornerX + PAN_DRAG_PX, cornerY, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator(SELECTED_RING), 'a pan is not a click').toHaveCount(1);

  await page.mouse.click(cornerX, cornerY);
  await expect(page.locator(SELECTED_RING), 'a click on empty space deselects').toHaveCount(0);
});
