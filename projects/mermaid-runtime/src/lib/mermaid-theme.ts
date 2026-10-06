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

/**
 * Widest a node label may be (px) before its text wraps onto another line.
 *
 * VALUE: Mermaid's own default, named so a long step title wraps at a known
 * width instead of stretching the node. A host that sets
 * `flowchart.wrappingWidth` in its `mermaidConfig` overrides it.
 */
export const NODE_LABEL_WRAP_WIDTH_PX = 200;

/**
 * Line height of wrapped node-label text, as a multiple of the font size.
 *
 * VALUE: Mermaid's inline default is 1.5, which makes a three-line title tall.
 * 1.2 keeps wrapped lines close together, so long titles cost less height and
 * the node stays compact.
 */
export const NODE_LABEL_LINE_HEIGHT = 1.2;

/**
 * CSS that shapes node-label text, given to Mermaid as `themeCSS`.
 *
 * PURPOSE: Mermaid measures each label before it draws the node box. Rules that
 * only exist in the component's stylesheet apply after that measurement, so the
 * text then wraps differently from what the box was sized for and spills out.
 *
 * VALUE: Padding, line height and word breaking are in place while Mermaid
 * measures, so the box fits the text it ends up showing. `overflow-wrap:anywhere`
 * breaks a single long token (a CLI flag, `table.column_name`) at the wrap
 * width instead of widening the node.
 */
export const NODE_LABEL_CSS = `
.node .nodeLabel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  padding: 6px 12px;
  line-height: ${NODE_LABEL_LINE_HEIGHT};
  overflow-wrap: anywhere;
}
.node .nodeLabel p {
  margin: 0;
  line-height: ${NODE_LABEL_LINE_HEIGHT};
}
.node .nodeLabel .mr-node-subtitle {
  display: block;
  margin-top: 3px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8em;
  opacity: 0.72;
}
`;

/**
 * Adds the node-label layout (wrap width and measured label CSS) to a Mermaid config.
 *
 * PURPOSE: Hosts that pass their own `mermaidConfig` replace the runtime's default
 * config, which would otherwise drop the label layout.
 *
 * VALUE: Long step titles wrap inside their nodes whichever way the host themes
 * Mermaid. The host's own `themeCSS` follows ours, so it still wins, and its
 * `flowchart.wrappingWidth` is kept when set.
 */
export function withNodeLabelLayout(config: MermaidRuntimeConfig): MermaidRuntimeConfig {
  return {
    ...config,
    themeCSS: `${NODE_LABEL_CSS}${config.themeCSS ?? ''}`,
    flowchart: {
      ...config.flowchart,
      wrappingWidth: config.flowchart?.wrappingWidth ?? NODE_LABEL_WRAP_WIDTH_PX,
    },
  };
}
