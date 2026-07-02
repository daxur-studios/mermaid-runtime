import { MermaidRuntime } from '../task-graph-model';

/**
 * Built-in status → visual-treatment map for the preview components.
 *
 * PURPOSE: Give the five daemon-default states a colour when a host doesn't
 * supply its own `statusStyles`.
 *
 * VALUE: A host overrides or extends this by passing its own `statusStyles`
 * input to `<mr-graph-preview>` — kept as its own small constant here (rather
 * than imported from `graph-canvas`) so the preview components have no
 * dependency on the canvas.
 */
export const DEFAULT_PREVIEW_STATUS_STYLES: MermaidRuntime.StatusStyleMap = {
  running: { className: 'running', label: 'Running' },
  complete: { className: 'done', label: 'Complete' },
  failed: { className: 'failed', label: 'Failed' },
  skipped: { className: 'skipped', label: 'Skipped' },
};
