import { MermaidRuntime } from '../task-graph-model';
import { readIconContent, resolveNodeStyle, toToneClass } from './node-kind.utils';

/** What a node with no kind and no decoration resolves to. */
const NO_STYLE = { shape: undefined, icon: undefined, chip: undefined, tone: undefined };

describe('resolveNodeStyle', () => {
  const kinds: Record<string, MermaidRuntime.NodeKindStyle> = {
    SQL: { shape: 'rounded', icon: 'database', chip: 'sql', tone: 'teal' },
  };

  it('takes every field from the kind of the node', () => {
    expect(resolveNodeStyle({ type: 'SQL' }, undefined, kinds)).toEqual({ shape: 'rounded', icon: 'database', chip: 'sql', tone: 'teal' });
  });

  it('lets the decoration win field by field', () => {
    const style = resolveNodeStyle({ type: 'SQL' }, { icon: 'refresh', chip: 'poll 5s' }, kinds);
    expect(style).toEqual({ shape: 'rounded', icon: 'refresh', chip: 'poll 5s', tone: 'teal' });
  });

  it('clears a kind value with an empty string', () => {
    expect(resolveNodeStyle({ type: 'SQL' }, { chip: '' }, kinds).chip).toBeUndefined();
  });

  it('returns nothing for an unknown or missing type', () => {
    expect(resolveNodeStyle({ type: 'HTTP' }, undefined, kinds)).toEqual(NO_STYLE);
    expect(resolveNodeStyle({ type: null }, undefined, kinds)).toEqual(NO_STYLE);
  });

  it('ignores names that only exist on Object.prototype', () => {
    expect(resolveNodeStyle({ type: 'constructor' }, undefined, kinds)).toEqual(NO_STYLE);
  });
});

describe('toToneClass', () => {
  it('maps a plain name to a class', () => {
    expect(toToneClass('Teal')).toBe('mr-tone-teal');
    expect(toToneClass('db-poll')).toBe('mr-tone-db-poll');
  });

  it('rejects names that could break the Mermaid source', () => {
    expect(toToneClass('x onclick=y')).toBeNull();
    expect(toToneClass('a b')).toBeNull();
    expect(toToneClass(undefined)).toBeNull();
  });
});

describe('readIconContent', () => {
  it('reads a Material icon name', () => {
    expect(readIconContent('refresh')).toEqual({ kind: 'name', name: 'refresh' });
    expect(readIconContent('database_search')).toEqual({ kind: 'name', name: 'database_search' });
  });

  it('rejects text that is neither a name nor an SVG', () => {
    expect(readIconContent('')).toBeNull();
    expect(readIconContent('Not an icon!')).toBeNull();
    expect(readIconContent('<div>hi</div>')).toBeNull();
    expect(readIconContent('<svg><path')).toBeNull();
  });

  it('strips scripts, handlers, external references and fixed sizes from an SVG', () => {
    const markup = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" onload="x()">',
      '<script>alert(1)</script><foreignObject><div/></foreignObject>',
      '<a href="https://example.com"><path d="M0 0h24v24H0z" onclick="x()" fill="url(https://evil.test/p)"/></a>',
      '<circle cx="12" cy="12" r="4" fill="currentColor"/>',
      '</svg>',
    ].join('');
    const content = readIconContent(markup);
    expect(content?.kind).toBe('svg');
    const svg = (content as { element: SVGSVGElement }).element;
    expect(svg.querySelector('script, foreignObject, a')).toBeNull();
    expect(svg.outerHTML).not.toMatch(/onload|onclick|evil\.test|alert/);
    expect(svg.hasAttribute('width')).toBe(false);
    expect(svg.querySelector('circle')?.getAttribute('fill')).toBe('currentColor');
  });
});
