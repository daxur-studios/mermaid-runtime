# Progress and background fixes

Date: 2026-10-05. Status: Done, not committed.

Source: user go-ahead after [plan 10's decision](../plans/10_canvas-theme-and-background-options.md#decision-user-2026-10-05) and [plan 11](../plans/11_node-progress-and-overlay-fixes.md). Related: [Multi-ring progress finding](06_agent-setup-and-daemon-inventory.md#daemon-inventory-code-verified).

## What changed

| Problem | Change | Where |
| --- | --- | --- |
| Background dots flood the canvas when zoomed out | Each layer gets a zoom fade (0–1) from its on-screen spacing: hidden at 8 px, full at 18 px. The fade multiplies the base opacity, so hosts' `--app-graph-grid-*-opacity` still fade. Spacing is read from the resolved `--mr-grid-*-size` tokens, so host sizes fade at the right zoom | `graph-canvas.component.ts` (`computeBackgroundLayerFade`, `smallLayerFade`, `largeLayerFade`), `.html`, `.scss` |
| Zoom fade never ran | The faded opacities are declared on the viewport element, where the fade variables are set, instead of on `:host` | `graph-canvas.component.scss` |
| Finished nodes double-bordered; `0%` labels | New pure `selectVisibleNodeProgress`: no rings on `complete`/`failed`/`skipped` nodes or at 0%. New inputs `progressRings` (`'active'` default, `'always'`) and `childProgressRings` (default `true`) on `mr-task-graph` and `mr-graph-canvas`. Status is now part of the progress re-render key | `node-progress.utils.ts`, `task-graph-model.ts` (`ProgressRingVisibility`), both components |
| `NN%` overlapped edges and group titles | A small pill badge on the node's bottom-right border (diamonds: lower-right side), placed by pure `computeProgressBadgeBox`. Shows only the overall %; the `a% \| b% \| c%` text is gone (child rings still draw). It now also carries the step time (`42% · 1m 05s`), drawn by `applyNodeReadout` | `node-progress.utils.ts`, `applyProgressTraceOverlay`, `.scss` |
| Tooltip unreadable in dark mode | No tooltip text in the Mermaid `click` line, so Mermaid's light-yellow body-level tooltip never shows | `buildNodeClickLine` |
| Unnamed numbers | `NODE_PROGRESS_STACK_OFFSET_PX` is a documented module constant; child-ring opacity is the `--mr-progress-child-ring-opacity` token via the `mr-node-progress-trace--child` class | `graph-canvas.component.ts`, `.scss` |

New tokens: `--mr-progress-child-ring-opacity`, `--mr-progress-badge-fill`, `--mr-progress-badge-stroke`, `--mr-progress-badge-text`, `--mr-progress-badge-font-size`. README and the consumer agent guide document the inputs and tokens.

## Validation

- `npm run build`: OK. `npm run test:unit`: 21 passed, including 9 new `node-progress.utils` specs.
- `npx playwright test`: 12 passed.
- Large-flow lab, by hand plus DOM checks:
  - while running, 5 nodes had badges and none overlapped its title text;
  - finished nodes had no ring or badge;
  - the tooltip element stayed empty and invisible on hover;
  - at 14% zoom, the fine-dot fade was 0 and the coarse layer was 0.91, so the canvas no longer floods.

## Correction: background matches the agreed preview (same day)

**User-reported:** the stopgap still showed neon dots *and* grid lines (`grid-dots` was the default). The agreed look was the one in the preview: dots only, neutral colours, adaptive detail.

| Change | Where |
| --- | --- |
| `backgroundEffect` default is `'dots'` (both components) | `graph-canvas.component.ts`, `task-graph.component.ts` |
| Adaptive detail from the preview: pure `computeBackgroundPatternLevels`. The fine level is the densest one at least 12 px apart on screen and fades in up to 30 px; the coarse level (every 4th point, drawn over it, so those points read brighter) is fully on exactly when the fine level is gone, so levels swap without a jump. Spacing never drops below 12 px at any zoom | `background-pattern.utils.ts` (+ 5 specs) |
| Midnight colours: ink `#8a94a8` at 0.22, dot radius 1.6 px, 24 px world spacing; surface fallback `#14161b` | `graph-canvas.component.scss` |
| Dots are centred on lattice points (half-tile offset), the same points grid lines cross, so every level stays anchored to the graph while zooming | `.scss` |
| New tokens `--mr-pattern-ink`, `-opacity`, `-size`, `-dot-radius`, `-line-width`; the old `--app-*graph-grid-*` tokens still apply when unset. Old `--mr-grid-*` internals and the 8/18 px fade replaced | `.scss`, `graph-canvas.component.ts` |

Validation: build OK; unit 26/26; e2e 12/12. Lab: no grid lines; at 17% zoom spacing is 16 px (fine level fading, coarse level on), at 43% it is 41 px, at 74% it is 18 px; no flooding.

## Group titles above arrows (same day)

**User-reported:** with the corrected background, arrows entering a group ran across its title ("Trip 5 / Parallel synchronization"). Asked whether a label background or a 5 px backdrop blur would help.

**Code-verified cause:** Mermaid paints each `g.root` as `clusters` → `edgePaths` → `edgeLabels` → `nodes`, and the title lives inside its cluster. Any background or blur on the title is still under the arrows. The user picked option A: raise the titles, then add a pill.

| Change | Where |
| --- | --- |
| New `raiseGroupLabels`: moves each `g.cluster-label` into a `g.mr-group-labels` layer inserted before `nodes` (above arrows and edge labels, below nodes), folds old ancestor transforms into the label, tags it `data-mr-group-label-for`, and draws a padded `rect.mr-group-label-backdrop` behind the measured text. Runs in the hidden render sandbox before the swap, so the visible graph never shows the old order and the MutationObserver sees one swap | `group-label.utils.ts` (+ 5 specs), `graph-canvas.component.ts` |
| Pill style with tokens `--mr-group-label-fill` (surface), `-fill-opacity` (0.9), `-stroke` (outline), `-radius` (6px) | `graph-canvas.component.scss`, README "Node groups" |
| Group-order e2e reads titles via `data-mr-group-label-for`; new e2e checks every title is in its cluster's root, after `edgePaths`, with the pill | `e2e/group-arrangement.spec.ts` |

Validation: build OK; unit 31/31; e2e 13/13. Large-flow lab, "Grouped steps", top to bottom: the arrows into "Parallel synchronization" pass behind the pill and the title reads cleanly.

Not done: no blur (it costs paint time on large graphs and adds little on a dark canvas; a host can add `backdrop-filter` later only if titles move to HTML). Padding is fixed (8 × 2 px constants), not a token. Subgraph preview thumbnails keep Mermaid's order.

## Limits

- Presets (`blueprint`, `paper`, `material`), the `cross` pattern and the whole-look tokens are still plan 10 B + D. Midnight is only the default token values.
- The daemon sets its own `--app-color-graph-grid-dot` and `--app-graph-grid-dot-opacity: 0.1`, so it keeps its dimmer dots until it drops those tokens or moves to `material`.
- `grid-dots` draws lines on the coarse level only, so its lines swap level abruptly; `dots` and `grid` are seamless.
- The badge width is estimated from character count (no text measuring, to avoid a layout per tick). It is tuned for the default 9 px font; a much larger `--mr-progress-badge-font-size` needs a wider pill.
- Behaviour change for hosts: finished nodes no longer show a 100% ring. `progressRings="always"` restores it.
- Not done from plan 11: roll-up helper and demo child rings (item 5), preview progress (item 6), README subflow example (item 8).
