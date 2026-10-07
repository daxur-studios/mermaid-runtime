import { computeFarLayout } from './far-layout.utils';

const NODE = { width: 160, height: 48 };

describe('computeFarLayout', () => {
  it('stacks the kind row above the readout, both centred on the node', () => {
    const layout = computeFarLayout(NODE, { hasIcon: true, chip: 'Kafka', readout: '42% · 3.5 s' });
    expect(layout.kind).not.toBeNull();
    expect(layout.readout).not.toBeNull();
    expect(layout.kind!.y).toBeLessThan(layout.readout!.y);
    const rowCentre = layout.kind!.iconX + (layout.kind!.chipX + layout.kind!.chipWidth - layout.kind!.iconX) / 2;
    expect(rowCentre).toBeCloseTo(0);
    expect(layout.kind!.y - layout.kind!.chipHeight / 2).toBeGreaterThanOrEqual(-NODE.height / 2);
    expect(layout.readout!.y + layout.readout!.fontSize / 2).toBeLessThanOrEqual(NODE.height / 2);
  });

  it('keeps every row inside the node width, shrinking long text', () => {
    const layout = computeFarLayout({ width: 80, height: 48 }, { hasIcon: true, chip: 'Legacy UI', readout: '42% · 1m 05s' });
    expect(layout.readout!.fontSize * 12 * 0.6).toBeLessThanOrEqual(80);
    expect(layout.kind!.chipX + layout.kind!.chipWidth - layout.kind!.iconX).toBeLessThanOrEqual(80);
  });

  it('gives a lone readout the middle of the node and a larger size', () => {
    const alone = computeFarLayout(NODE, { hasIcon: false, chip: '', readout: '2.3 s' });
    const stacked = computeFarLayout(NODE, { hasIcon: true, chip: 'SQL', readout: '2.3 s' });
    expect(alone.kind).toBeNull();
    expect(alone.readout!.y).toBeCloseTo(0);
    expect(alone.readout!.fontSize).toBeGreaterThan(stacked.readout!.fontSize);
    expect(alone.baseFont).toBe(alone.readout!.fontSize);
  });

  it('shows just the kind when there is no readout, and just an icon without a chip', () => {
    const kindOnly = computeFarLayout(NODE, { hasIcon: true, chip: 'Kafka', readout: '' });
    expect(kindOnly.readout).toBeNull();
    expect(kindOnly.kind!.y).toBeCloseTo(0);
    const iconOnly = computeFarLayout(NODE, { hasIcon: true, chip: '', readout: '' });
    expect(iconOnly.kind!.chipWidth).toBe(0);
    expect(iconOnly.kind!.iconSize).toBeGreaterThan(0);
    expect(iconOnly.kind!.iconX).toBeCloseTo(-iconOnly.kind!.iconSize / 2);
  });

  it('draws nothing for a node with nothing to show', () => {
    const layout = computeFarLayout(NODE, { hasIcon: false, chip: '', readout: '' });
    expect(layout.kind).toBeNull();
    expect(layout.readout).toBeNull();
  });
});
