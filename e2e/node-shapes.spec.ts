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
  await page.getByRole('checkbox', { name: 'Kinds by step type' }).check();
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

/** Colour of the built-in `accent` tone, as the browser reports it. */
const ACCENT_TONE_RGB = 'rgb(91, 156, 245)';

/** Ticks to advance so some steps are done and one is running, which restyles label text. */
const TICKS_BEFORE_STATUS_CHECK = 6;

test('step kinds draw an icon and a toned chip that status colours do not overwrite', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('/large-flow');
  await page.getByRole('combobox', { name: 'Flow size', exact: true }).selectOption({ label: '24 steps · 1 trip' });
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });
  await page.getByRole('checkbox', { name: 'Kinds by step type' }).check();
  await waitForStableGraph(page);
  for (let tick = 0; tick < TICKS_BEFORE_STATUS_CHECK; tick++) await page.getByRole('button', { name: 'Advance tick' }).click();
  await waitForStableGraph(page);

  const probe = await page.evaluate(() => {
    const root = document.querySelector('.graph-canvas__mermaid:not(.graph-canvas__render-sandbox)') as HTMLElement;
    const slots = [...root.querySelectorAll('.mr-node-icon')] as HTMLElement[];
    const chips = [...root.querySelectorAll('.mr-node-chip')] as HTMLElement[];
    const inside = (inner: DOMRect, outer: DOMRect) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    return {
      slots: slots.length,
      empty: slots.filter((slot) => !slot.querySelector('svg')).length,
      icons: slots.filter((slot) => slot.getBoundingClientRect().width > 0).length,
      untoned: slots.filter((slot) => getComputedStyle(slot.querySelector('svg')!.querySelector('path, ellipse, circle')!).stroke !== getComputedStyle(slot).color).length,
      outside: slots.filter((slot) => !inside(slot.getBoundingClientRect(), slot.closest('g.node')!.querySelector('.label-container')!.getBoundingClientRect())).length,
      chips: chips.map((chip) => ({ text: chip.textContent, color: getComputedStyle(chip).color })),
    };
  });
  expect(probe.slots, 'icons are drawn').toBeGreaterThan(0);
  expect(probe.empty, 'every icon slot has its SVG').toBe(0);
  expect(probe.icons, 'icons take up room').toBe(probe.slots);
  expect(probe.outside, 'icons sit inside their node').toBe(0);
  expect(probe.untoned, 'Mermaid node styling does not recolour the icon strokes').toBe(0);
  const texts = new Set(probe.chips.map((chip) => chip.text));
  expect(texts, 'kind chips and the per-node poll override').toEqual(new Set(['psql', 'kafka', 'poll 5s']));
  expect(probe.chips.find((chip) => chip.text === 'psql')?.color, 'status styling keeps the tone colour').toBe(ACCENT_TONE_RGB);
  expect(new Set(probe.chips.map((chip) => chip.color)).size, 'tones differ between kinds').toBeGreaterThan(1);
  expect(errors).toEqual([]);
});
