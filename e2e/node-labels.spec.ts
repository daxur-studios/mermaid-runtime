import { expect, test } from '@playwright/test';
import { waitForStableGraph } from './fixtures/layout-probe';

/**
 * Most a label's text may poke out of its node box (screen px).
 *
 * VALUE: Absorbs sub-pixel rounding; a real overflow is several pixels (a
 * 4-line label measured as 5 lines spilled about 12).
 */
const MAX_LABEL_SPILL_PX = 1;

/** Fewest lines the longest step name must wrap onto, so the check proves wrapping happened. */
const MIN_WRAPPED_LINES = 3;

test('long step names wrap inside their nodes in both directions', async ({ page }) => {
  await page.goto('/large-flow');
  await page.getByRole('combobox', { name: 'Flow size', exact: true }).selectOption({ label: '24 steps · 1 trip' });
  await page.getByRole('combobox', { name: 'View', exact: true }).selectOption({ label: 'Grouped steps' });
  await page.getByRole('checkbox', { name: 'Long step names' }).check();

  for (const layout of ['TD', 'LR']) {
    await page.getByRole('combobox', { name: 'Layout', exact: true }).selectOption(layout);
    await waitForStableGraph(page);

    const labels = await page.evaluate(() => {
      const svg = document.querySelector('.graph-canvas__mermaid svg') as SVGSVGElement;
      return [...svg.querySelectorAll('g.node')].map((node) => {
        const label = node.querySelector('.nodeLabel')!;
        const paragraph = label.querySelector('p') ?? label;
        const box = [...node.querySelectorAll('rect, polygon, path')]
          .filter((shape) => !shape.classList.contains('mr-node-decoration'))
          .map((shape) => shape.getBoundingClientRect())
          .sort((a, b) => b.width * b.height - a.width * a.height)[0];
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
        return {
          title: label.textContent?.trim().slice(0, 30) ?? '',
          spill: Math.max(box.top - text.top, text.bottom - box.bottom, box.left - text.left, text.right - box.right),
          lines: Math.round(text.height / scale / parseFloat(getComputedStyle(paragraph).lineHeight)),
        };
      });
    });

    expect(labels.length, `${layout}: nodes`).toBe(24);
    for (const label of labels) {
      expect(label.spill, `${layout}: "${label.title}" spills out of its node`).toBeLessThanOrEqual(MAX_LABEL_SPILL_PX);
    }
    expect(Math.max(...labels.map((label) => label.lines)), `${layout}: longest name wraps`).toBeGreaterThanOrEqual(MIN_WRAPPED_LINES);
  }
});
