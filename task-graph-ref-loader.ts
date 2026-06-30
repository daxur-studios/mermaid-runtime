/**
 * Inspector data seam for the task-graph viewer.
 *
 * PURPOSE: Let the viewer load a node ref's preview (input/output/context/log/
 * artifact) without knowing *how* — the host plugs an implementation in.
 *
 * VALUE: This is the viewer's last runtime tie to any backend, inverted into a
 * token. The daemon provides a loader wrapping its HTTP route; a different
 * project provides its own; a host that omits the inspector provides nothing and
 * the dependency vanishes. Nothing here imports the daemon API — it travels with
 * the library (see `docs/draft/033_task-graph-library-extraction.md`).
 */
import { InjectionToken } from '@angular/core';
import type { Observable } from 'rxjs';

import type { MermaidRuntime } from './task-graph-model';

/**
 * Everything a loader needs to fetch one ref's preview.
 *
 * VALUE: Carries both the identity (run/node/ref ids) a backend route needs and
 * the resolved `ref` object, so a loader can read either.
 */
export interface TaskGraphRefRequest {
  /** Durable run id the ref belongs to. */
  runId: string;
  /** Node id the ref hangs off. */
  nodeId: string;
  /** Which ref group was clicked. */
  refKind: MermaidRuntime.InspectableRefKind;
  /** Id of the specific ref within that group. */
  refId: string;
  /** The resolved ref object (path/summary/label, etc.). */
  ref: MermaidRuntime.InspectableRef;
}

/**
 * Host-supplied loader for node-ref previews.
 *
 * VALUE: A single method, returning an `Observable` or a `Promise`, so hosts can
 * back it with HTTP, fetch, or in-memory data without the viewer caring.
 */
export interface TaskGraphRefLoader {
  loadRef(
    request: TaskGraphRefRequest,
  ): Observable<MermaidRuntime.RefContent> | Promise<MermaidRuntime.RefContent>;
}

/**
 * DI token the viewer reads (optionally) to resolve a {@link TaskGraphRefLoader}.
 *
 * VALUE: Optional injection — when no loader is provided, the inspector simply
 * reports that previews are unavailable instead of pulling in a backend.
 */
export const TASK_GRAPH_REF_LOADER = new InjectionToken<TaskGraphRefLoader>(
  'TASK_GRAPH_REF_LOADER',
);
