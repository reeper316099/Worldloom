import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import type { Root, Content, Parent, Text } from 'mdast';
import { slugify, type Reveal } from '@worldloom/shared';
import { parseLinkInner, type WikiLink } from './links';

export type ClaimKind = 'confirmed' | 'inferred' | 'theory' | 'retconned';
const CLAIM_KINDS = new Set<string>(['confirmed', 'inferred', 'theory', 'retconned']);

export interface LinkResolution {
  href: string;
  exists: boolean;
  /** Display text to use when the link has no explicit label. */
  title?: string;
  /** Target is spoiler-gated and hidden: render greyed, no hover data. */
  hidden?: boolean;
}

export interface RenderOptions {
  resolveLink?: (l: WikiLink) => LinkResolution;
  resolveCitation?: (text: string) => { label: string; sourceId?: string } | undefined;
  /** Player view: drop `:::dm` blocks. */
  hideDm?: boolean;
  /** Selected continuity id; blocks not applying to it are dropped. Undefined = show all with labels. */
  continuity?: string;
  /** Spoiler gate. Hidden content is REMOVED from output (never merely CSS-hidden). */
  isRevealed?: (reveal: Reveal, key: string) => boolean;
  /** Trusted HTML generators (must escape their own content). */
  infobox?: () => string | undefined;
  embed?: (l: WikiLink) => string | undefined;
}

export interface Heading {
  depth: number;
  text: string;
  id: string;
}
export interface RenderResult {
  html: string;
  headings: Heading[];
  /** Links in visible content only. */
  links: WikiLink[];
  citations: string[];
  claims: Array<{ kind: ClaimKind; text: string; cited: boolean }>;
  /** Spoiler/continuity blocks that were withheld. */
  hiddenBlocks: Array<{ key: string; reveal: Reveal }>;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const INLINE_RE = /\[\[([^[\]\n]+?)\]\]|\{\{\s*(src|claim)\s*:\s*([^{}\n]*?)\s*\}\}|\{\{\s*\/claim\s*\}\}/g;
const BLOCK_RE = /^\{\{\s*(?:(toc|infobox)|embed\s*:\s*(.+?))\s*\}\}$/i;

interface Marker extends Text {
  marker?: { open?: ClaimKind; close?: true };
}

const schema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...(defaultSchema.tagNames ?? []), 'span', 'div', 'nav', 'aside', 'section', 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    // default per-tag className entries restrict values; drop them for tags we style ourselves
    ...Object.fromEntries(
      ['a', 'span', 'div', 'mark', 'nav', 'aside', 'section'].map((t) => [
        t,
        (defaultSchema.attributes?.[t] ?? []).filter((x) => (Array.isArray(x) ? x[0] : x) !== 'className'),
      ]),
    ),
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id', 'data*'],
  },
};

function toText(node: Content | Root): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) return (node.children as Content[]).map(toText).join('');
  return '';
}

function revealFromAttrs(a: Record<string, string | null | undefined>): Reveal | undefined {
  if (a.arc) return { arcId: a.arc };
  const at = Number(a.at);
  if (a.src && Number.isFinite(at)) return { sourceId: a.src, at };
  return undefined;
}

type Visit = { src: string; o: RenderOptions; r: RenderResult; ph: Map<string, string>; n: { i: number; b: number } };

function placeholder(v: Visit, html: string): Content {
  const id = `p${v.n.i++}`;
  v.ph.set(id, html);
  return { type: 'wlPlaceholder', data: { hName: 'div', hProperties: { dataWl: id } }, children: [] } as unknown as Content;
}

function wrap(name: string, props: Record<string, unknown>, children: Content[]): Content {
  return { type: 'wlNode', data: { hName: name, hProperties: props }, children } as unknown as Content;
}

