# Work-style demos

Date: 2026-10-05. Status: Done for the initial demo slice; user evaluation and performance profiling remain follow-up work.

Source: [User clarification and results](../runbook/04_work-style-demos.md), [context](../runbook/01_context-and-use-cases.md), [baseline](../runbook/02_repository-baseline.md). Related: [Roadmap](00_index.md), [later node-content experiment](01_interactive-e2e-slice.md).

## Goal

Give the user realistic pages to refresh their memory of the library and compare grouping, colours, right-click details, subgraph navigation, and responsiveness before selecting a larger change.

## Scope

- A synthetic trip-creation flow: preflight, local preparation, Kafka subscriptions, parameterized legacy UI action, parallel Kafka/SQL waits, public API/GUID capture, assertions, and cleanup.
- Compare compact subflows, expanded grouped steps, and ungrouped steps with stable identities.
- Local/shared-dev configuration, explicit skip reasons, a success/timeout scenario, run/pause/reset/advance controls, and inspector configuration/context.
- A separate large-flow route with 24, 120, and 240 underlying steps, configurable update cadence, and optional follow/pulses.
- Keep all external execution simulated and labelled. Do not add custom in-node Angular rendering or real telemetry in this slice.

## Acceptance

- Both routes are discoverable from demo navigation and documented with a walkthrough.
- Right-click opens actions for the correct step, and drill-down/back navigation works.
- Live status changes continue inside an open subflow without replacing its SVG.
- Shared-dev preparation is visibly skipped; timeout stops the synthetic run and leaves downstream work incomplete.
- Expanded 240-step data renders, and a status tick does not trigger a new structural render. This is a functional regression check, not a smoothness guarantee.
- Demo/library builds and relevant browser/regression checks pass; limitations and results are recorded in the runbook.

## Follow-up after review

Record which layout and interactions feel best, which fail to fit the screen, and where pan/zoom or updates feel slow. Capture visible node counts, selected view, cadence, browser, and machine details for performance work. Use those observations to revise the next plan rather than presuming rich nodes are the main missing feature.
