import { expect, test } from '@playwright/test';
import {
  expectStableContainers,
  startLayoutProbe,
  stopLayoutProbe,
  waitForStableGraph,
} from '../fixtures/layout-probe';

test.beforeEach(async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/testing/layout-regression');
  await waitForStableGraph(page);
  expect(pageErrors).toEqual([]);
});

test('changes direction without transient page or host overflow', async ({ page }) => {
  const generation = await waitForStableGraph(page);
  await startLayoutProbe(page);
  await page.getByTestId('direction-toggle').click();
  await waitForStableGraph(page, generation);
  const frames = await stopLayoutProbe(page);

  await expect(page.getByTestId('graph-host')).toHaveAttribute('data-direction', 'LR');
  expectStableContainers(frames);
});

test('enters and leaves nested subgraphs without transient overflow', async ({ page }) => {
  for (const testId of ['enter-subgraph', 'enter-nested-subgraph', 'return-root']) {
    const generation = await waitForStableGraph(page);
    await startLayoutProbe(page);
    await page.getByTestId(testId).click();
    await waitForStableGraph(page, generation);
    expectStableContainers(await stopLayoutProbe(page));
  }
  await expect(page.getByTestId('graph-host')).toHaveAttribute('data-path', '');
});

test('ignores stale renders during a rapid mixed transition sequence', async ({ page }) => {
  const generation = await waitForStableGraph(page);
  await startLayoutProbe(page);
  await page.getByTestId('rapid-sequence').click();
  await expect(page.getByTestId('graph-host')).toHaveAttribute('data-direction', 'LR');
  await expect(page.getByTestId('graph-host')).toHaveAttribute('data-path', '');
  await waitForStableGraph(page, generation);
  expectStableContainers(await stopLayoutProbe(page));
});

for (const width of [320, 480, 620, 900]) {
  test(`keeps a ${width}px constrained host stable while changing direction`, async ({ page }) => {
    await page.getByTestId(`size-${width}`).click();
    await expect(page.getByTestId('graph-host')).toHaveCSS('width', `${width}px`);
    const generation = await waitForStableGraph(page);
    await startLayoutProbe(page);
    await page.getByTestId('direction-toggle').click();
    await waitForStableGraph(page, generation);
    expectStableContainers(await stopLayoutProbe(page));
  });
}
