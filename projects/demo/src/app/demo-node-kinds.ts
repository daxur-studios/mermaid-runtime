import { MermaidRuntime } from '@daxur-studios/mermaid-runtime';

/** Wraps icon paths in a stroke-style 24-unit SVG that takes its colour from the label text. */
function strokeIcon(paths: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/** Loop arrows: a step that repeats until a condition holds. */
export const REFRESH_ICON = strokeIcon('<path d="M20 11a8 8 0 0 0-14.5-3M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14.5 3M20 19v-4h-4"/>');

/** Stacked disc: a database step. */
export const DATABASE_ICON = strokeIcon('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>');

/** Tick: a check or assertion. */
export const CHECK_ICON = strokeIcon('<path d="M5 12l5 5L20 7"/>');

/** Paper plane: a message step. */
export const SEND_ICON = strokeIcon('<path d="M10 14L21 3M21 3l-6.5 18-4-8-8-4z"/>');

/**
 * Demo kinds, keyed by step type: shape says what the step is, the icon and chip
 * say which tool, the tone colours the chip and icon.
 */
export const DEMO_NODE_KINDS: Record<string, MermaidRuntime.NodeKindStyle> = {
  assert: { shape: 'hexagon', icon: CHECK_ICON, tone: 'teal' },
  SQL: { shape: 'rounded', icon: DATABASE_ICON, chip: 'psql', tone: 'accent' },
  Kafka: { shape: 'parallelogram', icon: SEND_ICON, chip: 'kafka', tone: 'violet' },
};
