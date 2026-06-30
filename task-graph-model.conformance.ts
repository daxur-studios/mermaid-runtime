/**
 * Compile-time proof that the daemon's task-run model still satisfies the
 * viewer's self-owned `TaskGraphModel` contract.
 *
 * PURPOSE: Catch drift the moment a `DaxurDaemonAPI.TaskRun*` shape stops being
 * assignable to the corresponding `TaskGraphModel` type (e.g. a renamed field or
 * a narrowed status), instead of discovering it at a binding site.
 *
 * VALUE: Keeps the two models "matching" without coupling — the viewer never
 * imports the daemon API, this single type-only file does. It is the one place
 * that ties them together and the one file to DELETE when the viewer is lifted
 * into its own package (see `docs/draft/033_task-graph-library-extraction.md`).
 */
import type { DaxurDaemonAPI } from '@daxur-daemon-api/daxur-daemon-api';
import type { TaskGraphModel } from './task-graph-model';

/** Resolves to `true` only when `T` is assignable to `U`; a compile error otherwise. */
type AssertExtends<T extends U, U> = T extends U ? true : never;

/**
 * Each entry fails to compile if the daemon type drifts away from the viewer's
 * required subset. Exported so the unused-type aliases are not flagged.
 */
export type DaemonSatisfiesTaskGraphModel = [
  AssertExtends<DaxurDaemonAPI.TaskRunNode, TaskGraphModel.Node>,
  AssertExtends<DaxurDaemonAPI.TaskRunNodeStatus, TaskGraphModel.NodeStatus>,
  AssertExtends<DaxurDaemonAPI.TaskRunTransition, TaskGraphModel.Transition>,
  AssertExtends<DaxurDaemonAPI.TaskRunInspectableRef, TaskGraphModel.InspectableRef>,
  AssertExtends<DaxurDaemonAPI.TaskRunInspectableRefKind, TaskGraphModel.InspectableRefKind>,
  AssertExtends<DaxurDaemonAPI.TaskRunRefContent, TaskGraphModel.RefContent>,
];
