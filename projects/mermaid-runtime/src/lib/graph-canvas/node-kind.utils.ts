import { MermaidRuntime } from '../task-graph-model';

/** The visual choices for one node after its kind and its own decoration are combined. */
export interface ResolvedNodeStyle {
  shape?: MermaidRuntime.NodeShape;
  icon?: string;
  chip?: string;
  tone?: string;
}

/**
 * Combines a node's kind style with its own decoration.
 *
 * PURPOSE: A host describes a kind once (`nodeKinds`) and still overrides single
 * nodes (`decorations`), for example one polling step among many database steps.
 *
 * VALUE: One place decides precedence, so the label, the shape and the overlays
 * always agree. A field set on the decoration wins; an empty string clears the
 * kind's value.
 */
export function resolveNodeStyle(
  node: Pick<MermaidRuntime.Node, 'type'>,
  decoration: MermaidRuntime.NodeDecoration | undefined,
  kinds: Readonly<Record<string, MermaidRuntime.NodeKindStyle>>,
): ResolvedNodeStyle {
  const kind = node.type && Object.prototype.hasOwnProperty.call(kinds, node.type) ? kinds[node.type] : undefined;
  const text = (own: string | undefined, inherited: string | undefined): string | undefined => {
    const value = (own ?? inherited)?.trim();
    return value ? value : undefined;
  };
  return {
    shape: decoration?.shape ?? kind?.shape,
    icon: text(decoration?.icon, kind?.icon),
    chip: text(decoration?.chip, kind?.chip),
    tone: text(decoration?.tone, kind?.tone),
  };
}

/** Prefix of the CSS class a tone name maps to (`mr-tone-teal`). */
const TONE_CLASS_PREFIX = 'mr-tone-';

/** Tone names the host may use: letters, digits and hyphens. */
const TONE_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

/**
 * Turns a tone name into its CSS class, or `null` when the name is not usable.
 *
 * VALUE: The class goes into the Mermaid source, so only a plain word may pass.
 */
export function toToneClass(tone: string | undefined): string | null {
  return tone && TONE_NAME_PATTERN.test(tone) ? `${TONE_CLASS_PREFIX}${tone.toLowerCase()}` : null;
}

/** Material icon names are lowercase words joined by underscores. */
const MATERIAL_ICON_NAME_PATTERN = /^[a-z0-9_]+$/;

/** Elements removed from a host icon: they run code or load other content. */
const UNSAFE_ICON_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'style', 'image', 'use', 'a'];

/** What an icon string draws: a Material ligature name, or a cleaned SVG. */
export type IconContent = { kind: 'name'; name: string } | { kind: 'svg'; element: SVGSVGElement };

/**
 * Reads a host icon string into something safe to draw.
 *
 * PURPOSE: Hosts give an icon as a Material name or as their own SVG.
 *
 * VALUE: A host SVG is parsed and stripped of scripts, event handlers and
 * external references before it enters the page, so a bad or pasted icon cannot
 * run code. It returns `null` for anything it cannot make sense of.
 */
export function readIconContent(icon: string): IconContent | null {
  const text = icon.trim();
  if (!text) return null;
  if (!text.startsWith('<')) return MATERIAL_ICON_NAME_PATTERN.test(text) ? { kind: 'name', name: text } : null;
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
  for (const tag of UNSAFE_ICON_ELEMENTS) root.querySelectorAll(tag).forEach((element) => element.remove());
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'href' || name === 'xlink:href' || /url\(\s*['"]?\s*(?!#)/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  }
  root.removeAttribute('width');
  root.removeAttribute('height');
  root.setAttribute('aria-hidden', 'true');
  return { kind: 'svg', element: document.importNode(root, true) as unknown as SVGSVGElement };
}
