# Interactive E2E slice

Date: 2026-10-05. Status: Draft; not implemented.

Priority update: [work-style demos](03_work-style-demos.md) come first following the user's clarification. Those demos exercise existing seams and inspector configuration; they do not implement this plan's Angular controls inside nodes.

Source: [Context](../runbook/01_context-and-use-cases.md), [baseline](../runbook/02_repository-baseline.md), [node-content proposal](../runbook/03_direction-and-open-questions.md). Related: [Roadmap](00_index.md), [activity plan](02_activity-and-system-views.md).

## Outcome

Make one representative trip-creation workflow comfortable to configure, follow, and inspect. Use the existing demo app with synthetic data and a fake host adapter so the result can be evaluated without access to work infrastructure.

Before committing to an API, compare the same tasks with the LiteGraph version if available: change a parameter, start/observe a run, inspect a wait/failure, enter a subflow, and return to the running step. Record concrete friction rather than an overall aesthetic score.

## Stage A: prove one interactive node

- Add a Playwright-style node with a real Angular Material headed/headless checkbox and a text parameter. Values live in host draft state, keyed by stable node instance identity.
- Investigate fixed-size reserved content plus an Angular layer in the camera scene. Define graph-space node bounds and convert SVG coordinates explicitly; do not mix viewport pixel coordinates with scene coordinates.
- Keep node size stable as status, input values, and preview frames change. A requested footprint change is a structural update and may require layout.
- Manage views through Angular, including update and destruction. Preserve values in host state if views are recreated; restore focus where practical after structural changes.
- Define event ownership: editing a field must not pan the graph, trigger drill-down, or activate node selection unintentionally. Include keyboard focus and scrolling. Check Material menus/selects whose overlay panels may live outside the transformed scene.
- Retain default node rendering when no rich content is supplied. Avoid publishing domain-specific inputs such as `playwrightHeaded` on the generic canvas.

Candidate contract concepts, **not API names or final types**: node content template/factory, declared footprint, node identity/path, view mode, host data, and emitted user intent. Prefer the smallest seam that serves both an E2E step and a generic AI-process node.

## Stage B: representative fixture

Provide a small scenario containing an environment assertion, a reusable preparation subflow, Kafka readiness, trip creation, concurrent Kafka/SQL waits, GUID capture, and final assertions. Include synthetic success, timeout, and failure histories.

| Interaction | Expected behavior |
| --- | --- |
| Select local versus shared dev before run | Host derives eligibility; local-only preparation remains visible with an explicit skip reason in dev |
| Start a run | Host validates preconditions, captures applied configuration/environment, and acknowledges the request |
| Change draft parameters | Editable before run under the initial assumption; a running instance displays its captured configuration |
| Enter a reused preparation flow | Breadcrumb and node IDs identify this invocation; another invocation does not share live state accidentally |
| Run Kafka and SQL waits concurrently | Both remain visible as active/waiting; camera follow does not oscillate between them |
| Inspect trip number, GUID, or assertion | Show captured value, producing step, and relevant expected/actual evidence through host refs |
| Attempt ineligible reset | Fake host rejects it even if invoked directly; the viewer surfaces the reason |

Kafka subscription readiness precedes the action that can produce a message. The host owns buffering, matching, timeout, cancellation, and subscription cleanup. SQL waits display host-provided elapsed time/attempts/latest condition; they do not pretend to have a meaningful percentage if none exists.

## Stage C: bounded Playwright preview

Begin with a synthetic, low-rate image sequence in a fixed-size preview area. Show capture time and stale/disconnected state; provide a larger inspector view. Then evaluate host-served frames from an actual Playwright integration separately.

Headed execution and preview availability are separate settings. Avoid embedding the target application in an iframe as a substitute for showing the runner's browser session. Frames must come from the host that owns that session. Keep frame loading bounded and stop subscriptions when nodes leave the active view or the component is destroyed. Replay uses recorded artifacts when available, not the current live frame.

## Acceptance and validation

- Checkbox and text field work using mouse and keyboard without moving the canvas; values survive status updates and subgraph navigation.
- Pan/zoom, direction changes, resize, inspector opening, and rapid drill-down keep controls aligned with nodes and preserve existing layout stability guarantees.
- Status/progress/frame updates leave the structural render generation unchanged. Stale asynchronous renders cannot attach controls to the wrong graph.
- Repeated enter/leave and rerender cycles do not accumulate Angular views, subscriptions, frame requests, or handlers.
- Existing hosts render as before with the new extension unused. Exercise both `GraphCanvasComponent` and `TaskGraphComponent` if the wrapper exposes the extension.
- Environment eligibility, pending/applied state, skip reasons, and parallel waits are understandable in the fixture. Run evidence remains associated with the captured environment.
- Use focused component tests for lifecycle/event behavior and the existing Playwright layout suite for camera/input/DOM regressions. Run library/demo builds and `npm run test:regression` when implementation is ready.

Record visible node count, number of mounted controls, frame rate, render count, and interaction latency on the test machine. Establish a baseline before choosing a performance budget; no capacity claim is made yet.

Exit with a demonstrated interaction, validation evidence, and a runbook decision on the content seam. Revisit this plan if LiteGraph's main advantage proves to be workflow authoring or navigation rather than inline controls.
