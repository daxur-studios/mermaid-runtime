import type { MermaidRuntime } from '../task-graph-model';
import { nextZoomBand, resolveFarLabel } from './far-zoom.utils';

const node = (extra: Partial<MermaidRuntime.Node>): MermaidRuntime.Node => ({ id: 'a', title: 'A', status: 'undone', ...extra });

describe('nextZoomBand', () => {
  it('goes far below the threshold and stays far inside the gap', () => {
    expect(nextZoomBand('near', 0.39, 0.4)).toBe('far');
    expect(nextZoomBand('far', 0.45, 0.4)).toBe('far');
  });

  it('returns to near only above the gap, and stays near just under the threshold edge', () => {
    expect(nextZoomBand('far', 0.49, 0.4)).toBe('near');
    expect(nextZoomBand('near', 0.41, 0.4)).toBe('near');
  });

  it('is always near when far text is off', () => {
    expect(nextZoomBand('far', 0.05, null)).toBe('near');
  });
});

describe('resolveFarLabel', () => {
  it('shows percent while a step reports progress, its time when done, and nothing before it starts', () => {
    expect(resolveFarLabel(node({ status: 'running', progressPercent: 42.4 }), 0)).toBe('42%');
    expect(resolveFarLabel(node({ status: 'complete', durationMs: 2300 }), 0)).toBe('2.3 s');
    expect(resolveFarLabel(node({ status: 'undone', durationMs: 2300 }), 0)).toBe('');
  });

  it('counts a running step without progress up from its start', () => {
    const startedAt = '2026-10-07T10:00:00.000Z';
    expect(resolveFarLabel(node({ status: 'running', startedAt }), Date.parse(startedAt) + 4000)).toBe('4.0 s');
  });

  it('lets the host override, including with an empty string, and falls back on null', () => {
    expect(resolveFarLabel(node({ status: 'complete', durationMs: 900 }), 0, () => 'OK')).toBe('OK');
    expect(resolveFarLabel(node({ status: 'complete', durationMs: 900 }), 0, () => '')).toBe('');
    expect(resolveFarLabel(node({ status: 'complete', durationMs: 900 }), 0, () => null)).toBe('900 ms');
  });
});
