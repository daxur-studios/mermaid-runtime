# Work-style demos

Date: 2026-10-05. Status: Initial implementation and automated verification complete; awaiting hands-on feedback.

Source: User follow-up during the initial discussion. Related: [Demo plan](../plans/03_work-style-demos.md), [baseline](02_repository-baseline.md), [direction](03_direction-and-open-questions.md), [roadmap](../plans/00_index.md).

## Clarification

The user reports that LiteGraph is somewhat laggy and wants this library to stay smooth on large E2E flows. Potential advantages of the old UI include grouping that fits many steps on screen, node colours, right-click details, and subgraph navigation. They have not used this repository recently and requested work-like demo pages to refresh their memory and make feedback concrete.

Decision for this session: prioritize representative demos using existing library seams. Defer choosing a rich-node API until the user has tried them.

## Pages and walkthrough

Run `npm run demo` from the repository root, then open [Work E2E](http://localhost:4200/work-e2e) or [Large-flow lab](http://localhost:4200/large-flow).

1. Start with Work E2E in **Compact subflows**. Double-click a phase or select it and use **Open subflow**. Return with the breadcrumb or **Back to overview**.
2. Right-click a node and choose **View step details**. Inspect the step kind, status, description, synthetic progress, and context.
3. Compare **Grouped steps**, **All steps**, and **Compact subflows**, in both layout directions. Grouping labels phases but does not promise compact wrapping; subflows actually reduce visible node count.
4. Select **Shared dev** before starting. Local preparation is visibly skipped, with a reason. Reset to change environment, scenario, or parameters after a run starts.
5. Run or advance the simulation. Kafka and SQL waits run together; the synthetic trip number appears before the GUID. Try **SQL timeout** to stop at the failed wait and inspect the error.
6. Open Large-flow lab and choose 24, 120, or 240 total steps. Compare expanded views against compact subflows while adjusting update cadence, follow behavior, and pulses.

The large fixture repeats independent trip flows in parallel; it is one workload shape, not a model of every large E2E run. The context panel shows one sample trip. Configuration uses ordinary inspector controls; there are no custom controls inside Mermaid nodes yet.

## Implementation notes

- [Fixture](../../projects/demo/src/app/work-demo-data.ts): synthetic definitions and state with stable identities, local-only preparation, a parallel wait, and a timeout scenario.
- [Demo page](../../projects/demo/src/app/pages/work-e2e.page.ts): shared UI for two routes, timer cleanup, configuration locking, context capture, and right-click actions.
- [Browser checks](../../e2e/work-demo.spec.ts): subflow updates, shared-dev skips/context actions, larger grouped rendering, and failure/reset behavior.
- [Canvas](../../projects/mermaid-runtime/src/lib/graph-canvas/graph-canvas.component.ts): fixed open subgraphs retaining their entry-time data snapshot. The visible graph now resolves through the current host nodes/resolver while navigation and camera state remain intact. A browser regression reproduced the stale state before the change and passed afterward without a structural rerender.
- [Demo shell](../../projects/demo/src/app/app.scss): allow navigation/main content to shrink instead of creating horizontal page overflow in a narrow window.

No Kafka, SQL, API, or Playwright execution happens in these demos. Pulses reflect simulated execution state, not observed network traffic. Feature readiness is illustrative and no actual feature-profile resolver is implemented. Browser previews remain a later experiment.

## Verification

- Production library build: passed.
- Production demo build: passed, with Mermaid transitive CommonJS optimization warnings. Development build also passed.
- Existing Angular/Karma suite: 5 tests passed.
- Full Playwright suite: 11 tests passed (7 existing layout checks and 4 new scenario checks). The 240-step case verified rendering, status updates without a structural render, and return to compact subflows.
- Visually inspected the in-app preview at a narrow desktop-panel width and corrected horizontal overflow from the expanded demo navigation.

Validation used the underlying Angular/Playwright CLIs. Sandboxed loopback access prevented the normal browser-server setup from reaching the preview, so the browser suite used an elevated local server on port 4201 and a temporary configuration override. The default documented development port remains 4200; the temporary test config was removed after validation. A preview was left running at [Work E2E on port 4201](http://127.0.0.1:4201/work-e2e).

Functional checks and manual UX feedback serve different purposes: even a passing 240-node test cannot establish smooth large-flow interaction on the user's hardware. No throughput, frame-time budget, or maximum supported flow size is claimed.
