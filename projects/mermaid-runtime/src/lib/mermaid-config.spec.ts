import mermaid from 'mermaid';

import { ensureMermaidConfigured } from './mermaid-config';
import { buildMermaidRuntimeConfig, type MermaidRuntimeConfig } from './mermaid-theme';

describe('ensureMermaidConfigured', () => {
  // A marker unique to this spec, so the shared cache can't already hold these configs
  // from another spec or component that rendered earlier in the same test run.
  const specMarker = 'ensure-mermaid-configured-spec';

  /** Canvas-style config: HTML labels on. */
  const configA: MermaidRuntimeConfig = {
    ...buildMermaidRuntimeConfig('dark', false),
    fontFamily: `${specMarker}-a`,
  };

  /** Compact preview-style config: HTML labels off, different theme. */
  const configB: MermaidRuntimeConfig = {
    ...buildMermaidRuntimeConfig('light', false),
    fontFamily: `${specMarker}-b`,
    flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis' },
  };

  let initializeSpy: jasmine.Spy;

  beforeEach(() => {
    initializeSpy = spyOn(mermaid, 'initialize');
  });

  it('re-applies a config after another caller replaced it (A, B, A)', () => {
    ensureMermaidConfigured(configA);
    ensureMermaidConfigured(configB);
    ensureMermaidConfigured(configA);

    expect(initializeSpy).toHaveBeenCalledTimes(3);
    expect(initializeSpy.calls.argsFor(0)).toEqual([configA]);
    expect(initializeSpy.calls.argsFor(1)).toEqual([configB]);
    expect(initializeSpy.calls.argsFor(2)).toEqual([configA]);
  });

  it('skips initialize when the same config is applied again', () => {
    ensureMermaidConfigured(configB);
    ensureMermaidConfigured({ ...configB });

    expect(initializeSpy).toHaveBeenCalledTimes(1);
  });
});
