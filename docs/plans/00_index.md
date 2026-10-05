# Plans

Updated: 2026-10-05. Status: Draft roadmap, open to discussion.

Source: [Runbook index](../runbook/00_index.md), [user context](../runbook/01_context-and-use-cases.md), [code baseline](../runbook/02_repository-baseline.md), [proposed direction](../runbook/03_direction-and-open-questions.md).

| Order | Plan | Status | Exit condition |
| --- | --- | --- | --- |
| 1 | [Work-style demos](03_work-style-demos.md) | Done (initial slice) | Representative pages and regression checks are available; hands-on feedback is next |
| 2 | [Interactive E2E slice](01_interactive-e2e-slice.md) | Draft | A small representative run can be configured and inspected with stable, usable Angular node controls |
| 3 | [Activity and system views](02_activity-and-system-views.md) | Draft | Correlated observations drive understandable activity and a feature-scoped system view |

The immediate priority is the realistic demo requested in the [follow-up discussion](../runbook/04_work-style-demos.md). The user's hands-on feedback will determine whether inline controls, grouping/layout, navigation, or performance should come next. Document numbers stay stable; table order expresses priority.

## Sequencing

1. Try work-style demo pages and identify the first interaction to improve.
2. Validate node-content sizing, lifecycle, and input behavior with existing camera/layout machinery.
3. Exercise local/shared-dev eligibility, context inspection, subflows, and parallel waits in the demo.
4. Add explicit activity identities and deterministic event reduction; then animate evidence-backed traffic.
5. Reuse those identities for a feature-scoped dependency/health view.
6. Integrate an actual host, measure realistic workloads, and revisit API boundaries from evidence.

Telemetry inventory can happen alongside the node prototype, but implementation of both plans is not assumed to be parallel work. Each stage should leave a usable increment and a short runbook entry recording results.

## Deferred until evidence justifies them

- Full graphical workflow authoring, connection editing, and arbitrary saved manual positioning.
- An all-repositories canvas, automatic system discovery, or a replacement observability backend.
- Full interactive remote-browser embedding or a mandatory live-video transport.
- Replacing Mermaid or extracting a separate renderer engine before testing its extension limits.
- Breaking changes to existing host contracts.

These are discussion boundaries, not permanent exclusions.

## Option papers

These explore alternatives for a design question (3–4 options, a recommendation, open questions). The roadmap above records the implementation sequence; an option paper feeds a roadmap stage once an option is picked.

| Plan | Question | Feeds |
| --- | --- | --- |
| [04 Rich node content](04_rich-node-content-options.md) | SVG-only vs Angular in `foreignObject` vs scene-aligned Angular layer vs inspector-first | [Interactive E2E slice](01_interactive-e2e-slice.md) Stage A |
| [05 LiteGraph feel gap](05_litegraph-feel-gap.md) | Close gaps in Mermaid vs Mermaid-as-layout-only vs ELK layout vs split author/observe roles | Next step after [demo feedback](03_work-style-demos.md) |
| [06 Live observability](06_live-run-observability-options.md) | Step-graph activity vs system-map traffic vs live sequence diagram vs OTel-first; Playwright preview modes | [Activity and system views](02_activity-and-system-views.md) Stages A–B |
| [07 System visualisations](07_system-visualisation-options.md) | Feature-profile graph vs repo-harvested graph vs runtime-observed graph vs multi-diagram-type seam | [Activity and system views](02_activity-and-system-views.md) Stage C |
| [08 Group layout](08_group-layout-options.md) | Emit group direction vs grid wrap via invisible links vs group-to-group edges for chains vs another layout engine | **Next step**, user-reported #1 issue |
