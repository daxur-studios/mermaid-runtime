const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * CSS class of the layer that holds raised group labels, one per Mermaid `g.root`.
 *
 * VALUE: Lets the canvas's MutationObserver ignore label moves, and gives
 * hosts and tests one stable selector for every group title.
 */
export const GROUP_LABEL_LAYER_CLASS = "mr-group-labels";

/** CSS class of the pill drawn behind each raised group label (see graph-canvas.component.scss). */
export const GROUP_LABEL_BACKDROP_CLASS = "mr-group-label-backdrop";

/**
 * Attribute on a raised label naming the `id` of the `g.cluster` it came from.
 *
 * VALUE: The label no longer sits inside its cluster, so this is how a host
 * or test finds which group a title belongs to.
 */
export const GROUP_LABEL_FOR_ATTRIBUTE = "data-mr-group-label-for";

/**
 * Horizontal space between a group title's text and the edge of its pill, in scene px.
 *
 * VALUE: Enough room that an arrow passing behind the pill stops clearly
 * short of the first and last letter.
 */
const GROUP_LABEL_PADDING_X_PX = 8;

/** Vertical space between a group title's text and the edge of its pill, in scene px. */
const GROUP_LABEL_PADDING_Y_PX = 2;

/**
 * Moves every group (cluster) title in a rendered Mermaid flowchart into a
 * layer drawn above the arrows, and puts a pill behind each one.
 *
 * Mermaid paints each `g.root` in the order `clusters` → `edgePaths` →
 * `edgeLabels` → `nodes`, so a title inside its cluster is always under any
 * arrow that crosses it, and a background on it would only cover the group's
 * own fill. The new layer is inserted just before `nodes`: titles sit above
 * arrows and edge labels, and nodes still sit above titles.
 *
 * Transforms of the label's old ancestors (Mermaid leaves them empty today)
 * are folded into the label's own `transform`, so it does not move.
 * Idempotent: labels already raised are left alone.
 *
 * VALUE: Group titles stay readable however Mermaid routes arrows into a
 * group, without changing Mermaid's layout.
 */
export function raiseGroupLabels(container: Element): void {
  for (const root of Array.from(container.querySelectorAll("g.root"))) {
    const clusters = root.querySelector(":scope > g.clusters");
    const labels = clusters ? Array.from(clusters.querySelectorAll<SVGGElement>("g.cluster-label")) : [];
    if (labels.length === 0) continue;

    let layer = root.querySelector<SVGGElement>(`:scope > g.${GROUP_LABEL_LAYER_CLASS}`);
    if (!layer) {
      layer = root.ownerDocument.createElementNS(SVG_NAMESPACE, "g") as SVGGElement;
      layer.classList.add(GROUP_LABEL_LAYER_CLASS);
      layer.setAttribute("pointer-events", "none");
      root.insertBefore(layer, root.querySelector(":scope > g.nodes"));
    }

    for (const label of labels) {
      if (!label.textContent?.trim()) continue;
      const cluster = label.closest("g.cluster");
      if (cluster?.id) label.setAttribute(GROUP_LABEL_FOR_ATTRIBUTE, cluster.id);
      label.setAttribute("transform", collectTransformsUpTo(label, root));
      // Measure before moving: the label is laid out where Mermaid put it.
      const box = readLabelTextBox(label);
      layer.appendChild(label);
      if (box) insertLabelBackdrop(label, box);
    }
  }
}

/**
 * Joins the `transform` of `element` and of each ancestor below `root`,
 * outermost first, so the element keeps its position once it is a direct
 * child of a layer in `root`.
 */
function collectTransformsUpTo(element: Element, root: Element): string {
  const transforms: string[] = [];
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
    const transform = node.getAttribute("transform");
    if (transform) transforms.unshift(transform);
  }
  return transforms.join(" ");
}

/** Box of a label's visible text in the label's own coordinates, or `null` if it can't be measured. */
function readLabelTextBox(label: SVGGElement): DOMRect | null {
  // HTML labels: the foreignObject is sized for Mermaid's font, not the
  // canvas's smaller group-title font, so measure the text element itself.
  const foreignObject = label.querySelector("foreignObject");
  const html = foreignObject?.firstElementChild;
  if (foreignObject && html instanceof HTMLElement && html.offsetWidth > 0) {
    const x = foreignObject.x.baseVal.value + html.offsetLeft;
    const y = foreignObject.y.baseVal.value + html.offsetTop;
    return new DOMRect(x, y, html.offsetWidth, html.offsetHeight);
  }
  try {
    const box = label.getBBox();
    return box.width > 0 ? new DOMRect(box.x, box.y, box.width, box.height) : null;
  } catch {
    return null;
  }
}

/** Puts a padded {@link GROUP_LABEL_BACKDROP_CLASS} rect behind a label's text. */
function insertLabelBackdrop(label: SVGGElement, textBox: DOMRect): void {
  let backdrop = label.querySelector<SVGRectElement>(`:scope > rect.${GROUP_LABEL_BACKDROP_CLASS}`);
  if (!backdrop) {
    backdrop = label.ownerDocument.createElementNS(SVG_NAMESPACE, "rect") as SVGRectElement;
    backdrop.classList.add(GROUP_LABEL_BACKDROP_CLASS);
    label.insertBefore(backdrop, label.firstChild);
  }
  backdrop.setAttribute("x", String(textBox.x - GROUP_LABEL_PADDING_X_PX));
  backdrop.setAttribute("y", String(textBox.y - GROUP_LABEL_PADDING_Y_PX));
  backdrop.setAttribute("width", String(textBox.width + 2 * GROUP_LABEL_PADDING_X_PX));
  backdrop.setAttribute("height", String(textBox.height + 2 * GROUP_LABEL_PADDING_Y_PX));
}
