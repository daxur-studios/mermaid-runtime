import { buildMermaidRuntimeConfig, NODE_LABEL_CSS, NODE_LABEL_WRAP_WIDTH_PX, withNodeLabelLayout } from './mermaid-theme';

describe('withNodeLabelLayout', () => {
  it('adds the wrap width and the measured label CSS to a host config', () => {
    const config = withNodeLabelLayout({ theme: 'base' });

    expect(config.theme).toBe('base');
    expect(config.flowchart?.wrappingWidth).toBe(NODE_LABEL_WRAP_WIDTH_PX);
    expect(config.themeCSS).toContain(NODE_LABEL_CSS);
  });

  it('keeps the host wrap width and puts host CSS after ours so it wins', () => {
    const config = withNodeLabelLayout({ flowchart: { wrappingWidth: 320 }, themeCSS: '.node .nodeLabel { line-height: 2; }' });

    expect(config.flowchart?.wrappingWidth).toBe(320);
    expect(config.themeCSS?.indexOf(NODE_LABEL_CSS)).toBeLessThan(config.themeCSS!.indexOf('line-height: 2'));
  });

  it('keeps the rest of the flowchart config', () => {
    const config = withNodeLabelLayout(buildMermaidRuntimeConfig('dark', false));

    expect(config.flowchart?.htmlLabels).toBeTrue();
    expect(config.flowchart?.useMaxWidth).toBeFalse();
  });
});
