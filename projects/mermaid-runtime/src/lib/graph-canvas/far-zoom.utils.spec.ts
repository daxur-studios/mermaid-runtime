import type { MermaidRuntime } from '../task-graph-model';
import { FAR_NAME_MAX_CHARS, nextZoomBand, resolveFarLabel, shortenNodeName } from './far-zoom.utils';

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

describe('shortenNodeName', () => {
  it('leaves a short name alone and trims stray spaces', () => {
    expect(shortenNodeName('  Plan  ')).toBe('Plan');
    expect(shortenNodeName('x'.repeat(FAR_NAME_MAX_CHARS))).toBe('x'.repeat(FAR_NAME_MAX_CHARS));
  });

  it('cuts a long name to the limit, ending in an ellipsis', () => {
    const short = shortenNodeName('Create trip in legacy UI');
    expect(short.length).toBeLessThanOrEqual(FAR_NAME_MAX_CHARS);
    expect(short.endsWith('…')).toBe(true);
    expect(short).toBe('Create tr…');
  });

  it('does not leave a space before the ellipsis', () => {
    expect(shortenNodeName('Plan approach now')).toBe('Plan appr…');
    expect(shortenNodeName('Run the tests now')).toBe('Run the t…');
    expect(shortenNodeName('Plan a b c d e f g')).toBe('Plan a b…');
  });
});

describe('resolveFarLabel', () => {
  it('uses the percentage and time line of the node itself', () => {
    expect(resolveFarLabel(node({ status: 'running' }), '42% · 3.5 s')).toBe('42% · 3.5 s');
    expect(resolveFarLabel(node({}), '')).toBe('');
  });

  it('lets the host override, including with an empty string, and falls back on null', () => {
    expect(resolveFarLabel(node({ status: 'complete' }), '900 ms', () => 'OK')).toBe('OK');
    expect(resolveFarLabel(node({}), '900 ms', () => '')).toBe('');
    expect(resolveFarLabel(node({}), '900 ms', () => null)).toBe('900 ms');
  });
});
