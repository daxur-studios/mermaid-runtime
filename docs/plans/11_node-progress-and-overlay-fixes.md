# Node progress and overlay fixes

Date: 2026-10-05. Status: In progress. Items 1–4, 7 and 9 done, 8 partly ([implementation record](../runbook/07_progress-and-background-fixes.md)); 5 and 6 remain.

Source: user feedback on the Large-flow lab (session ledger, 2026-10-05). Related: [Multi-ring progress finding](../runbook/06_agent-setup-and-daemon-inventory.md#daemon-inventory-code-verified), [Canvas theme and background](10_canvas-theme-and-background-options.md), [Daemon extraction candidates](09_daemon-extraction-candidates.md).

This plan collects every progress and overlay issue found so far, so none get lost while plan 10 (theme) is built.

## Problems

| # | Problem | Source | Cause (code-verified) |
| --- | --- | --- | --- |
| 1 | The `NN%` text collides with edges and group titles ("Subscribe be100%re action") | User-reported, confirmed | `applyProgressTraceOverlay` places the text `PROGRESS_TEXT_GAP_PX` above the outermost ring's top edge, i.e. outside the node box, where edges and group titles also go |
| 2 | Finished nodes keep a full ring and look double-bordered | User-reported, confirmed | The ring is drawn whenever `progressPercent !== null`, whatever the status; the demo sets `100` on complete nodes |
| 3 | Mermaid's node tooltip ("View *title*") is unreadable in dark mode | User-reported, confirmed | Each node gets a `click … "View <title>"` line (`graph-canvas.component.ts`, near `NODE_HREF_PARAM`). Mermaid then appends a `div.mermaidTooltip` to `<body>` with inline `background: #ffffde`; the text colour is inherited from the host page, which is light in dark themes. The text also repeats the node title |
| 4 | A running node at 0% still shows a `0%` label | Seen in the user's screenshot | Same rule as 2: any non-null percent draws |
| 5 | The roll-up (overall %, label, running nodes' %) is computed only by the daemon backend (`deriveChildRunProgress`) | Code-verified | No library helper. The demo's subflows compute the overall % by hand (`work-demo-data.ts`: complete + skipped ÷ a hard-coded 4, failed not counted) and never set `activeChildNodeProgresses`, so the demo never shows the extra rings |
| 6 | `mr-graph-preview` (Kanban mini-flows) draws no progress | Code-verified | Not implemented |
| 7 | No host switch to show the overall ring without the running-node rings | Code-verified | Not implemented |
| 8 | Multi-ring progress isn't in the README | Code-verified | — |
| 9 | Unnamed numbers break our own standards | Code-verified | `NODE_PROGRESS_STACK_OFFSET_PX = 4` is declared inside the function without JSDoc, and the running-node ring opacity `0.5` is inline |

## Fixes

- **2, 4 — ring visibility.** Draw the ring only for a node that isn't settled (not `complete`, `failed` or `skipped`, so host-defined statuses still get it), and only once it is above 0%. Settled nodes show no ring; their status colour already says it. If a host wants the old behaviour, a `progressRing: 'running' | 'always'` input keeps it.
- **3 — tooltip.** Stop emitting the Mermaid tooltip text (the link still works). If hover text is still wanted, show the node title through the library's own themed element using `--mr-*` tokens, not Mermaid's body-level div.
- **5 — roll-up helper.** Export `computeSubgraphProgress(graph)` returning `{ progressPercent, progressLabel, activeChildNodeProgresses }`, with the daemon's rules (failed and skipped count as settled). Use it in the demo subflows, and later replace the daemon's copy. This replaces the item listed in [plan 09](09_daemon-extraction-candidates.md#independent-items-any-option).
- **6 — preview progress.** Covered by plan 09 option B (`showProgress`). Stays there.
- **7 — `childProgressRings` input** (default on).
- **8 — README section** with a subflow example.
- **9 — constants.** Move both to named module constants with JSDoc; expose ring opacity and gap as `--mr-progress-*` tokens so the plan 10 presets can style them.

## Label placement — options (for problem 1)

| Option | How | Gives up |
| --- | --- | --- |
| A — Inside the node, bottom-right | Small `64%` in the node's bottom-right corner, inside the border | Needs a little reserved space; may crowd short titles |
| B — On the ring | Text sits on the ring line at the ring's leading end, like a progress handle | Moves as progress grows; can be hard to read on small nodes |
| C — Label only on hover/selection | Ring always; number shown in the inspector or on hover | Can't read numbers at a glance across the graph |
| D — Below the node | Same as today but under the node | Still collides with edges leaving downward and with the next group in a grid |

**Recommendation: A.** It never leaves the node box, so it can't collide with anything, and the ring still shows progress from a distance. With running-node rings, show only the overall number (`64%`), and list the per-node numbers in the inspector rather than as `33% | 20% | 90%`.

**Built (2026-10-05): A, moved onto the border.** Measured in the Large-flow lab, text inside the box overlapped the end of the title by a few px, because Mermaid sizes nodes tightly around their label. The label became a small pill centred just below the bottom border near the right corner, mirroring the drill-down "+" badge at the top-right corner. Edges attach at side or top/bottom midpoints, so the corner stays free.

## Order

1. 2 + 4 (ring visibility) and 3 (tooltip): small, visible right away.
2. 1 (label placement, once picked) and 9 (constants).
3. 5, 7, 8 (roll-up helper, switch, README, demo).
4. 6 with plan 09 option B.

## Open questions

- ~~Label placement: A, B, C or D?~~ A, on the border (see above).
- Now that the tooltip is gone, should hover show anything (full title for truncated labels), or nothing? Nothing for now.
