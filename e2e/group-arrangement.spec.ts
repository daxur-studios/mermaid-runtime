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

/**
 * Minimum share of phase groups whose box is longer across the flow than along it.
 *
 * VALUE: With no group direction set, chained phase groups keep the outer flow
 * inside (a 195 × 1776 strip); with it, nearly all are short rows or columns.
 */
const MIN_ACROSS_FLOW_SHARE = 0.7;

/**
 * Largest distance (screen px) an arrow between phases may start or end from the
 * step it belongs to.
 *
 * VALUE: Mermaid draws these arrows from group border to group border, tens of
 * pixels from the steps; redrawn arrows touch them.
 */
const MAX_ROUTE_END_GAP_PX = 3;

async function readLayout(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.graph-canvas__mermaid svg') as SVGSVGElement;
    const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const viewport = document.querySelector('.graph-camera__viewport, mr-graph-camera')!.getBoundingClientRect();
    const rendered = svg.getBoundingClientRect();
    const clusters = [...svg.querySelectorAll('g.cluster')].map((cluster) => {
      const box = cluster.getBoundingClientRect();
      // Titles are raised out of their cluster, above the arrows.
      const title = svg.querySelector(`[data-mr-group-label-for="${cluster.id}"]`);
      return { label: title?.textContent?.trim() ?? '', x: box.x, y: box.y };
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

test('chained phase groups run their steps across the flow', async ({ page }) => {
  await page.goto('/large-flow');
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });

  for (const [layout, wideAxis] of [['TD', 'width'], ['LR', 'height']] as const) {
    await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption(layout);
    await waitForStableGraph(page);

    const shapes = await page.evaluate(() => {
      const svg = document.querySelector('.graph-canvas__mermaid svg') as SVGSVGElement;
      return [...svg.querySelectorAll('g.cluster > rect')].map((rect) => {
        const box = rect.getBoundingClientRect();
        return { width: box.width, height: box.height };
      });
    });

    // Steps of a phase run across the flow, so most boxes are long on that axis
    // (a few, like fan-in groups, may not be); one long strip would make them the other way round.
    const acrossCount = shapes.filter((shape) => (wideAxis === 'width' ? shape.width > shape.height : shape.height > shape.width)).length;
    expect(shapes.length).toBeGreaterThan(0);
    expect(acrossCount / shapes.length, `${layout}: share of phase groups laid out across the flow`).toBeGreaterThan(MIN_ACROSS_FLOW_SHARE);
  }
});

test('arrows between phases run from step to step, in both group flows and both directions', async ({ page }) => {
  await page.goto('/large-flow');
  await page.getByRole('combobox', { name: 'Flow size', exact: true }).selectOption({ label: '24 steps · 1 trip' });
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });

  for (const layout of ['TD', 'LR']) {
    for (const groupFlow of ['alternate', 'same']) {
      await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption(layout);
      await page.getByRole('combobox', { name: 'Group flow', exact: true }).selectOption(groupFlow);
      await waitForStableGraph(page);

      const { gaps, unrouted } = await page.evaluate(() => {
        const svg = document.querySelector('.graph-canvas__mermaid svg') as SVGSVGElement;
        const distanceToBox = (x: number, y: number, box: DOMRect) => Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
        const nodeBox = (alias: string) => svg.querySelector(`g.node[id*="flowchart-${alias}-"]`)!.getBoundingClientRect();
        const clusters = [...svg.querySelectorAll('g.cluster > rect')].map((rect) => rect.getBoundingClientRect());
        const clusterOf = (box: DOMRect) => clusters.findIndex((cluster) => box.left >= cluster.left - 1 && box.right <= cluster.right + 1 && box.top >= cluster.top - 1 && box.bottom <= cluster.bottom + 1);
        const readAliases = (path: Element) => /^L_(tg\d+)_(tg\d+)_\d+$/.exec(path.getAttribute('data-id') ?? '')!;

        const crossing = [...svg.querySelectorAll<SVGPathElement>('path.flowchart-link')].filter((path) => {
          const [, from, to] = readAliases(path);
          return clusterOf(nodeBox(from)) !== clusterOf(nodeBox(to));
        });
        return {
          unrouted: crossing.filter((path) => !path.hasAttribute('data-mr-routed')).length,
          gaps: crossing.map((path) => {
            const [, from, to] = readAliases(path);
            const matrix = path.getScreenCTM()!;
            const start = path.getPointAtLength(0).matrixTransform(matrix);
            const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
            return { start: distanceToBox(start.x, start.y, nodeBox(from)), end: distanceToBox(end.x, end.y, nodeBox(to)) };
          }),
        };
      });

      expect(gaps.length, `${layout}/${groupFlow}: arrows between phases`).toBeGreaterThan(0);
      expect(unrouted, `${layout}/${groupFlow}: arrows between phases left as Mermaid drew them`).toBe(0);
      for (const gap of gaps) {
        expect(gap.start, `${layout}/${groupFlow}: arrow start to its step`).toBeLessThan(MAX_ROUTE_END_GAP_PX);
        expect(gap.end, `${layout}/${groupFlow}: arrow end to its step`).toBeLessThan(MAX_ROUTE_END_GAP_PX);
      }
    }
  }
});

test('group titles are drawn above the arrows, on a pill', async ({ page }) => {
  await page.goto('/large-flow');
  await waitForStableGraph(page);

  const titles = await page.evaluate(() => {
    const svg = document.querySelector('.graph-canvas__mermaid svg') as SVGSVGElement;
    return [...svg.querySelectorAll('g.cluster')].map((cluster) => {
      const title = svg.querySelector(`[data-mr-group-label-for="${cluster.id}"]`);
      const root = cluster.closest('g.root')!;
      const edges = root.querySelector(':scope > g.edgePaths');
      const pill = title?.querySelector(':scope > rect.mr-group-label-backdrop');
      return {
        hasTitle: !!title,
        sameRoot: title?.closest('g.root') === root,
        // DOCUMENT_POSITION_FOLLOWING: the title is painted after (on top of) the arrows.
        aboveArrows: !!title && !!edges && (edges.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        pillFill: pill ? getComputedStyle(pill).fillOpacity : null,
      };
    });
  });

  expect(titles.length).toBeGreaterThan(0);
  for (const title of titles) {
    expect(title).toEqual({ hasTitle: true, sameRoot: true, aboveArrows: true, pillFill: '0.9' });
  }
});
