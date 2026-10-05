# Agent standards

How we name things, comment code and use terms in this repo. Every agent reads this before editing code. Adapted from Daxur Daemon's `docs/agent-standards.md` on 2026-10-05, so both repos read the same way.

Related: [AGENTS.md](../AGENTS.md), [Angular standards](angular-standards.md).

## Core principles

- **Plain words first.** Use the terms below. Don't invent jargon. If you need a new term, add it to the table.
- **Purpose and value.** Every exported function, class, component and constant starts with a JSDoc saying why it exists and what it delivers.
- **No magic numbers.** Every number with a meaning gets a named constant with a JSDoc block above it, not a trailing `//` comment.
- **Clear intent.** Names say what something does and why, not just what it is.

## JSDoc template

```ts
/**
 * Short purpose (one sentence).
 *
 * VALUE: What this gives the host app, the user, or the rest of the library.
 */
```

Longer docs may split it into `PURPOSE:` and `VALUE:` paragraphs, as the existing components do. Explain non-obvious Mermaid or browser behaviour where you work around it, with the measured fact (for example "Mermaid places sibling clusters in reverse source order").

## Naming

| Kind | Style | Example |
| --- | --- | --- |
| Functions, methods | `verbNoun` | `chooseGroupsPerLine`, `measureGroupFootprints` |
| Types, interfaces | PascalCase, data types in `MermaidRuntime` | `MermaidRuntime.NodeGroup`, `GroupFootprint` |
| Constants | `UPPER_SNAKE_CASE`, unit suffix | `GROUP_ARRANGEMENT_GAP_PX`, `ARRANGEMENT_ASPECT_HYSTERESIS` |
| Files | kebab-case, Angular suffixes | `group-arrangement.utils.ts`, `graph-canvas.component.ts` |
| Selectors | `mr-` prefix | `mr-graph-canvas` |
| CSS custom properties | `--mr-*` for library-owned decoration; `--app-color-*` for status colours the host sets | `--mr-grid-dot`, `--app-color-pass` |

## No magic numbers

```ts
// BAD
if (Math.abs(next - prev) / prev > 0.3) rerender();

// GOOD
/** Viewport aspect change (fraction) that triggers re-packing groups; smaller changes keep the layout stable. */
export const ARRANGEMENT_ASPECT_HYSTERESIS = 0.3;
```

## Terms

These words are easy to mix up here. Use them exactly.

| Term | Meaning |
| --- | --- |
| **Host** | The app that uses the library (daemon, demo, a test page) |
| **Graph** | `MermaidRuntime.Graph`: nodes plus transitions (edges) for one view |
| **Group** | `MermaidRuntime.NodeGroup`: a labelled box around nodes **in the same view**. Rendered as a Mermaid `subgraph`, but it's not drill-down |
| **Subgraph (drill-down)** | `Node.subgraph` / `subgraphId`: a separate child graph you navigate **into**, replacing the view |
| **Independent group** | A group with no edges to nodes outside it (e.g. parallel trips). Only these are packed by `groupArrangement` |
| **Arrangement** | Where groups sit relative to each other (`groupArrangement`). Not the same as a group's internal `direction` |
| **Direction** | Flow of steps: `TD` (top-down) or `LR` (left to right) |
| **Structural render** | A full Mermaid re-render, after nodes, edges, groups, direction or arrangement change. Expensive |
| **Status update** | Recolouring existing nodes by toggling classes. Cheap, never re-renders |
| **Preview** | `mr-graph-preview`: a small read-only thumbnail (`simple` or `mermaid` mode), e.g. on kanban cards |
| **Camera** | `GraphCameraComponent`: the pan/zoom transform. "Fit" means framing the whole graph |
| **Decoration** | Per-node extras a host adds (badges, overlays) without changing the graph |

## Comments and docs

- Comment *why*, not what. Keep comments next to the code they explain.
- Public API changes go in the [README](../README.md) and the consumer guide (`.claude/agents/use-mermaid-runtime.md`).
- Findings, decisions and validation go in the [runbook](runbook/00_index.md), not in code comments.

Last updated: 2026-10-05.
