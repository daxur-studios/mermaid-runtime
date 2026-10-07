import { expect, test, type Page } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

/** Longest (ms) a small random run may take to finish at the fastest cadence. */
const RUN_TIMEOUT_MS = 30_000;

/** Test timeout (ms) for the test that renders many large random graphs one after another. */
const MANY_GRAPHS_TIMEOUT_MS = 120_000;

/** The seed used where a test needs the same graph twice. */
const FIXED_SEED = '4242';

/** A different seed, which gives a different graph. */
const OTHER_SEED = '777';

const NODES = '.graph-canvas__mermaid .node';

/** How many groups and steps the toolbar says the random graph has. */
async function readSummary(page: Page): Promise<{ groups: number; steps: number }> {
  const text = (await page.locator('.toolbar .muted').first().textContent()) ?? '';
  const match = /(\d+) groups · (\d+) steps/.exec(text);
  expect(match, `toolbar summary "${text}"`).not.toBeNull();
  return { groups: Number(match![1]), steps: Number(match![2]) };
}

/** Selects a size, and returns once the new graph has settled. */
async function chooseSize(page: Page, label: 'Small' | 'Medium' | 'Large'): Promise<void> {
  const generation = Number(await page.locator('mr-graph-canvas').getAttribute('data-render-generation'));
  await page.getByRole('combobox', { name: 'Size', exact: true }).selectOption({ label });
  await waitForStableGraph(page, generation);
}

/** Types a seed into the seed box and returns once the new graph has settled. */
async function enterSeed(page: Page, seed: string): Promise<void> {
  const generation = Number(await page.locator('mr-graph-canvas').getAttribute('data-render-generation'));
  const box = page.getByRole('spinbutton', { name: 'Seed' });
  await box.fill(seed);
  await box.press('Enter');
  await waitForStableGraph(page, generation);
}

/** Opens the page and presses the Random graph button once. */
async function openRandomGraph(page: Page): Promise<void> {
  await page.goto('/work-e2e');
  await waitForStableGraph(page);
  const generation = Number(await page.locator('mr-graph-canvas').getAttribute('data-render-generation'));
  await page.getByRole('button', { name: 'Random graph', exact: true }).click();
  await waitForStableGraph(page, generation);
}

/** The titles of all nodes on screen, in drawing order. */
function readNodeTitles(page: Page): Promise<string[]> {
  return page.locator(`${NODES} .nodeLabel`).allTextContents();
}

test('the Random graph button draws a graph, and the same seed always draws the same one', async ({ page }) => {
  await openRandomGraph(page);
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('flat');
  await waitForStableGraph(page);
  await enterSeed(page, FIXED_SEED);
  const first = await readNodeTitles(page);
  const summary = await readSummary(page);
  expect(first.length, 'every step is drawn').toBe(summary.steps);

  await enterSeed(page, OTHER_SEED);
  expect(await readNodeTitles(page), 'another seed draws another graph').not.toEqual(first);
  await enterSeed(page, FIXED_SEED);
  expect(await readNodeTitles(page), 'the first seed brings the first graph back').toEqual(first);
});

test('random graphs draw in every view and size, and the trip demo comes back', async ({ page }) => {
  test.setTimeout(MANY_GRAPHS_TIMEOUT_MS);
  await openRandomGraph(page);
  const view = page.getByRole('combobox', { name: 'View', exact: true });

  await view.selectOption('grouped');
  await waitForStableGraph(page);
  await expect(page.locator('.graph-canvas__mermaid .cluster'), 'one box per group').toHaveCount((await readSummary(page)).groups);

  await view.selectOption('subflows');
  await waitForStableGraph(page);
  await expect(page.locator(NODES), 'one node per group').toHaveCount((await readSummary(page)).groups);

  await view.selectOption('flat');
  await waitForStableGraph(page);
  for (const size of ['Small', 'Large', 'Medium'] as const) {
    await chooseSize(page, size);
    await expect(page.locator(NODES)).toHaveCount((await readSummary(page)).steps);
  }

  const generation = Number(await page.locator('mr-graph-canvas').getAttribute('data-render-generation'));
  await page.getByRole('button', { name: 'Back to trip demo' }).click();
  await waitForStableGraph(page, generation);
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toBeVisible();
});

test('pressing Random graph again keeps drawing new graphs without a render error', async ({ page }) => {
  test.setTimeout(MANY_GRAPHS_TIMEOUT_MS);
  await openRandomGraph(page);
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('grouped');
  await waitForStableGraph(page);
  await chooseSize(page, 'Large');
  const seeds = new Set<string>();
  for (let press = 0; press < 5; press++) {
    seeds.add(await page.getByRole('spinbutton', { name: 'Seed' }).inputValue());
    const generation = Number(await page.locator('mr-graph-canvas').getAttribute('data-render-generation'));
    await page.getByRole('button', { name: 'Random graph', exact: true }).click();
    await waitForStableGraph(page, generation);
  }
  expect(seeds.size, 'each press picks a new seed').toBeGreaterThan(1);
});

test('a random graph runs to the end, and the failing scenario stops on one failed step', async ({ page }) => {
  test.setTimeout(RUN_TIMEOUT_MS * 2);
  await openRandomGraph(page);
  await chooseSize(page, 'Small');
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('flat');
  await waitForStableGraph(page);
  await page.getByRole('combobox', { name: 'Update cadence', exact: true }).selectOption({ label: '10 / second' });
  const generation = Number(await page.locator('mr-graph-canvas').getAttribute('data-render-generation'));

  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.locator('.outcome')).toHaveText('Complete', { timeout: RUN_TIMEOUT_MS });
  await expect(page.locator(`${NODES}.failed`)).toHaveCount(0);
  await expect(page.locator('mr-graph-canvas'), 'a run updates the graph without a re-render').toHaveAttribute('data-render-generation', String(generation));

  await page.getByRole('region', { name: 'Simulation controls' }).getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption({ label: 'A step fails' });
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.locator('.outcome')).toHaveText('Failed', { timeout: RUN_TIMEOUT_MS });
  await expect(page.locator(`${NODES}.failed`)).toHaveCount(1);
});
