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
| [08 Group layout](08_group-layout-options.md) | Emit group direction vs grid wrap via invisible links vs group-to-group edges for chains vs another layout engine | A + B done; C (connected chains) done: direction for connected groups, exact arrows between phases, `groupFlow` alternate/same. Wrapping of very long chains and skip-phase arrows later |
| [09 Daemon extraction](09_daemon-extraction-candidates.md) | Helpers vs smarter preview inputs vs run-card component vs recipe only, for the daemon's Kanban mini-flow glue | Waiting for the user's pick |
| [10 Canvas theme and background](10_canvas-theme-and-background-options.md) | Fix CSS layers + token presets vs SVG pattern layer with adaptive detail vs canvas/WebGL vs whole-look presets | B + D picked; neon dropped; hex/triangles parked; default look done (dots, midnight, adaptive levels); presets next |
| [11 Node progress and overlay fixes](11_node-progress-and-overlay-fixes.md) | Work list (ring visibility, tooltip, roll-up helper, constants) plus label placement inside vs on-ring vs hover-only vs below | In progress: rings, badge, tooltip, constants done; roll-up helper and preview progress next |
| [12 Node kinds](12_node-kind-registry-options.md) | Host-side chip and tone vs registry keyed on `node.type` vs registry plus resolver vs classes only, for shape, chip and tone per kind | In progress: B picked, stacked outline dropped; icon, chip, registry and tone built. Cylinder and pre-made kinds next |
| [14 Estate map](14_estate-map-options.md) | Feature launchpad vs sync-link map vs estate explorer vs agent-first graph with thin UI, for a ~500-repo Kafka estate | Waiting for the user's pick; recommendation A on D's graph JSON with B's sync-link edges |
| [15 Ideal estate model](15_ideal-estate-model.md) | Target data contract (components, links, features, health, environments) and an adoption ladder to compare real data against | Proposed; PoC built in the demo ([runbook 10](../runbook/10_estate-map-poc.md)); user checking it against work data |
| [13 Run banner, timing and far zoom](13_run-banner-timing-and-far-zoom-options.md) | Completed-state behaviour vs where times show vs what far zoom shows, plus the re-center prompt | Built: all picks taken (banner and pill, right-edge times, far text with override); unit 115/115, e2e 26/26 |
