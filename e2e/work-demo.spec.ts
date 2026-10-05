import { expect, test } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

test('live child state updates without replacing the subgraph SVG', async ({ page }) => {
  await page.goto('/work-e2e');
  await waitForStableGraph(page);
  await page.locator('.graph-canvas__mermaid .node').filter({ hasText: 'Feature readiness' }).dblclick();
  const generation = await waitForStableGraph(page);
  const node = page.locator('.graph-canvas__mermaid .node').filter({ hasText: 'Assert environment' });
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Advance tick' }).click();
  await expect(node).toHaveClass(/\bdone\b/);
  await expect(page.locator('mr-graph-canvas')).toHaveAttribute('data-render-generation', String(generation));
  await page.getByRole('button', { name: 'Back to overview' }).click();
  await waitForStableGraph(page, generation);
  await expect(page.locator('.graph-canvas__mermaid .node')).toHaveCount(6);
});

test('shared dev preparation is skipped and right-click exposes step details', async ({ page }) => {
  await page.goto('/work-e2e');
  await waitForStableGraph(page);
  await page.getByRole('combobox', { name: 'Environment', exact: true }).selectOption('dev');
  const phase = page.locator('.graph-canvas__mermaid .node').filter({ hasText: 'Local preparation' });
  await expect(phase).toHaveClass(/\bskipped\b/);
  await phase.dblclick();
  await waitForStableGraph(page);
  const flush = page.locator('.graph-canvas__mermaid .node').filter({ hasText: 'Flush local trip DB' });
  await flush.click({ button: 'right' });
  await page.getByRole('button', { name: 'View step details' }).click();
  await expect(page.getByRole('heading', { name: 'Flush local trip DB' })).toBeVisible();
  await expect(page.getByText('Skipped: local-only preparation is ineligible in shared dev.')).toBeVisible();
});

test('240 grouped steps retain their layout across status ticks and view changes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/large-flow');
  await waitForStableGraph(page);
  await page.getByRole('combobox', { name: 'Flow size', exact: true }).selectOption({ label: '240 steps · 10 trips' });
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('grouped');
  await waitForStableGraph(page);
  await expect(page.locator('.graph-canvas__mermaid .node')).toHaveCount(240);
  const generation = await waitForStableGraph(page);
  await page.getByRole('button', { name: 'Advance tick' }).click();
  await expect(page.locator('.graph-canvas__mermaid .node.running')).toHaveCount(10);
  await expect(page.locator('mr-graph-canvas')).toHaveAttribute('data-render-generation', String(generation));
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('subflows');
  await waitForStableGraph(page, generation);
  await expect(page.locator('.graph-canvas__mermaid .node')).toHaveCount(60);
});

test('timeout stops the simulation and reset unlocks captured configuration', async ({ page }) => {
  await page.goto('/work-e2e');
  await waitForStableGraph(page);
  await page.getByRole('combobox', { name: 'Scenario', exact: true }).selectOption({ label: 'SQL timeout' });
  await page.getByRole('combobox', { name: 'Update cadence', exact: true }).selectOption({ label: '10 / second' });
  await page.getByRole('button', { name: 'Run simulation' }).click();
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toBeDisabled();
  await expect(page.locator('.outcome')).toHaveText('Failed', { timeout: 15_000 });
  await expect(page.locator('.graph-canvas__mermaid .node.failed')).toHaveCount(1);
  await expect(page.locator('pre')).toContainText('DEMO-1042');
  await expect(page.locator('pre')).not.toContainText('publicGuid');
  await page.getByRole('region', { name: 'Simulation controls' }).getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Environment', exact: true })).toBeEnabled();
  await expect(page.locator('pre')).not.toContainText('tripNumber');
});
