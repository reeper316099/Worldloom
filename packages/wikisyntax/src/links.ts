export interface WikiLink {
  /** Full source text including brackets. */
  raw: string;
  /** Target page name (title or alias), without type prefix or section. */
  name: string;
  /** Type disambiguation from `[[type:Character/Name]]`. */
  type?: string;
  section?: string;
  label?: string;
  start: number;
  end: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)/g;
const blank = (m: string) => m.replace(/[^\n]/g, ' ');

/** Replace code regions with spaces (same length) so offsets stay valid. */
export function maskCode(src: string): string {
  return src.replace(FENCE, blank).replace(INLINE, blank);
}

export function parseLinkInner(inner: string): Omit<WikiLink, 'raw' | 'start' | 'end'> | undefined {
  const pipe = inner.indexOf('|');
  const targetPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const label = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();
  let target = targetPart;
  let section: string | undefined;
  const hash = target.indexOf('#');
  if (hash !== -1) {
    section = target.slice(hash + 1).trim() || undefined;
    target = target.slice(0, hash).trim();
  }
  let type: string | undefined;
  const tm = /^type:([^/]+)\/(.+)$/i.exec(target);
  if (tm) {
    type = tm[1]!.trim();
    target = tm[2]!.trim();
  }
  if (!target && !section) return undefined;
  return { name: target, type, section, label: label || undefined };
}

export function formatLink(l: Pick<WikiLink, 'name' | 'type' | 'section' | 'label'>): string {
  const target = (l.type ? `type:${l.type}/` : '') + l.name + (l.section ? `#${l.section}` : '');
  return `[[${target}${l.label !== undefined ? `|${l.label}` : ''}]]`;
}

export const WIKILINK_RE = /\[\[([^[\]\n]+?)\]\]/g;

/** All wiki links in source, ignoring code. Offsets refer to the original source. */
export function extractLinks(source: string): WikiLink[] {
  const masked = maskCode(source);
  const out: WikiLink[] = [];
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const p = parseLinkInner(m[1]!);
    if (!p) continue;
    const start = m.index!;
    out.push({ ...p, raw: source.slice(start, start + m[0].length), start, end: start + m[0].length });
  }
  return out;
}

/**
 * Rewrite links. `fn` returns replacement fields (merged over the existing link) or undefined to
 * leave the link as-is. Links inside code are never touched.
 */
export function rewriteLinks(
  source: string,
  fn: (l: WikiLink) => Partial<Pick<WikiLink, 'name' | 'type' | 'section' | 'label'>> | undefined,
): { source: string; changed: number } {
  const links = extractLinks(source);
  let out = '';
  let pos = 0;
  let changed = 0;
  for (const l of links) {
    const r = fn(l);
    if (!r) continue;
    const next = formatLink({ name: l.name, type: l.type, section: l.section, label: l.label, ...r });
    if (next === l.raw) continue;
    out += source.slice(pos, l.start) + next;
    pos = l.end;
    changed++;
  }
  return { source: out + source.slice(pos), changed };
}

/** Markdown of the section under heading `title` (up to the next heading of same/higher level). */
export function extractSection(source: string, title: string): string | undefined {
  const masked = maskCode(source);
  const heads = [...masked.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm)];
  const want = title.trim().toLowerCase();
  const i = heads.findIndex((h) => h[2]!.trim().toLowerCase() === want);
  if (i === -1) return undefined;
  const level = heads[i]![1]!.length;
  const start = heads[i]!.index! + heads[i]![0].length;
  const next = heads.slice(i + 1).find((h) => h[1]!.length <= level);
  return source.slice(start, next ? next.index : undefined).trim();
}

const CLAIM_RE = /\{\{\s*claim\s*:\s*(confirmed|inferred|theory|retconned)\s*\}\}([\s\S]*?)\{\{\s*\/claim\s*\}\}/gi;
/** Cheap claim scan (no Markdown parse) for health reports: claim kind, plain text, and whether it carries a citation. */
export function extractClaims(source: string): Array<{ kind: string; text: string; cited: boolean }> {
  const out: Array<{ kind: string; text: string; cited: boolean }> = [];
  for (const m of maskCode(source).matchAll(CLAIM_RE)) {
    const inner = source.slice(m.index! + m[0].indexOf('}}') + 2, m.index! + m[0].lastIndexOf('{{'));
    const text = inner.replace(/\{\{[^}]*\}\}/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => b ?? a).replace(/\s+/g, ' ').trim();
    out.push({ kind: m[1]!.toLowerCase(), text, cited: /\{\{\s*src\s*:/.test(inner) });
  }
  return out;
}
