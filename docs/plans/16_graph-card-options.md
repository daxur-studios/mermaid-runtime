# Graph card and list component — options

Date: 2026-10-10. Status: Built, not committed (2026-10-10). Option A built with Option D standalone flexibility and Daxur Daemon Kanban style.

Source: User request ("create a re-usable component for mermaid runtime cards? so when i have an array of data that uses mermaid runtime, we can render it as a list? where it has header image of the mini version? and customizable, so apps using the lib can display and make it their own?"). Related: [Plan 09 (Daemon extraction candidates)](09_daemon-extraction-candidates.md#c--run-card-component), [Runbook 06 (Daemon inventory)](../runbook/06_agent-setup-and-daemon-inventory.md), [Runbook 11](../runbook/11_graph-card-component.md).

## Decision (user, 2026-10-10)

- **Architecture:** Option A (Integrated `<mr-graph-card>` with rich slots + `<mr-graph-card-list>` layout wrapper).
- **Header:** Support both live `<mr-graph-preview>` from `[graph]` and static image URLs (`[headerImageSrc]`).
- **Mini preview mode:** Default to `'simple'` mode (circular nodes with thick connecting arrows, matching Daxur Daemon's Kanban cards).


## Problem

Consumers (such as Daxur Daemon's Kanban board, an e2e test runner list, or an architecture catalogue) frequently render collections/arrays of graphs or runs as a list or grid of cards. Today:
- `mr-graph-preview` exists in the library, but every host must construct its own outer card chrome, calculate progress, style the header thumbnail area, and wire status borders.
- Daxur Daemon maintains its own `KanbanTaskCardComponent` and helper calculations (`toIdleGraph`, `nodeProgress`), and other hosts would have to reinvent identical wrappers.
- The user wants a reusable, highly customizable card component with a mini preview/image header that can be rendered over an array of data as a list or grid.

## Design questions

1. **Card structure & composability:** How much is baked in (title, preview, progress bar, status chip) versus projected in by the host?
2. **List container vs. standalone card:** Does the library provide `<mr-graph-card-list>` to manage grid/list layout, spacing and empty state, or only the individual `<mr-graph-card>` rendered with standard `@for`?
3. **Mini header source:** Does the header only render live `<mr-graph-preview>` from a `graph`, or also accept a static image URL / custom projected header template?

---

## Options

### Option A — Integrated `<mr-graph-card>` + `<mr-graph-card-list>` (Recommended)

A structured card component (`<mr-graph-card>`) and a responsive layout wrapper (`<mr-graph-card-list>`).

- **How:**
  - `<mr-graph-card>` inputs: `[graph]`, `[title]`, `[subtitle]`, `[status]`, `[progress]` (or auto-computed from graph nodes), `[previewMode]="'simple' | 'mermaid'"`, `[previewDirection]="'TD' | 'LR'"`, `[headerImageSrc]`, `[interactive]="true"`, `[selected]="false"`.
  - Built-in header area displays either the mini `<mr-graph-preview>` or an image (`headerImageSrc`), with an overlay slot for top-right status chips or actions.
  - Built-in body displays title, subtitle, progress bar, and status indicator, but provides clear projected slots:
    - `<ng-content select="[header-actions]">` (top right over preview)
    - `<ng-content select="[badge]">` (status badge override)
    - `<ng-content select="[meta]">` (e.g. runtime, date, tags)
    - `<ng-content select="[body]">` (custom host content below title)
    - `<ng-content select="[actions]">` (footer action buttons)
  - `<mr-graph-card-list>` inputs: `[layout]="'grid' | 'list'"`, `[columns]`, `[gap]`, with an `<ng-content select="[empty]">` slot when empty.
  - Consumers can use standard `@for (item of items; track item.id) { <mr-graph-card ...> }` inside `<mr-graph-card-list>` or in any custom layout.
  - Pure helpers exported: `computeGraphProgress(graph)` and `resetGraphStatuses(graph, status)`.
- **Cost:** Medium. 2 components (`mr-graph-card`, `mr-graph-card-list`), unit tests, demo page.
- **Gives:** Works out-of-the-box for common run/graph lists with zero boilerplate, while remaining 100% customizable via slots and CSS tokens (`--mr-card-*`).
- **Gives up:** Card layout follows a header + body + footer structure (though any slot can be customized or hidden).

---

### Option B — Granular compound primitives (`<mr-card>`, `<mr-card-preview>`, `<mr-card-header>`, etc.)

Material-style compound components that consumers piece together.

- **How:**
  - Export primitive building blocks:
    ```html
    <mr-card>
      <mr-card-preview [graph]="item.graph" mode="simple" />
      <mr-card-header>
        <mr-card-title>{{ item.name }}</mr-card-title>
        <mr-card-badge>{{ item.status }}</mr-card-badge>
      </mr-card-header>
      <mr-card-content>...</mr-card-content>
      <mr-card-actions>...</mr-card-actions>
    </mr-card>
    ```
- **Cost:** Medium–High. 5–6 subcomponents to export, document, and test.
- **Gives:** Maximum flexibility in arranging sub-elements in any DOM order.
- **Gives up:** High boilerplate for consumers who just want to display a list of graphs; no cohesive default look without configuring 5 tags per card.

---

### Option C — Data-driven `<mr-graph-card-list>` with template outlets

A container component that accepts the entire items array and iterates internally.

- **How:**
  ```html
  <mr-graph-card-list
    [items]="runs"
    [trackBy]="trackById"
    [previewMode]="'simple'"
    (cardClick)="onSelect($event)">
    <ng-template #header let-run>...</ng-template>
    <ng-template #extra let-run>...</ng-template>
    <ng-template #actions let-run>...</ng-template>
  </mr-graph-card-list>
  ```
- **Cost:** High. Requires managing generic item types `<T>`, custom trackBy, template outlets, selection state, and pagination/filtering integration.
- **Gives:** Single component call in consumer template.
- **Gives up:** Clunky typing with template context (`let-run`), harder to interleave custom non-card elements, less idiomatic in modern Angular where `@for` is preferred over collection-wrapper components.

---

### Option D — Standalone `<mr-graph-card>` only (no list component)

Provide only the card component; rely on standard CSS grid/flex and `@for` for lists.

- **How:**
  - Only `<mr-graph-card>` is added to the library.
  - Consumers write:
    ```html
    <div class="my-card-grid">
      @for (item of items; track item.id) {
        <mr-graph-card [graph]="item.graph" [title]="item.name" ...>
          <button actions>Inspect</button>
        </mr-graph-card>
      }
    </div>
    ```
- **Cost:** Small–Medium. Single component, clear scope.
- **Gives:** Minimal API surface, no opinions on list styling.
- **Gives up:** Every host must write its own responsive grid CSS, gap handling, and empty state.

---

## Theming & customization contract (for Option A & D)

Customizable via CSS custom properties on `:host` / parent container:
- `--mr-card-bg`: Card background (default: `var(--mat-sys-surface-container, #1e2235)`)
- `--mr-card-border`: Border styling (default: `1px solid var(--mat-sys-outline-variant, #2e344d)`)
- `--mr-card-border-radius`: Border radius (default: `10px`)
- `--mr-card-header-height`: Height of the mini preview/image header (default: `140px`)
- `--mr-card-header-bg`: Header area background (default: `var(--mat-sys-surface-container-low, #161926)`)
- `--mr-card-padding`: Padding of card body (default: `12px 16px`)
- Status colors naturally inherit host `--app-color-*` (`pass`, `fail`, `active`, `idle`, `warn`).

---

## Recommendation

**Option A (Integrated `<mr-graph-card>` + lightweight `<mr-graph-card-list>`)**:
1. `<mr-graph-card>` gives an out-of-the-box card with mini graph header, progress bar, status, and clean slots (`[header-actions]`, `[badge]`, `[meta]`, `[body]`, `[actions]`).
2. `<mr-graph-card-list>` provides an effortless responsive CSS grid/list layout and empty state, while consumers can still use `<mr-graph-card>` standalone in their own layouts if desired.
3. Pure helpers `computeGraphProgress` and `resetGraphStatuses` are exported to address the duplication noted in Plan 09.

## Open questions for user

1. Should the card header support both a live Mermaid preview (`[graph]`) and an optional static image URL (`[headerImageSrc]`)?
2. Is the mini preview in the card default to `'simple'` (cheap circle nodes) or `'mermaid'` (detailed full layout)?
3. Does your list view need card selection / active state highlighting (e.g. `[selected]="true"`)?
