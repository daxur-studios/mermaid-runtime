import mermaid from 'mermaid';

import { readMermaidRuntimeConfigKey, type MermaidRuntimeConfig } from './mermaid-theme';

/**
 * Key for the Mermaid config most recently applied to Mermaid's module-global renderer.
 *
 * PURPOSE: Mermaid keeps one render config for the whole app, so the "last applied"
 * record must be one value too, shared by every component that renders.
 *
 * VALUE: A canvas and a preview on the same page can't each believe their own config
 * is still active after the other one replaced it.
 */
let activeMermaidConfigKey: string | null = null;

/**
 * Applies Mermaid's module-global render config when it differs from the one applied last.
 *
 * PURPOSE: Mermaid keeps its render config as module-global state; whichever caller
 * initializes it last wins app-wide. Every direct `mermaid.render()` caller in the
 * library goes through this one function and its one cache.
 *
 * VALUE: The main graph, its subgraph previews and standalone previews can render with
 * different configs (theme, `htmlLabels`, spacing) on one page without rendering with
 * another component's config, and without reinitializing Mermaid on every render.
 */
export function ensureMermaidConfigured(config: MermaidRuntimeConfig): void {
  const key = readMermaidRuntimeConfigKey(config);
  if (activeMermaidConfigKey === key) return;
  activeMermaidConfigKey = key;
  mermaid.initialize(config);
}
