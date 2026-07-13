/**
 * Creates a measurable Mermaid render host that cannot affect document flow.
 * Mermaid's container must be attached for SVG/foreignObject measurement, so a
 * detached element or `display:none` is not sufficient.
 */
export function createMermaidRenderSandbox(parent: HTMLElement, className = ''): HTMLDivElement {
  const sandbox = parent.ownerDocument.createElement('div');
  sandbox.className = className;
  sandbox.setAttribute('aria-hidden', 'true');
  Object.assign(sandbox.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    zIndex: '-1',
    opacity: '0',
    pointerEvents: 'none',
  });
  parent.append(sandbox);
  return sandbox;
}

const MERMAID_TEMP_STYLE_ID = 'mr-mermaid-temporary-render-isolation';

/**
 * Mermaid creates a body-level `d${renderId}` wrapper when no container is
 * supplied. Supplying a hidden container breaks Mermaid's foreignObject label
 * measurement in some browsers, so isolate those known temporary wrappers with
 * a document-level rule while leaving their normal measurement behavior intact.
 */
export function ensureMermaidTemporaryRenderIsolation(document: Document): void {
  if (document.getElementById(MERMAID_TEMP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MERMAID_TEMP_STYLE_ID;
  style.textContent = `
    body > div[id^="dmr-main-graph-"],
    body > div[id^="dmr-sg-preview-"],
    body > div[id^="dmr-graph-preview-simple-"],
    body > div[id^="dmr-graph-preview-mermaid-"] {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      z-index: -1 !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;
  document.head.append(style);
}
