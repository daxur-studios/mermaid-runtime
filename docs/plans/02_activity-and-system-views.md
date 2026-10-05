# Activity and system views

Date: 2026-10-05. Status: Draft; not implemented. Depends on validating identities and host data, not on completing every rich-node feature.

Source: [Context](../runbook/01_context-and-use-cases.md), [baseline gaps](../runbook/02_repository-baseline.md), [direction](../runbook/03_direction-and-open-questions.md). Related: [Roadmap](00_index.md), [interactive E2E slice](01_interactive-e2e-slice.md).

## Outcome

Explain what happened during a run and where it happened in the system. Start with one feature and a synthetic correlated event stream. Add real sources only where the host can supply evidence.

## Stage A: identity and event contract

Inventory actual runner/CLI events before designing a public API. Distinguish orchestration events from lower-level observations. A Playwright step alone cannot reveal every downstream API, database, or Kafka operation.

Candidate information to preserve in a host adapter:

| Concept | Information to resolve |
| --- | --- |
| Scope | Run ID, environment, graph path, step instance, attempt |
| Definition versus instance | Reusable definition ID/version and unique invocation identity |
| Relation | Stable relation ID, endpoint identities, kind; multiple relations may share endpoints |
| Observation | Event ID, source, occurrence and receipt times, ordering/cursor information |
| Correlation | Available trace/span IDs, message/correlation IDs, business identifiers and explicit mappings |
| Evidence | Outcome, duration/count, bounded summary, refs to details/artifacts |
| Availability | Source connection/freshness, gaps, and whether evidence is recorded or inferred |

These are semantic requirements, not a proposed mandatory payload. Keep large contents and credentials out of graph events. Introduce additive types/adapters where possible; retain legacy replay support rather than silently changing its edge-ID interpretation.

Choose an ordering policy explicitly. Prefer a host-assigned sequence for a run if available; otherwise retain per-source order and correlation without inventing a total causal order from wall-clock timestamps. Deduplicate by event identity, isolate retries by attempt, and define how snapshots/checkpoints and later events reconcile.

The same deterministic reducer should support live display and recorded replay. Reconnecting must recover from a cursor/checkpoint or show an explicit gap. Bounded UI buffers can aggregate traffic; the host owns durable history. User selection and camera state must not be overwritten by replay state reduction.

## Stage B: observed activity

| Observation | Proposed display | Limit |
| --- | --- | --- |
| API request/processing/response | Highlight endpoint relation, outcome, duration, in-flight count | Only distinguish these phases if reported |
| Kafka publish/receive | Separate observations linked by available message/correlation evidence | Publish alone does not prove consumption; subscription readiness is its own state |
| SQL query or poll | Read/write/poll activity and latest matched condition | A poll is not proof that the upstream synchronizer ran |
| Business identifier discovered | Link trip number and GUID to producing step/evidence | Do not infer identity equality from similar text |

Add stable edge identities before implementing per-relation animation. The current status-driven pulse can remain execution feedback, but needs clear semantics alongside observed traffic. Use bounded pulses, counters, and aggregation under load rather than one persistent particle per message. Support reduced motion and inspection of the underlying events.

Start with runner/CLI-visible operations. Service-side instrumentation is a host integration prerequisite for displaying hidden downstream calls. If unavailable, show known boundaries and unknown interiors.

## Stage C: feature-scoped topology and health

Build a small system view from host-supplied entities: UI, service, endpoint, database, table, topic. Type relations explicitly: calls, publishes, consumes, reads, writes, synchronizes, and requires. Distinguish declared topology from observed relationships and retain provenance.

Map one feature profile to required resources. Resolve local, remote/shared, missing, disabled, or unknown availability in the selected environment; do not equate "not running locally" with "unavailable". Expose missing prerequisites and the host's reason for each readiness result.

Keep health separate from execution status and give it an observation timestamp/expiry policy. Unknown or stale data must be visible. A healthy API alone does not prove the relevant feature or database tables are ready.

Start collapsed at a useful service/domain level; expand endpoints/tables on demand. Add filtering by environment, feature, resource kind, selected step, and correlated entity. Cross-selection between execution and topology preserves run context. Do not require a giant combined graph to answer a focused question.

## Acceptance and validation

- Two Kafka events or API relations with identical endpoint pairs remain separately identifiable.
- A Kafka message arriving before the explicit wait step is retained by the host subscription and can be correlated when the wait is displayed.
- Parallel steps, repeated subflows, retries, duplicate deliveries, late events, reconnects, and missing correlation are represented without overwriting unrelated instances.
- Replay to a recorded checkpoint yields the same run/activity state as live reduction of the same canonical history. Seeking backward removes later evidence from the historical view.
- No observation is animated as completed delivery unless the available source establishes it; simulated fixture data is labelled as such.
- Telemetry and health refreshes do not rebuild layout unless graph structure actually changes. Bursts are bounded/coalesced with retained counts and visible history-gap indicators where applicable.
- A feature view explains required tables/APIs/UIs and their environment-specific readiness; missing data is shown as unknown.
- Unit tests exercise reducer ordering/deduplication/attempt handling. Browser tests cover relation selection, bounded animation, filtering, and drill-down. Measure representative fixture sizes before defining supported capacity.

Exit with a synthetic demo and one real host-source integration when available, documenting coverage and blind spots. No complete distributed observability claim is made from runner events alone.
