import { expect, test } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

/** Vertices of Mermaid's hexagon. */
const HEXAGON_POINTS = 6;

/** Vertices of Mermaid's parallelogram. */
const PARALLELOGRAM_POINTS = 4;

test('step types render as their own shapes and the selected ring follows the outline', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/large-flow');
  await page.getByRole('combobox', { name: 'Flow size', exact: true }).selectOption({ label: '24 steps · 1 trip' });
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });
  await page.getByRole('checkbox', { name: 'Shapes by step type' }).check();
  await waitForStableGraph(page);

  const shapes = await page.evaluate(() => {
    const svg = document.querySelector('.graph-canvas__mermaid:not(.graph-canvas__render-sandbox) svg') as SVGSVGElement;
    return [...svg.querySelectorAll('g.node')].map((node) => {
      const shape = node.querySelector('.label-container') as SVGGraphicsElement;
      return {
        tag: shape.tagName.toLowerCase(),
        points: shape instanceof SVGPolygonElement ? shape.points.length : 0,
        rx: shape instanceof SVGRectElement ? shape.rx.baseVal.value : 0,
      };
    });
  });
  expect(shapes.filter((shape) => shape.tag === 'polygon' && shape.points === HEXAGON_POINTS).length, 'assert steps are hexagons').toBeGreaterThan(0);
  expect(shapes.filter((shape) => shape.tag === 'polygon' && shape.points === PARALLELOGRAM_POINTS).length, 'Kafka steps are parallelograms').toBeGreaterThan(0);
  expect(shapes.filter((shape) => shape.tag === 'rect' && shape.rx > 0).length, 'SQL steps are rounded').toBeGreaterThan(0);

  await page.locator('.graph-canvas__mermaid:not(.graph-canvas__render-sandbox) g.node').filter({ has: page.locator('polygon.label-container') }).first().click({ force: true });
  const ring = await page.evaluate(() => {
    const overlay = document.querySelector('.graph-canvas__mermaid:not(.graph-canvas__render-sandbox) .mr-node-outline-selected');
    return overlay ? { tag: overlay.tagName.toLowerCase(), points: overlay instanceof SVGPolygonElement ? overlay.points.length : 0 } : null;
  });
  expect(ring, 'selected ring exists').not.toBeNull();
  expect(ring!.tag).toBe('polygon');
  expect(ring!.points).toBeGreaterThanOrEqual(PARALLELOGRAM_POINTS);
  expect(errors).toEqual([]);
});
