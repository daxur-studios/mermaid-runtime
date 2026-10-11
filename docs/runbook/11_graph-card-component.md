# Graph card and list component

Date: 2026-10-10. Status: Built, not committed.

Source: User request ("can u create a re-usable component, for mermaid runtime cards? so when i have an array of data that uses mermaid runtime, we can render it as a list? where it has header image of the mini version? and customizable , so apps using the lib can display andmake it their own?"). Related: [Plan 16](../plans/16_graph-card-options.md), [Plan 09 (Daemon extraction candidates)](../plans/09_daemon-extraction-candidates.md), [Runbook 06](06_agent-setup-and-daemon-inventory.md).

## Request (user-reported)

1. Re-usable component for Mermaid Runtime cards.
2. Capable of rendering an array of data/graphs as a list or grid.
3. Card header features a mini version (preview or image).
4. Highly customizable so consumer apps can style it and make it their own.

## Before (code-verified)

- The library has `mr-graph-preview` (`GraphPreviewComponent`), rendering in `'simple'` or `'mermaid'` mode.
- Daxur Daemon builds its own card chrome (`KanbanTaskCardComponent`) with a mini-flow preview, status border, and progress bar, duplicating calculations (`toIdleGraph`, `nodeProgress`).
- No card or list component exists in the library. Hosts must build their own card wrappers from scratch.
- Baseline checks pass: library build clean, unit tests 123/123 pass.

## Implementation (Option A with Option D flexibility)

1. **`GraphCardComponent` (`<mr-graph-card>`)**:
   - Header area rendering either a live mini graph via `[graph]` using `GraphPreviewComponent` (default `'simple'` circular nodes, `'LR'` direction, matching Daxur Daemon's Kanban cards) or a static image via `[headerImageSrc]`.
   - Automatic progress bar derived from node completion statuses (`complete`, `done`, `skipped`), with override via `[progress]`.
   - Title and subtitle with text truncation.
   - Built-in status styling (`data-status`, `--mr-card-running`, `--mr-card-complete`, `--mr-card-failed`).
   - Rich projection slots:
     - `[header]` (complete header override)
     - `[header-actions]` (top-right overlay actions/icons)
     - `[badge]` (status/priority badge slot)
     - `[meta]` (metadata row: branch, timestamps, chips)
     - `[body]` (custom host payload)
     - `[actions]` (footer action buttons)
   - Layout orientations: `'vertical'` (default) and `'horizontal'` (banner on left, details on right for list views).
   - Selection state (`[selected]`) and smart click handling (ignores clicks originating on buttons, links, or inputs).

2. **`GraphCardListComponent` (`<mr-graph-card-list>`)**:
   - Responsive layout container supporting `[layout]="'grid' | 'list'"`.
   - Configurable grid columns: `'auto'` (responsive auto-fill based on `--mr-card-min-width`) or fixed numeric columns.
   - Built-in empty state handling (`[empty]="true"`, `emptyText`, and `[empty]` projection slot).

3. **Pure Helpers (`graph-card.utils.ts`)**:
   - `computeGraphProgress(graph)`: returns `{ total, done, running, failed, percent }`.
   - `resetGraphStatuses(graph, status?)`: deep-clones a graph with all node statuses reset to `'undone'` (or target status) for template/catalog views.

4. **Demo Page (`/cards`)**:
   - Demonstrates a live array of workflow cards with varied non-linear flow topologies:
     - Diamond (split & join routes)
     - Fan-out / Fan-in (worker pool to reducer)
     - CI Validation Matrix (5 parallel checks converging on release gate)
     - Pipeline with bypass / shortcut edges
     - Event Mesh (2 producers to 3 consumers)
     - Hierarchical Tree branching
     - Conditional branch & fallback
     - Random DAG with dynamic forward cross-links
   - Interactive controls: **`🎲 Randomize Flows`** button (rolls all cards to varied non-linear topologies and status mixes), quick preset buttons to test specific topologies, layout toggle (Grid vs List), columns selector (Auto, 2, 3, 4), preview mode toggle ('simple' vs 'mermaid'), live step advancement, empty state toggle, selection inspection.

5. **Theming Tokens**:
   - Defined on `:host` with fallback defaults: `--mr-card-bg`, `--mr-card-border`, `--mr-card-border-radius`, `--mr-card-header-bg`, `--mr-card-header-height` (56px), `--mr-card-header-width` (140px), `--mr-card-padding`, `--mr-card-title-color`, `--mr-card-subtitle-color`, `--mr-card-meta-color`, `--mr-card-hover-border`, `--mr-card-selected-border`, `--mr-card-selected-bg`, `--mr-card-progress-track-bg`, `--mr-card-progress-fill-color`, `--mr-card-list-gap`, `--mr-card-min-width`.
   - Documented in `README.md` and `.claude/agents/use-mermaid-runtime.md`.

## Validation

- `npm run test:unit`: 134/134 passed (11 new unit specs covering `computeGraphProgress`, `resetGraphStatuses`, `GraphCardComponent`, slots, click delegation, static image header, and `GraphCardListComponent`).
- `npm run build`: Angular library build succeeded with clean bundles.
- `npm run demo:build`: Demo application build succeeded with clean chunks.
- `npm run check:agent-instructions`: Agent instructions in sync across Codex, Claude, and Copilot.

## Limits

- Static image headers via `[headerImageSrc]` use standard CSS `object-fit: cover`; consumers providing arbitrary aspect ratios should size them appropriately.
- Cards in horizontal orientation hide the thin progress bar by default to keep the side-by-side row compact.
- Not committed.
