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
| [06 Agent setup and daemon inventory](06_agent-setup-and-daemon-inventory.md) | Synced agent instructions and standards; which daemon graph parts are in the library |
| [07 Progress and background fixes](07_progress-and-background-fixes.md) | Background zoom fade, progress rings only on unfinished nodes, `NN%` border badge, tooltip removed |
| [08 Outstanding requests](08_outstanding-requests.md) | Backlog from the lab review: zoomed-out node detail, centred reset, "back to graph" prompt, node shapes, custom HTML nodes, "run complete" banner, title centring |
| [Plan index](../plans/00_index.md) | Proposed sequence of work and acceptance criteria |

Two sessions drafted docs concurrently on 2026-10-05; they were merged into this single sequence the same day (the other session's kickoff/conventions drafts were folded into this index and [02 Repository baseline](02_repository-baseline.md); its option papers became plans 04–07).

## Working convention

Agents get these duties from [AGENTS.md](../../AGENTS.md#runbook-and-plans) (synced to every tool's instruction file); this section is the full version.

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
| 2026-10-05 | Set up synced agent instructions (`AGENTS.md` → Claude/Copilot/Codex, CI check) and Angular/agent standards; checked daemon Kanban mini-flows | [Setup, standards check, config-cache bug, daemon inventory](06_agent-setup-and-daemon-inventory.md) | Pick from [plan 09](../plans/09_daemon-extraction-candidates.md); fix config cache |
| 2026-10-05 | Checked multi-ring subgraph progress; user reported background dots flooding the canvas when zoomed out | Rings drawn by the library, roll-up daemon-only ([06](06_agent-setup-and-daemon-inventory.md#daemon-inventory-code-verified)); two background bugs found ([plan 10](../plans/10_canvas-theme-and-background-options.md#cause-code-verified)) | Pick from plan 10 |
| 2026-10-05 | User tried the theme preview; confirmed progress-text overlap, finished-node ring; reported dark-mode tooltip | [Plan 10 decision](../plans/10_canvas-theme-and-background-options.md#decision-user-2026-10-05): B + D, dots, neon dropped, hex/triangles parked. Progress and tooltip issues collected in [plan 11](../plans/11_node-progress-and-overlay-fixes.md) | Confirm default preset; pick label placement; start with plan 10 bug fixes and plan 11 ring/tooltip |
| 2026-10-05 | Moved `ensureMermaidConfigured` and its cache into one shared `mermaid-config.ts`; added A→B→A unit test | [Config-cache bug fixed; build, unit 12/12, e2e 12/12](06_agent-setup-and-daemon-inventory.md#fix-code-verified) | Pick from [plan 09](../plans/09_daemon-extraction-candidates.md) |
| 2026-10-05 | Fixed background flooding (zoom fade), rings on finished/0% nodes, `NN%` overlap (now a border badge), dark-mode tooltip, unnamed constants | [Changes and validation: build, unit 21/21, e2e 12/12, checked in the lab](07_progress-and-background-fixes.md) | User review in Large-flow lab; then plan 10 B + D or plan 11 roll-up helper |
| 2026-10-05 | User: the stopgap still showed neon dots and lines, not the agreed preview | [Default is now dots only, midnight colours, the preview's adaptive levels; unit 26/26, e2e 12/12](07_progress-and-background-fixes.md#correction-background-matches-the-agreed-preview-same-day) | User review; then presets (`blueprint`, `paper`, `material`) |
| 2026-10-05 | User: arrows cross group titles; asked for a background or blur. Mermaid draws titles under arrows, so option A picked: raise titles + pill | [Titles in a layer above arrows, with a tokenised pill; unit 31/31, e2e 13/13](07_progress-and-background-fixes.md#group-titles-above-arrows-same-day) | User review; then presets |
| 2026-10-05 | User: title pill is more readable; listed new requests (zoomed-out node detail, centred reset, "back to graph" prompt, shapes, custom HTML nodes, a "run complete" top banner); titles look off-centre | [Backlog recorded; titles measured 20–25 units left of centre, cause found](08_outstanding-requests.md) | Fix title centring; pick next item |
| 2026-10-06 | User: at work a long grouped process still renders as one column (plan 08 option C was never built) | [Chains measured, then corrected: an explicit group direction compacts connected chains 3–4× with real step arrows; wrapping only helps past ~15 phases; ELK ruled out](05_group-layout-spike.md#connected-chains-measured-2026-10-06) | Pick an option in [plan 08](../plans/08_group-layout-options.md#connected-chains-options-2026-10-06) |
| 2026-10-06 | User challenged the "Mermaid can't do it" finding; re-tested, found the real cause (group direction never set for connected groups) and built it | [Connected groups now compact in `'auto'`; build OK, unit 32/32, e2e 14/14](05_group-layout-spike.md#implementation-option-1-direction-for-connected-groups-2026-10-06). Arrows between phases still run border to border | Draw those arrows from the real steps (plan 08 option 2) |
| 2026-10-06 | User picked both looks, default alternating, with fan-out and fan-in covered | [Arrows between phases redrawn step to step; `groupFlow` `'alternate'`/`'same'`; unit 53/53, e2e 15/15](05_group-layout-spike.md#implementation-exact-arrows-between-phases-and-groupflow-2026-10-06) | User review of both looks in the Large-flow lab; decide elbow arrows everywhere, skip-phase arrows, wrapping long chains |
| 2026-10-06 | User reviewed shapes ("looking good") and asked to proceed | Rounded, hexagon and parallelogram built with exact rings and arrows; [unit 68/68, e2e 18/18](08_outstanding-requests.md#rounded-hexagon-and-parallelogram-shapes-2026-10-06). Kind-registry options written up as [plan 12](../plans/12_node-kind-registry-options.md) | Built slices 1–3 of plan 12 (next row) |
| 2026-10-06 | User: "do the low ones"; dropped the stacked outline | Icon, chip, `nodeKinds` registry and tone built; [unit 78/78, e2e 19/19, build OK](08_outstanding-requests.md#kind-registry-icon-chip-and-tone-2026-10-06). Not committed | Cylinder shape (path shapes), then pre-made kinds and a legend |
| 2026-10-07 | User: icons and shapes good, parked Material icons and the database shape; asked for a re-center prompt, a completed state, step and group times, and far-zoom text | [Plan 13](../plans/13_run-banner-timing-and-far-zoom-options.md) written; all recommendations picked and built: [banner, pill, `runSettled`, times, far text; unit 115/115, e2e 26/26, build OK](08_outstanding-requests.md#run-banner-step-times-and-far-zoom-text-2026-10-07). Not committed | Try it in the work app (needs pack and a go-ahead); then pre-made kinds and legend |

This is an evolving engineering runbook, not an operational procedure for executing or resetting an environment.
