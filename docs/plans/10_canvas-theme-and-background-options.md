# Canvas theme and background — options

Date: 2026-10-05. Status: Ready (B + D picked; see [Decision](#decision-user-2026-10-05)). Bug fixes 1 and 2 shipped, then corrected the same day to the agreed default: dots only, midnight colours, the preview's adaptive levels ([record](../runbook/07_progress-and-background-fixes.md#correction-background-matches-the-agreed-preview-same-day)). Still CSS gradients, not an SVG layer; presets, `cross` and whole-look tokens not started.

Source: user feedback with screenshots of the Large-flow lab (session ledger, 2026-10-05). Related: [Group layout spike](../runbook/05_group-layout-spike.md), [Angular standards rule 9](../angular-standards.md), [Node progress and overlay fixes](11_node-progress-and-overlay-fixes.md).

## Decision (user, 2026-10-05)

The user tried an interactive preview of the options (presets × patterns × zoom, with a "current behaviour" toggle) and picked:

- **B + D.** SVG pattern layer with adaptive detail, plus whole-look presets.
- **Presets:** `midnight`, `blueprint`, `paper`, `material`. **`neon` dropped.** `material` was called out as a very good fit (for the daemon).
- **Default pattern: dots.** Grid and cross also ship.
- **Hex and triangles parked** for later. In the preview the triangle pattern slid relative to the canvas while zooming, while the others stayed anchored. Whenever they're added, every pattern must be anchored in world coordinates (scaled and panned by the camera transform) and have an e2e check that a world point stays on the same pattern cell across zoom levels.
- The progress-text overlap and the ring on finished nodes are confirmed; they moved to [plan 11](11_node-progress-and-overlay-fixes.md), together with the dark-mode tooltip.

Proposed (not yet confirmed): the library default is `midnight`, because it works with no host setup; `material` reads `--mat-sys-*` and falls back to `midnight` values where those are missing; the daemon sets `theme="material"`.

## Feedback (user-reported)

- Zoomed out, the dots take over: the whole canvas turns the dot colour.
- The overall look doesn't feel good. The user wants a few presets, easy customisation, and CSS variables. Grids and dots are liked; hex or triangles are worth considering.

## Cause (code-verified)

In `graph-canvas.component.scss` / `.html`:

1. **Density.** Pattern spacing is `30px × zoom`, but the dot radius is a fixed `1.6px` on screen. At 10% zoom the dots are 3 px apart and 3.2 px wide, so they cover the canvas.
2. **The zoom fade never runs.** `--mr-grid-dot-opacity: var(--app-graph-grid-dot-opacity, var(--small-dot-opacity, 0.36))` is declared on `:host`. `--small-dot-opacity` is set on the child viewport element, and a custom property's `var()` is resolved where it's declared, so the value is always `0.36`. The same applies to `--large-grid-opacity`. Hosts that set `--app-graph-grid-*-opacity` (the daemon sets `0.1`) also turn the fade off by design.
3. **Neon defaults.** The fallback colours `#00f0ff` dots and `#8b5cf6` lines are saturated accents. They compete with the status colours.

These are rendering bugs whichever option below is picked.

**Also seen in the screenshot:**
- The progress text (`100%`) sits above each node, so it overlaps edges and group titles.
- Finished nodes keep a full ring, so they look double-bordered.

See the [multi-ring progress finding](../runbook/06_agent-setup-and-daemon-inventory.md#daemon-inventory-code-verified).

## Options

### A — Fix in place, add presets as token sets

Keep the CSS-gradient layers and `backgroundEffect`.
- Fix the fade by setting `--small-dot-opacity` / `--large-grid-opacity` on the element that uses them.
- Scale the dot radius with zoom, and drop the fine layer once its spacing is under about 12 px.
- Add `theme` presets as `[data-mr-theme]` token blocks.

- **Cost:** small.
- **Gives:** the existing API and tokens keep working; presets arrive fast.
- **Gives up:** no hex or triangles, since CSS gradients can't draw them cleanly. Level of detail is limited to fading out one fixed fine layer.

### B — Pattern layer with adaptive detail (recommended)

Replace the gradients with one SVG `<pattern>` layer that the camera transform positions.

- **Patterns:** `dots`, `grid`, `cross` (+ at intersections), `hex`, `triangles`, `none`, plus a `custom` slot.
- **Adaptive detail:** on-screen spacing stays at least `--mr-pattern-min-gap` (about 12 px). When it would get tighter, the pattern crossfades to every Nth line (`--mr-pattern-major-every`), the way infinite canvases such as Figma behave. Density and contrast stay the same at any zoom.
- **Presets:** `theme` input or `data-mr-theme`: `midnight` (default dark, neutral ink), `blueprint`, `paper` (light), `neon` (today's colours, toned down), `material` (everything from `--mat-sys-*`, for hosts like the daemon).
- **Pattern colour** is mixed toward the surface (`color-mix(... var(--mr-pattern-ink) N%, var(--mr-surface))`), so it can't overpower the graph.
- **Compatibility:** the old `--app-graph-grid-*` tokens map onto the new ones; `backgroundEffect` keeps its values and gains `cross | hex | triangles`.

- **Cost:** medium. One new layer component, token mapping, demo page with preset and pattern pickers, an e2e check that background coverage stays under a limit at 10% zoom.
- **Gives:** every pattern the user mentioned, correct at all zoom levels, and presets a host can copy and tweak.
- **Gives up:** a little more DOM than gradients (one SVG with one pattern element), negligible next to the graph itself.

### C — Canvas or WebGL background

Draw the background with a 2D canvas or a small shader.

- **Cost:** high (resize/DPR handling, redraw on every camera move, testing).
- **Gives:** effects such as ripples spreading from running nodes, glow fields, animated activity.
- **Gives up:** CSS-variable theming becomes JS-read tokens; harder for hosts to customise; overkill for a static pattern.

### D — Look presets beyond the background

Orthogonal to A–C. A preset sets the whole look: surface, pattern, node fill and border, edge colour and width, group fill and title, progress ring style, and fonts. This is what produces the "nice feel"; the pattern alone won't.

- **Cost:** small–medium on top of A or B; mostly tokens plus a review of node, edge and group styles.
- **Gives:** a coherent look per preset; hosts pick one and override a few tokens.
- **Gives up:** more tokens to document; needs a token naming pass (`--mr-node-*`, `--mr-edge-*`, `--mr-group-*`).

## Recommendation

**B + D, with dots as the default pattern under `midnight`.**
- **Dots:** they read as "canvas" with the least noise.
- **Grid:** suits `blueprint`.
- **Cross:** a quieter grid.
- **Hex and triangles:** offer them, but not as defaults. Their diagonal lines fight the rectangles and straight edges of a Mermaid flow, and they get tiring behind dense graphs.

Ship the two rendering bug fixes first, since they are small and help the daemon today. The progress-text overlap and finished-node ring are tracked in [plan 11](11_node-progress-and-overlay-fixes.md).

## Sketch

```html
<mr-task-graph theme="midnight" backgroundEffect="dots" />
```

```css
mr-task-graph {
  --mr-surface: #14161b;
  --mr-pattern-ink: #8a94a8;
  --mr-pattern-opacity: 0.22;        /* fine layer */
  --mr-pattern-major-opacity: 0.38;  /* every Nth */
  --mr-pattern-size: 24px;           /* world units */
  --mr-pattern-major-every: 4;
  --mr-pattern-min-gap: 12px;        /* screen px before switching level */
}
```

## Open questions

- Confirm the default: `midnight` as library default and `material` for the daemon (proposed above)?
- ~~Should the daemon move to `material`?~~ Leaning yes (see Decision).
- ~~Is `neon` worth keeping?~~ Dropped.
- Should a preset also change node shapes and corner radius, or only colours?
