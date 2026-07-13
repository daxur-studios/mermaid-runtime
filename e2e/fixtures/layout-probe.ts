import { expect, type Page } from '@playwright/test';

export interface ProbeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutProbeFrame {
  timestamp: number;
  renderPhase: string | null;
  renderGeneration: number | null;
  pageVerticalScrollbarGutter: number;
  pageHorizontalScrollbarGutter: number;
  pageClientWidth: number;
  pageClientHeight: number;
  pageScrollWidth: number;
  pageScrollHeight: number;
  pageHasHorizontalOverflow: boolean;
  pageHasVerticalOverflow: boolean;
  hostScrollbarGutterX: number;
  hostScrollbarGutterY: number;
  host: ProbeRect | null;
  viewport: ProbeRect | null;
  scene: ProbeRect | null;
  svg: ProbeRect | null;
  visibleSvgCount: number;
  viewportOverflowX: string | null;
  viewportOverflowY: string | null;
  cameraTransform: string | null;
  pageOverflowElements: Array<{ selector: string; bottom: number; position: string }>;
}

const PROBE_KEY = '__MERMAID_RUNTIME_PLAYWRIGHT_LAYOUT_PROBE__';

export async function waitForStableGraph(page: Page, afterGeneration = -1): Promise<number> {
  try {
    await page.waitForFunction((minimumGeneration) => {
      const canvas = document.querySelector('mr-graph-canvas');
      if (!canvas) return false;
      const generation = Number(canvas.getAttribute('data-render-generation'));
      const phase = canvas.getAttribute('data-render-phase');
      return phase === 'error' || (phase === 'stable'
        && Number.isFinite(generation)
        && generation > minimumGeneration);
    }, afterGeneration, { timeout: 8_000 });
  } catch (error) {
    const canvas = page.locator('mr-graph-canvas');
    throw new Error(
      `Graph did not settle (generation=${await canvas.getAttribute('data-render-generation')}, `
      + `phase=${await canvas.getAttribute('data-render-phase')}, message=${await canvas.getAttribute('data-render-message')})`,
      { cause: error },
    );
  }

  const phase = await page.locator('mr-graph-canvas').getAttribute('data-render-phase');
  if (phase === 'error') {
    throw new Error(
      `Graph render failed in generation ${await page.locator('mr-graph-canvas').getAttribute('data-render-generation')}: `
      + `${await page.locator('mr-graph-canvas').getAttribute('data-render-message')}`,
    );
  }

  return Number(await page.locator('mr-graph-canvas').getAttribute('data-render-generation'));
}

