# Angular standards

**Applies to:** `projects/mermaid-runtime/` (the library) and `projects/demo/` (the demo app). Angular 20.

Adapted from Daxur Daemon's `docs/angular-standards.md` on 2026-10-05: rules 1–8 match it, so code moves between the two repos without rework. Rules 9–11 are specific to this library.

Use modern APIs for new code and for files you substantially edit. Don't migrate untouched legacy code in drive-by changes.

**Reference:** `projects/mermaid-runtime/src/lib/graph-preview/` (signal inputs, OnPush, separate files, CSS custom properties).

---

## Rule 1 — Built-in control flow

Use `@if`, `@for`, `@switch` and `@defer`. No new `*ngIf`, `*ngFor` or `*ngSwitch`. Every `@for` has a stable `track` (an id, not `$index` unless the list is static).

## Rule 2 — Signal `input()` and `output()`

Use `input()`, `input.required()`, `output()` and `model()`. No `@Input()`, `@Output()` or `EventEmitter` fields. Read inputs as functions: `graph()`.

## Rule 3 — Reactive forms

Use `FormControl` / `FormGroup` with `ReactiveFormsModule`. No new `ngModel`. (The demo's `work-e2e.page.html` still uses `ngModel`; migrate it when you change that page.)

## Rule 4 — Signals for state, and no Zone.js reliance

- Local state uses `signal()`, `computed()`, `set()` / `update()`. Never `mutate()`.
- **The library must work in zoneless hosts** (the daemon is zoneless; the demo still uses Zone.js). Drive updates through signals, `effect()`, `afterNextRender()` and explicit DOM work. Never rely on Zone.js dirty-checking after a `setTimeout`, `requestAnimationFrame` or Mermaid promise.
- Read signals you don't want as dependencies with `untracked()` inside effects.

## Rule 5 — `inject()` and cleanup

Use `inject()`, not constructor injection. Clean up with `DestroyRef` / `takeUntilDestroyed()`. Cancel pending `requestAnimationFrame`, `ResizeObserver` and `MutationObserver` work on destroy.

## Rule 6 — Components and files

- Standalone (the Angular 20 default; don't write `standalone: true`).
- **Separate `.ts`, `.html` and `.scss` files.** No inline `template` or `styles`. (Five older demo pages are inline; split them when you change them.)
- Library components use `ChangeDetectionStrategy.OnPush` and the `mr-` selector prefix.
- Host bindings go in the `host` object, not `@HostBinding` / `@HostListener`.
- Prefer `class` / `style` bindings over `ngClass` / `ngStyle`.

## Rule 7 — Templates

Call signals in templates (`{{ count() }}`). Keep logic in `computed()`, not in the template.

## Rule 8 — Forwarded content needs `ngProjectAs`

A nested `<ng-content select="[x]">` doesn't carry the `x` attribute itself. When a wrapper re-projects a selected slot, tag it, or the content is silently dropped:

```html
<ng-content select="[overlay]" ngProjectAs="[overlay]"></ng-content>
```

See `task-graph.component.html`.

---

## Rule 9 — Styling and theming (library)

- **The library defines no status colours.** Status colours come from host-set `--app-color-*` properties (`pass`, `fail`, `warn`, `active`, `idle`, each with a `-bg` variant), and chrome from Angular Material's `--mat-sys-*` tokens. See README → Theming.
- Library-owned chrome and decoration use `--mr-*` properties. Each is defined on the component's `:host` with a working default, usually mapped from Material (`--mr-outline: var(--mat-sys-outline-variant, #3a3f58)`), so the library renders correctly in a host without Material.
- A new custom property goes in the README's Theming section in the same change.
- Hosts restyle through custom properties and `statusStyles`, never by targeting internal class names. Component classes use BEM (`graph-canvas__viewport`); classes added into the Mermaid SVG or other shared DOM use the `mr-` prefix (`mr-node-decoration`).

## Rule 10 — Mermaid and the rendered SVG

- Mermaid's config is module-global: the last `mermaid.initialize()` wins for the whole app. Build configs with `buildMermaidRuntimeConfig` and apply them through the shared `ensureMermaidConfigured` in `mermaid-config.ts`, never a direct `initialize()` or a local copy of the cache.
- Structural renders go through the canvas pipeline: build source → offscreen sandbox → wait for layout to settle → swap in. Don't write into the visible SVG host directly.
- Status changes toggle classes on the existing SVG. Don't trigger a structural render for a status change.
- Measure rendered elements (cluster boxes, node sizes) only after the swap, and only on what you need. Cache results keyed by what actually changes the size.

## Rule 11 — Public API

- Export through `src/public-api.ts` only. Consumers never import sub-paths.
- New inputs get a JSDoc that says what they do and their default, and a safe default that keeps existing hosts' output unchanged, unless the change is agreed and recorded (see [AGENTS.md](../AGENTS.md#library-rules)).

---

## Checklist

- [ ] No new `*ngIf`, `*ngFor`, `*ngSwitch`, `ngModel`, `@Input` or `@Output`.
- [ ] `@for` has a stable `track`.
- [ ] Separate `.ts` / `.html` / `.scss`; library components are OnPush with an `mr-` selector.
- [ ] Nothing depends on Zone.js; async browser work is cleaned up on destroy.
- [ ] No hardcoded status colours; new `--mr-*` properties have a `:host` default and are in the README.
- [ ] Forwarded `<ng-content select>` slots have `ngProjectAs`.
- [ ] Public API changes are reflected in the README and the consumer guide, and the sync has been run.
