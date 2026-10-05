# Mermaid Runtime runbook

Started: 2026-10-05. Purpose: retain compact context, findings, decisions, and evidence as the library evolves.

## Read next

| Document | Purpose |
| --- | --- |
| [01 Context and use cases](01_context-and-use-cases.md) | The systems this library needs to serve; user-reported requirements |
| [02 Repository baseline](02_repository-baseline.md) | What the code supports today and the gaps we observed |
| [03 Direction and open questions](03_direction-and-open-questions.md) | Initial proposals, tradeoffs, and unresolved decisions |
| [04 Work-style demos](04_work-style-demos.md) | User clarification, demo walkthrough, and implementation evidence |
| [05 Group layout spike](05_group-layout-spike.md) | Why groups render as one long strip; measured Mermaid source variants that fix it |
| [Plan index](../plans/00_index.md) | Proposed sequence of work and acceptance criteria |

Two sessions drafted docs concurrently on 2026-10-05; they were merged into this single sequence the same day (the other session's kickoff/conventions drafts were folded into this index and [02 Repository baseline](02_repository-baseline.md); its option papers became plans 04–07).

## Working convention

- Use `NN_short-name.md`, starting at `00`, independently in each directory. Keep existing filenames stable when linking to them.
- Runbook entries record what was discussed, discovered, tried, or decided. Plans describe work still to do.
- Each new entry includes a date, status, and links to its source discussion or runbook entry and related plan. Links back to the relevant runbook belong in every plan.
- Distinguish **user-reported**, **code-verified**, **proposed**, and **open**. A proposal is not an accepted decision or a supported API.
- **Option papers** (plans that explore a design question rather than schedule work) present 3–4 genuinely different options, each with how / cost / what it gives up, then one recommendation and open questions. Don't collapse to a single refined path before the user picks.
- Update the indexes when adding documents. When a decision changes, link to its replacement and retain a short explanation.
- On implementation, record the actual change, validation, limitations, and commit/PR if available. Update plan status from `Draft` to `Ready`, `In progress`, `Done`, or `Deferred` as appropriate; do not mark work done from documentation alone.
- Keep work examples synthetic or anonymized. Link to host contracts when available rather than copying an entire external system into these docs.

## Session ledger

| Date | Work | Outcome | Next |
| --- | --- | --- | --- |
| 2026-10-05 | Captured initial discussion and inspected repository at `41f7844` | Context, code baseline, and draft plans created | Gather concrete UX feedback |
| 2026-10-05 | User clarified grouping, navigation, and smooth large-flow interaction; requested realistic demos | [Two demos, a live-subgraph fix, and passing checks](04_work-style-demos.md) | Try the demo pages, then choose the next library improvement |
| 2026-10-05 | Merged two concurrently drafted doc sets into one numbering | Kickoff/conventions folded into this index and [02](02_repository-baseline.md); option papers renumbered to [plans 04–07](../plans/00_index.md#option-papers) | Use the option papers when picking the next step after demo feedback |
| 2026-10-05 | User tried Large-flow lab: #1 issue is groups laid out in one long strip | [Cause found and fixes measured](05_group-layout-spike.md) | Pick an option in [plan 08](../plans/08_group-layout-options.md) |
| 2026-10-05 | Implemented automatic packing of independent groups; fixed two camera-fit bugs | [Results and validation](05_group-layout-spike.md#implementation-same-day) | User review in Large-flow lab, then compact connected chains (plan 08 C) |

This is an evolving engineering runbook, not an operational procedure for executing or resetting an environment.