export async function startLayoutProbe(page: Page): Promise<void> {
  await page.evaluate((probeKey) => {
    type ProbeStore = { active: boolean; frames: LayoutProbeFrame[] };
    const globalWindow = window as unknown as Record<string, unknown>;
    const existing = globalWindow[probeKey] as ProbeStore | undefined;
    if (existing) existing.active = false;

    const store: ProbeStore = { active: true, frames: [] };
    globalWindow[probeKey] = store;

    const readRect = (element: Element | null): ProbeRect | null => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const readScrollbarGutter = (element: HTMLElement, axis: 'x' | 'y'): number => {
      const style = getComputedStyle(element);
      if (axis === 'x') {
        return Math.max(0, element.offsetWidth - element.clientWidth
          - parseFloat(style.borderLeftWidth || '0') - parseFloat(style.borderRightWidth || '0'));
      }
      return Math.max(0, element.offsetHeight - element.clientHeight
        - parseFloat(style.borderTopWidth || '0') - parseFloat(style.borderBottomWidth || '0'));
    };

    const sample = (): void => {
      if (!store.active) return;
      const documentElement = document.documentElement;
      const host = document.querySelector<HTMLElement>('[data-testid="graph-host"]');
      const canvas = document.querySelector<HTMLElement>('mr-graph-canvas');
      const viewport = canvas?.querySelector<HTMLElement>('.graph-camera__viewport') ?? null;
      const scene = canvas?.querySelector<HTMLElement>('.graph-camera__scene') ?? null;
      const visibleSvgs = canvas
        ? Array.from(canvas.querySelectorAll<SVGSVGElement>('.graph-canvas__viewport .graph-canvas__mermaid > svg'))
        : [];
      const svg = visibleSvgs[0] ?? null;
      const viewportStyle = viewport ? getComputedStyle(viewport) : null;
      const generationValue = canvas?.getAttribute('data-render-generation') ?? null;
      const generation = generationValue === null ? null : Number(generationValue);
      const pageOverflowElements = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
        .map(element => ({
          element,
          rect: element.getBoundingClientRect(),
          position: getComputedStyle(element).position,
        }))
        .filter(item => item.rect.bottom > window.innerHeight + 1)
        .sort((a, b) => b.rect.bottom - a.rect.bottom)
        .slice(0, 6)
        .map(item => ({
          selector: `${item.element.tagName.toLowerCase()}#${item.element.id}.${Array.from(item.element.classList).join('.')}`,
          bottom: item.rect.bottom,
          position: item.position,
        }));

      store.frames.push({
        timestamp: performance.now(),
        renderPhase: canvas?.getAttribute('data-render-phase') ?? null,
        renderGeneration: generation !== null && Number.isFinite(generation) ? generation : null,
        pageVerticalScrollbarGutter: window.innerWidth - documentElement.clientWidth,
        pageHorizontalScrollbarGutter: window.innerHeight - documentElement.clientHeight,
        pageClientWidth: documentElement.clientWidth,
        pageClientHeight: documentElement.clientHeight,
        pageScrollWidth: documentElement.scrollWidth,
        pageScrollHeight: documentElement.scrollHeight,
        pageHasHorizontalOverflow: documentElement.scrollWidth > documentElement.clientWidth + 1,
        pageHasVerticalOverflow: documentElement.scrollHeight > documentElement.clientHeight + 1,
        hostScrollbarGutterX: host ? readScrollbarGutter(host, 'x') : 0,
        hostScrollbarGutterY: host ? readScrollbarGutter(host, 'y') : 0,
        host: readRect(host),
        viewport: readRect(viewport),
        scene: readRect(scene),
        svg: readRect(svg),
        visibleSvgCount: visibleSvgs.length,
        viewportOverflowX: viewportStyle?.overflowX ?? null,
        viewportOverflowY: viewportStyle?.overflowY ?? null,
        cameraTransform: scene?.style.transform || null,
        pageOverflowElements,
      });
      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  }, PROBE_KEY);
}

export async function stopLayoutProbe(page: Page): Promise<LayoutProbeFrame[]> {
  return page.evaluate((probeKey) => {
    const globalWindow = window as unknown as Record<string, unknown>;
    const store = globalWindow[probeKey] as { active: boolean; frames: LayoutProbeFrame[] } | undefined;
    if (!store) return [];
    store.active = false;
    return store.frames;
  }, PROBE_KEY);
}

export function expectStableContainers(frames: readonly LayoutProbeFrame[]): void {
  expect(frames.length, 'layout probe should capture animation frames').toBeGreaterThan(1);
  const baselineHost = frames[0].host;
  const baselineViewport = frames[0].viewport;
  const baselinePage = frames[0];
  expect(baselineHost, 'graph host should be measurable').not.toBeNull();
  expect(baselineViewport, 'camera viewport should be measurable').not.toBeNull();

  for (const [index, frame] of frames.entries()) {
    expect(frame.pageVerticalScrollbarGutter, `vertical page scrollbar changed at frame ${index}`).toBe(baselinePage.pageVerticalScrollbarGutter);
    expect(frame.pageHorizontalScrollbarGutter, `horizontal page scrollbar changed at frame ${index}`).toBe(baselinePage.pageHorizontalScrollbarGutter);
    expect(frame.pageHasHorizontalOverflow, `horizontal page overflow toggled at frame ${index}`).toBe(baselinePage.pageHasHorizontalOverflow);
    expect(frame.pageHasVerticalOverflow, `vertical page overflow toggled at frame ${index}`).toBe(baselinePage.pageHasVerticalOverflow);
    expect(Math.abs(frame.pageScrollWidth - baselinePage.pageScrollWidth), `page scroll width moved at frame ${index}`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(frame.pageScrollHeight - baselinePage.pageScrollHeight),
      `page scroll height moved at frame ${index}: ${JSON.stringify(frame.pageOverflowElements)}`,
    ).toBeLessThanOrEqual(1);
    expect(frame.hostScrollbarGutterX, `host vertical scrollbar at frame ${index}`).toBeLessThanOrEqual(1);
    expect(frame.hostScrollbarGutterY, `host horizontal scrollbar at frame ${index}`).toBeLessThanOrEqual(1);
    expect(frame.visibleSvgCount, `visible SVG count at frame ${index}`).toBe(1);
    expect(frame.viewportOverflowX, `viewport overflow-x at frame ${index}`).toBe('hidden');
    expect(frame.viewportOverflowY, `viewport overflow-y at frame ${index}`).toBe('hidden');
    expect(frame.svg?.width ?? 0, `SVG width at frame ${index}`).toBeGreaterThan(0);
    expect(frame.svg?.height ?? 0, `SVG height at frame ${index}`).toBeGreaterThan(0);

    if (baselineHost && frame.host) {
      expect(Math.abs(frame.host.width - baselineHost.width), `host width moved at frame ${index}`).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.host.height - baselineHost.height), `host height moved at frame ${index}`).toBeLessThanOrEqual(1);
    }
    if (baselineViewport && frame.viewport) {
      expect(Math.abs(frame.viewport.width - baselineViewport.width), `viewport width moved at frame ${index}`).toBeLessThanOrEqual(1);
      expect(Math.abs(frame.viewport.height - baselineViewport.height), `viewport height moved at frame ${index}`).toBeLessThanOrEqual(1);
    }
  }
}