function inlineNodes(text: string, v: Visit): Content[] {
  const out: Content[] = [];
  let pos = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > pos) out.push({ type: 'text', value: text.slice(pos, m.index) });
    pos = m.index! + m[0].length;
    if (m[1] !== undefined) {
      const p = parseLinkInner(m[1]);
      if (!p) {
        out.push({ type: 'text', value: m[0] });
        continue;
      }
      const link: WikiLink = { ...p, raw: m[0], start: m.index!, end: pos };
      const res = v.o.resolveLink?.(link) ?? { href: '#', exists: true };
      const shown = res.hidden ? (res.title ?? '???') : (link.label ?? res.title ?? (link.name || link.section || ''));
      if (!res.hidden) v.r.links.push(link);
      const cls = ['wikilink', res.exists ? '' : 'redlink', res.hidden ? 'gated' : ''].filter(Boolean);
      out.push(wrap('a', { href: res.href, className: cls, dataTarget: res.hidden ? '' : link.name }, [{ type: 'text', value: shown }]));
    } else if (m[2] === 'src') {
      const c = v.o.resolveCitation?.(m[3]!) ?? { label: m[3]! };
      v.r.citations.push(m[3]!);
      out.push(wrap('span', { className: ['cite'], dataSource: c.sourceId ?? '', title: m[3]! }, [{ type: 'text', value: c.label }]));
    } else if (m[2] === 'claim') {
      const kind = m[3]!.trim().toLowerCase();
      if (CLAIM_KINDS.has(kind)) out.push({ type: 'text', value: '', marker: { open: kind as ClaimKind } } as Marker);
      else out.push({ type: 'text', value: m[0] });
    } else {
      out.push({ type: 'text', value: '', marker: { close: true } } as Marker);
    }
  }
  if (pos < text.length) out.push({ type: 'text', value: text.slice(pos) });
  return out;
}

/** Wrap claim open/close markers into <mark class="claim"> spans; drop unbalanced markers. */
function applyClaims(children: Content[], v: Visit): Content[] {
  const out: Content[] = [];
  let open: { kind: ClaimKind; at: number } | undefined;
  for (const c of children) {
    const mk = (c as Marker).marker;
    if (mk?.open) {
      if (!open) open = { kind: mk.open, at: out.length };
    } else if (mk?.close) {
      if (open) {
        const inner = out.splice(open.at);
        const text = inner.map(toText).join('');
        const cited = inner.some((n) => (n as { data?: { hProperties?: { className?: string[] } } }).data?.hProperties?.className?.includes('cite'));
        v.r.claims.push({ kind: open.kind, text, cited });
        out.push(wrap('mark', { className: ['claim', `claim-${open.kind}`], dataClaim: open.kind, title: open.kind }, inner));
        open = undefined;
      }
    } else out.push(c);
  }
  return out;
}

