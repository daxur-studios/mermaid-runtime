# Context and use cases

Date: 2026-10-05. Status: User-reported context from the initial discussion; external implementations have not been inspected.

Related: [Index](00_index.md), [baseline](02_repository-baseline.md), [direction](03_direction-and-open-questions.md), [plans](../plans/00_index.md).

## Two existing consumers

1. A locally running AI system with long-running, multi-step processes.
2. A work E2E runner POC: JSON arrays of steps execute through a custom CLI with database, Kafka, .NET API, and parameterized Playwright capabilities.

The work environment spans roughly 500 repositories, hundreds of APIs and databases, microservices, legacy and newer systems, Angular applications, and legacy ASP applications. Information is synchronized between systems, including through intermediate/cache tables. A useful graph must help explain both the intended process and where work actually happened.

The E2E UI started with LiteGraph and later adopted Mermaid Runtime. Mermaid is preferred for its trust/familiarity and the desire to reduce reliance on additional graph tooling. The LiteGraph UI currently feels better, so the Mermaid version sees less use. The specific interaction gap is still unknown; this is not yet evidence that the layout engine needs replacing.

## Representative trip flow

Follow-up clarification: LiteGraph is itself somewhat laggy. Smooth operation on large E2E flows is a priority. Grouping to fit the screen, node colours, right-click details, and entering/leaving subgraphs may explain its current advantage, but the user wants realistic demo pages to refresh their memory before choosing changes. See [work-style demos](04_work-style-demos.md).

This is a conceptual scenario assembled from the discussion, not the actual work JSON schema or a verified execution order:

1. Select the target environment and feature profile; assert required prerequisites.
2. For an eligible local environment, run reusable database flush/seed preparation. Show these steps as skipped when targeting shared dev.
3. Establish Kafka subscriptions and confirm readiness before the action that may publish messages.
4. Run a parameterized Playwright script against the legacy UI to create a trip leg; capture its trip number into run context.
5. Wait for matching Kafka messages and poll SQL conditions, with parallel work where the runner permits it.
6. Discover downstream information such as the newer public GUID, and retain its relationship to the original trip number.
7. Assert expected outcomes from captured context and system state; inspect evidence on failure.

Reusable prerequisite flows may be included by multiple E2E definitions. Reuse of a definition and the identity of each execution of that definition must remain distinguishable in the viewer.

## Requirements to preserve

| Concern | Desired experience | Domain owner |
| --- | --- | --- |
| Parameters | Configure a Playwright step, potentially using real Angular Material controls inside its node | Host owns schema, values, and validation |
| Environment | Clearly show local/shared-dev selection, eligibility, skip reasons, and prerequisites | Runner enforces policy; viewer explains it |
| Context | Inspect captured values and where they came from, including trip-number-to-GUID correlation | Runner/context store |
| Concurrency | Show all running/waiting branches and understandable follow behavior | Runner defines execution; viewer presents it |
| Subflows | Reuse preparation flows and drill into their run instances | Host resolves definitions and instances |
| Assertions | Explain expected versus actual outcomes and environment preconditions | Runner evaluates assertions |
| Feature profiles | See which tables, APIs, and UIs a feature requires and whether they are available | Host resolves requirements and readiness |
| Activity | See observed Kafka traffic, SQL calls/polls, API endpoints, processing, and downstream calls | Host provides available telemetry |
| Browser preview | See a bounded, semi-live preview of a Playwright step and open larger evidence | Host captures and serves frames/artifacts |

A feature profile might require 20 tables, 10 APIs, and two UIs. It should support running the relevant subset locally instead of starting the entire system. The viewer should explain that selection; service provisioning remains outside this library.

## Related graph experiences

- **Execution:** what should run, what is running, what was skipped, and what failed.
- **Dependencies/topology:** services, APIs/endpoints, databases/tables, topics, and UIs with explicit relationship types.
- **Information flow:** how a business entity travels through systems, with evidence for observed transitions.
- **Health/readiness:** latest known availability and freshness for the selected environment and feature.

These views can share selection, navigation, rendering, and inspectors. They need different meanings for nodes, edges, and status. A service being healthy does not mean an E2E step completed, and a declared dependency does not prove traffic occurred.

## Success from the user's perspective

Operate a representative run comfortably in the Mermaid UI, understand parallel waits and failures, inspect captured evidence, and navigate from a step to the relevant system dependency without losing environment/run context. Broader system visualization should grow from that foundation.
