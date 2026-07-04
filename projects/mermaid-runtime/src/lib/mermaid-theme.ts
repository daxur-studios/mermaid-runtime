import type { MermaidAPI } from 'ngx-markdown';

import { MermaidRuntime } from './task-graph-model';

export type MermaidRuntimeConfig = MermaidAPI.MermaidConfig;

/**
 * Builds the runtime's default Mermaid render config for a light or dark host theme.
 *
 * PURPOSE: Keep Mermaid's own SVG colors aligned with the host app without requiring
 * each graph component to hand-roll the same config object.
 *
 * VALUE: Hosts can pass only a simple `mermaidTheme` input for the common case, while
 * advanced hosts can still override the whole Mermaid config with `mermaidConfig`.
 */
export function buildMermaidRuntimeConfig(
  theme: MermaidRuntime.MermaidThemeId,
  startOnLoad: boolean,
): MermaidRuntimeConfig {
  return {
    theme: theme === 'light' ? 'default' : 'dark',
    startOnLoad,
    securityLevel: 'loose',
    flowchart: {
      useMaxWidth: false,
      htmlLabels: true,
      curve: 'basis',
    },
  };
}

/**
 * Reads a stable comparison key for Mermaid's global render configuration.
 *
 * PURPOSE: Mermaid stores initialization state globally, so direct `mermaid.render()`
 * callers need to know whether a new render config must be applied first.
 *
 * VALUE: Graph previews can react to theme changes without repeatedly reinitializing
 * Mermaid when the effective config is unchanged.
 */
export function readMermaidRuntimeConfigKey(config: MermaidRuntimeConfig): string {
  try {
    return JSON.stringify(config) ?? `${config.theme ?? 'default'}:${config.startOnLoad ?? false}`;
  } catch {
    return `${config.theme ?? 'default'}:${config.startOnLoad ?? false}`;
  }
}