function transformChildren(parent: Parent, v: Visit, hidden: { v: boolean }): void {
  const next: Content[] = [];
  for (const child of parent.children as Content[]) {
    // block placeholders: a paragraph that is only {{toc}} / {{infobox}} / {{embed: X}}
    if (child.type === 'paragraph' && child.children.length === 1 && child.children[0]!.type === 'text') {
      const bm = BLOCK_RE.exec((child.children[0] as Text).value.trim());
      if (bm) {
        if (bm[1]?.toLowerCase() === 'toc') next.push(placeholder(v, '\u0000toc'));
        else if (bm[1]?.toLowerCase() === 'infobox') next.push(placeholder(v, v.o.infobox?.() ?? ''));
        else {
          const p = parseLinkInner(bm[2]!);
          const link: WikiLink | undefined = p && { ...p, raw: bm[0], start: 0, end: 0 };
          const html = link && v.o.embed?.(link);
          if (link && html !== undefined) v.r.links.push(link);
          next.push(placeholder(v, html ?? `<div class="embed-missing">Embed unavailable: ${escapeHtml(bm[2]!)}</div>`));
        }
        continue;
      }
    }
    if (child.type === 'containerDirective') {
      const attrs = (child.attributes ?? {}) as Record<string, string | null>;
      if (child.name === 'spoiler') {
        const reveal = revealFromAttrs(attrs);
        const key = `spoiler:${v.n.b++}`;
        if (reveal && v.o.isRevealed && !v.o.isRevealed(reveal, key)) {
          v.r.hiddenBlocks.push({ key, reveal });
          const what = 'sourceId' in reveal ? `${reveal.sourceId} ${reveal.at}` : `arc ${reveal.arcId}`;
          next.push(wrap('div', { className: ['spoiler-hidden'], dataKey: key }, [{ type: 'paragraph', children: [{ type: 'text', value: `Spoiler for ${what} · Click to reveal` }] }]));
          continue;
        }
        transformChildren(child as unknown as Parent, v, hidden);
        next.push(wrap('div', { className: ['spoiler'], dataKey: key }, child.children as Content[]));
        continue;
      }
      if (child.name === 'dm') {
        if (v.o.hideDm) continue;
        transformChildren(child as unknown as Parent, v, hidden);
        next.push(wrap('div', { className: ['dm-only'] }, child.children as Content[]));
        continue;
      }
      if (child.name === 'continuity') {
        const ids = (attrs.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (v.o.continuity && ids.length && !ids.includes(v.o.continuity)) continue;
        transformChildren(child as unknown as Parent, v, hidden);
        next.push(wrap('div', { className: ['continuity'], dataIds: ids.join(',') }, child.children as Content[]));
        continue;
      }
      if (child.name === 'diff') {
        transformChildren(child as unknown as Parent, v, hidden);
        next.push(wrap('div', { className: ['diff'] }, child.children as Content[]));
        continue;
      }
      if (child.name === 'callout') {
        transformChildren(child as unknown as Parent, v, hidden);
        next.push(wrap('aside', { className: ['callout', `callout-${attrs.type ?? 'note'}`] }, child.children as Content[]));
        continue;
      }
    }
    // unknown directives are restored to their literal source text so prose like "Note:foo" survives
    if (child.type === 'textDirective' || child.type === 'leafDirective' || child.type === 'containerDirective') {
      const s = child.position?.start.offset;
      const e = child.position?.end.offset;
      next.push({ type: 'text', value: s !== undefined && e !== undefined ? v.src.slice(s, e) : '' });
      continue;
    }
    if (child.type === 'text') {
      next.push(...inlineNodes(child.value, v));
      continue;
    }
    if (child.type === 'code' || child.type === 'inlineCode' || child.type === 'html') {
      if (child.type !== 'html') next.push(child);
      continue; // raw HTML is dropped entirely
    }
    if ('children' in child) transformChildren(child as Parent, v, hidden);
    next.push(child);
  }
  parent.children = applyClaims(next, v) as Parent['children'];
}

function headings(tree: Root, v: Visit) {
  const seen = new Map<string, number>();
  const walk = (n: Content | Root) => {
    if (n.type === 'heading') {
      const text = toText(n);
      let id = 'h-' + slugify(text);
      const c = seen.get(id) ?? 0;
      seen.set(id, c + 1);
      if (c) id += `-${c + 1}`;
      (n.data ??= {}).hProperties = { id };
      v.r.headings.push({ depth: n.depth, text, id });
    }
    if ('children' in n) (n.children as Content[]).forEach(walk);
  };
  walk(tree);
}

function tocHtml(hs: Heading[]): string {
  if (!hs.length) return '';
  return `<nav class="toc"><ol>${hs.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('')}</ol></nav>`;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);
const toHtml = unified().use(remarkRehype, { allowDangerousHtml: false }).use(rehypeSanitize, schema).use(rehypeStringify);

/** Render wiki Markdown to sanitized HTML. Never emits raw author HTML. */
export function render(source: string, o: RenderOptions = {}): RenderResult {
  const r: RenderResult = { html: '', headings: [], links: [], citations: [], claims: [], hiddenBlocks: [] };
  const v: Visit = { src: source, o, r, ph: new Map(), n: { i: 0, b: 0 } };
  const tree = parser.parse(source) as Root;
  transformChildren(tree as unknown as Parent, v, { v: false });
  headings(tree, v);
  const hast = toHtml.runSync(tree as never);
  let html = toHtml.stringify(hast as never);
  html = html.replace(/<div data-wl="(p\d+)"><\/div>/g, (_, id: string) => {
    const h = v.ph.get(id) ?? '';
    return h === '\u0000toc' ? tocHtml(r.headings) : h;
  });
  r.html = html;
  return r;
}

/**
 * Source with withheld blocks removed (spoiler/continuity), for link/search indexing in reader mode.
 * Uses the same visibility rules as `render`.
 */
export function redact(source: string, o: Pick<RenderOptions, 'continuity' | 'isRevealed' | 'hideDm'>): string {
  if (!source.includes(':::')) return source; // no directive blocks: nothing to withhold, skip the Markdown parse
  const tree = parser.parse(source) as Root;
  const ranges: Array<[number, number]> = [];
  let b = 0;
  const walk = (n: Content | Root) => {
    if (n.type === 'containerDirective') {
      const attrs = (n.attributes ?? {}) as Record<string, string | null>;
      let hide = false;
      if (n.name === 'spoiler') {
        const reveal = revealFromAttrs(attrs);
        const key = `spoiler:${b++}`;
        hide = !!reveal && !!o.isRevealed && !o.isRevealed(reveal, key);
      } else if (n.name === 'dm') {
        hide = !!o.hideDm;
      } else if (n.name === 'continuity' && o.continuity) {
        const ids = (attrs.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        hide = ids.length > 0 && !ids.includes(o.continuity);
      }
      if (hide && n.position) {
        ranges.push([n.position.start.offset!, n.position.end.offset!]);
        return;
      }
    }
    if ('children' in n) (n.children as Content[]).forEach(walk);
  };
  walk(tree);
  let out = '';
  let pos = 0;
  for (const [s, e] of ranges) {
    out += source.slice(pos, s);
    pos = e;
  }
  return out + source.slice(pos);
}
