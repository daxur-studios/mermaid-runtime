# Node kinds: shape, chip and tone — options

Date: 2026-10-06. Status: In progress. Slices 1–3 are built (see [Decision](#decision-user-2026-10-06)); slices 4 and 6 are not.

Source: user feedback on the shapes slice ("the shapes are looking good, lets proceed"), the design review noted in [08 Outstanding requests](../runbook/08_outstanding-requests.md) (kind registry, group tones), and the shapes section there. Related: [11 Node progress and overlay fixes](11_node-progress-and-overlay-fixes.md).

## Decision (user, 2026-10-06)

The user found the options hard to follow, asked for mockups, then asked for a safe order. The mockups showed a database step as a poll-and-verify against a single call, told apart by icon, chip text, a stacked outline or a corner badge.

- **Option B** (a kind registry keyed on `node.type`) is built, with the defaults from the paper: `node.type` is the kind, and an icon is a Material icon name or a host SVG string.
- **Stacked outline for repeating steps: not wanted.** Dropped. Poll against single call is told apart by icon and chip.
- **Safe order, low-risk slices first:** (1) icon and chip in the label, (2) the registry, (3) tone. **Built.** (4) cylinder shape with ring, status colour and progress; (6) pre-made kinds with variants and a legend. **Not started.**
- Still open: whether the poll cue must read from far away (no longer matters now the stack is dropped), long-title clamping, and a legend.

Implementation record: [08 Outstanding requests](../runbook/08_outstanding-requests.md#kind-registry-icon-chip-and-tone-2026-10-06).

## Question

Readers want to tell kinds of step apart at a glance: a CLI call, an assertion, a SQL step, a Kafka step. Shapes now exist (`rect`, `rounded`, `diamond`, `subroutine`, `hexagon`, `parallelogram`), but a host has to map step kinds to them itself, one `NodeDecoration` per node. Where should that mapping live, and what else can a kind carry?

## What exists today (code-verified)

- `NodeDecoration` (`displayTitle`, `shape`, `badge`) is keyed by node id. The host builds it per node; the Large-flow lab does this with a `shapeByType` map in `work-e2e.page.ts`.
- `Node.type` is a free-text string the inspector shows. The library gives it no visual meaning.
- Status owns the node colours (`StatusStyleMap`). A kind must not fight it.

## A kind can carry up to three things (proposed)

| Cue | Meaning | Why it is separate |
| --- | --- | --- |
| **Shape** | The *intent* of a step: do, check, decide, call out | Readable from far away, survives zoom-out |
| **Chip** | The *tool* inside that intent: `psql`, `kafka`, `curl` | Text, so only readable up close |
| **Tone** | A small accent (left stripe or chip colour), not the fill | Status already owns fill and stroke |

## Options

### A — Host-side only: add `chip` and `tone` to `NodeDecoration`

The host keeps mapping kinds itself, as the lab does. The library only learns to draw a chip and an accent from the decoration.

- **Cost:** small. No new input.
- **Gives:** the smallest API change; nothing new to learn.
- **Gives up:** every host re-implements the same lookup. No shared legend. Group tones need their own decoration type.

### B — Kind registry keyed on `node.type`

New input `nodeKinds: Record<string, NodeKindStyle>` with `{ shape, chip?, tone?, label? }`. The library looks a node's `type` up in it. `NodeDecoration` still wins per node.

- **Cost:** medium. A resolver, a precedence rule (decoration, then kind, then default) and tests.
- **Gives:** one table per host. A legend can be generated from it. Group tones can reuse the same record.
- **Gives up:** it assumes `node.type` is the kind. If the tool lives in the command (`psql …`) the host has to set `type` first.

### C — Registry plus a resolver function

Same as B, plus an optional `kindOf: (node) => string` so a host can derive the kind from anything, such as the first word of the command.

- **Cost:** medium plus a little. One more input.
- **Gives:** fits hosts where the kind is not a stored field.
- **Gives up:** a function input cannot be serialised or snapshot-tested as easily as a table, and it runs on every render.

### D — Classes only

The library emits `mr-kind-<kind>` and `data-kind` on each node and takes only the shape from a small table. Colour and chip styling are the host's CSS.

- **Cost:** small.
- **Gives:** full styling freedom with design tokens.
- **Gives up:** hosts must write CSS for every kind, the chip text still needs a source, and e2e cannot assert the look without the host's CSS.

## Recommendation

**B, with C's resolver left as a later addition.** The table is the part every host repeats, and it also feeds a legend and group tones. The resolver can be added without breaking B. Tone should be an accent (stripe or chip), never the node fill, so status colours keep their meaning.

## Open questions (user)

1. Does each work-CLI step carry a stable tool id, or only a command line? This decides B against C.
2. Does the work app set its own `mermaidConfig`, font or CSS? Chips and stripes depend on it.
3. Do readers scan by kind of step (shape) or by tool (chip)? This sets which cue gets the loudest treatment.
4. Should long titles be clamped to a line count, or always shown in full?
5. Should a generated legend be part of the first slice?

## Not part of this paper

Stadium and cylinder (path-drawn shapes need ring, status colour and progress support) are tracked in [08](../runbook/08_outstanding-requests.md) and can be done before or after a registry.
