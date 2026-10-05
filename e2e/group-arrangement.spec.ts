import { expect, test, type Page } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

/**
 * Upper bound for the rendered graph's long side ÷ short side.
 *
 * VALUE: Before automatic group arrangement, 5 independent trips rendered as a
 * ~13:1 strip in LR and ~55:1 in TD; a packed arrangement stays near the
 * viewport's own shape.
 */
const MAX_PACKED_ASPECT_RATIO = 3;

/** Minimum fraction of the viewport the fitted graph's long side must fill. */
const MIN_FITTED_VIEWPORT_FILL = 0.6;

async function readLayout(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.graph-canvas__mermaid svg') as SVGSVGElement;
    const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const viewport = document.querySelector('.graph-camera__viewport, mr-graph-camera')!.getBoundingClientRect();
    const rendered = svg.getBoundingClientRect();
    const clusters = [...svg.querySelectorAll('g.cluster')].map((cluster) => {
      const box = cluster.getBoundingClientRect();
      return { label: cluster.textContent?.trim() ?? '', x: box.x, y: box.y };
    });
    return {
      aspect: Math.max(width, height) / Math.min(width, height),
      fill: Math.max(rendered.width / viewport.width, rendered.height / viewport.height),
      clusters,
    };
  });
}

test('independent trip groups pack into a viewport-shaped layout in reading order', async ({ page }) => {
  await page.goto('/large-flow');
  await page.getByRole('combobox', { name: 'Flow size', exact: true }).selectOption({ label: '120 steps · 5 trips' });
  await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('LR');
  await waitForStableGraph(page);

  const lr = await readLayout(page);
  expect(lr.aspect).toBeLessThan(MAX_PACKED_ASPECT_RATIO);
  expect(lr.fill).toBeGreaterThan(MIN_FITTED_VIEWPORT_FILL);
  const rows = [...lr.clusters].sort((a, b) => a.y - b.y).map((cluster) => cluster.label);
  expect(rows).toEqual(['Trip 1', 'Trip 2', 'Trip 3', 'Trip 4', 'Trip 5']);

  await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption('TD');
  await waitForStableGraph(page);

  const td = await readLayout(page);
  expect(td.aspect).toBeLessThan(MAX_PACKED_ASPECT_RATIO);
  expect(td.fill).toBeGreaterThan(MIN_FITTED_VIEWPORT_FILL);
  const columns = [...td.clusters].sort((a, b) => a.x - b.x).map((cluster) => cluster.label);
  expect(columns).toEqual(['Trip 1', 'Trip 2', 'Trip 3', 'Trip 4', 'Trip 5']);
});
