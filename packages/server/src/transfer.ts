import YAML from 'yaml';
import { zipSync, strToU8 } from 'fflate';
import { slugify, titleKey, type EntityType, type Page } from '@worldloom/shared';
import { escapeHtml, extractLinks, parseLinkInner, redact } from '@worldloom/wikisyntax';
import type { WorldRepo } from './repo';
import { pageVisible, revealOk, type Viewer } from './visibility';
import { serializePage } from './pagefile';
import { badRequest } from './errors';

// ====================== export ======================
export interface ExportOpts { spoilers: boolean; player: boolean; type?: string; page?: string }
export const exportViewer = (repo: WorldRepo, o: ExportOpts): Viewer => repo.viewer({ mode: o.spoilers ? 'author' : 'reader', player: o.player, hideTitles: true }) // exports always mask gated titles;

/** Replace links to pages the viewer cannot see with plain text so titles of gated pages never leave the app. */
function flattenHidden(repo: WorldRepo, body: string, v: Viewer): string {
  let out = '';
  let pos = 0;
  for (const l of extractLinks(body)) {
    const t = l.name ? repo.resolve(l.name, l.type) : undefined;
    if (!t || pageVisible(v, t)) continue;
    out += body.slice(pos, l.start) + (l.label ?? '???');
    pos = l.end;
  }
  out += body.slice(pos);
  return out.replace(/\{\{\s*embed\s*:\s*([^}]+?)\s*\}\}/gi, (m, inner: string) => {
    const p = parseLinkInner(inner);
    const t = p?.name ? repo.resolve(p.name, p.type) : undefined;
    return t && !pageVisible(v, t) ? '' : m;
  });
}

/** A page as it may be exported for this viewer, or undefined if the viewer may not see it. */
export function exportablePage(repo: WorldRepo, p: Page, v: Viewer): Page | undefined {
  if (!pageVisible(v, p)) return undefined;
  if (v.mode === 'author') return p;
  const type = repo.typeOf(p);
  const fields: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(p.fields)) {
    const wrapped = !!raw && typeof raw === 'object' && !Array.isArray(raw) && ('value' in raw || 'byContinuity' in raw);
    const w = wrapped ? (raw as { value?: unknown; byContinuity?: Record<string, unknown>; reveal?: never }) : undefined;
    if (w && !revealOk(v, (raw as { reveal?: never }).reveal, `field:${p.id}.${k}`)) continue;
    let val: unknown = w ? { value: w.value, byContinuity: w.byContinuity } : raw;
    const def = type?.fields.find((d) => d.key === k);
    if (def?.type === 'relation') {
      const keep = (x: unknown) => { const t = repo.resolve(String(x), def.relationTo); return !t || pageVisible(v, t); };
      const filt = (x: unknown) => (Array.isArray(x) ? x.filter(keep) : keep(x) ? x : undefined);
      if (w) { const o = val as { value?: unknown; byContinuity?: Record<string, unknown> }; val = { value: filt(o.value), byContinuity: o.byContinuity && Object.fromEntries(Object.entries(o.byContinuity).map(([c, x]) => [c, filt(x)])) }; }
      else val = filt(val);
    }
    if (val !== undefined) fields[k] = JSON.parse(JSON.stringify(val));
  }
  const body = flattenHidden(repo, redact(p.body, { hideDm: v.player, isRevealed: (r, key) => revealOk(v, r, `${p.id}:${key}`) }), v);
  return { ...p, fields, body, reveal: undefined, dmOnly: false };
}

export function exportPages(repo: WorldRepo, v: Viewer): Page[] {
  return [...repo.pages.values()].map((p) => exportablePage(repo, p, v)).filter((p): p is Page => !!p).sort((a, b) => a.title.localeCompare(b.title));
}

export function exportJson(repo: WorldRepo, v: Viewer) {
  const pages = exportPages(repo, v);
  const ids = new Set(pages.map((p) => p.id));
  const author = v.mode === 'author';
  const world = repo.worldView(v);
  return {
    format: 'worldloom-backup', version: 1, exportedAt: new Date().toISOString(), includesSpoilers: author,
    world: author ? world : { ...world, progress: { sources: {}, showAll: false, revealed: [], impliedFloor: 'conservative' } },
    types: repo.types,
    pages,
    relations: (repo.relationsFile.get()?.relations ?? []).filter((r) => ids.has(r.fromId) && ids.has(r.toId) && revealOk(v, r.reveal, `relation:${r.id}`)).map((r) => (author ? r : { ...r, reveal: undefined })),
    timeline: (repo.timelineFile.get()?.events ?? []).filter((e) => revealOk(v, e.reveal, `event:${e.id}`) && e.pageIds.every((i) => ids.has(i))).map((e) => (author ? e : { ...e, reveal: undefined })),
  };
}

export function exportMarkdownZip(repo: WorldRepo, v: Viewer): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'README.md': strToU8(`# ${repo.world.name}\n\nExported from Worldloom${v.mode === 'author' ? ' (includes spoilers)' : ' (spoilers excluded)'}. Open this folder as an Obsidian vault or import it into another Worldloom world.\n`),
  };
  for (const p of exportPages(repo, v)) files[`${p.type}/${p.slug}.md`] = strToU8(serializePage(p));
  return zipSync(files);
}

const csvCell = (x: unknown) => {
  const s = x === undefined || x === null ? '' : Array.isArray(x) ? x.join('; ') : typeof x === 'object' ? String((x as { value?: unknown }).value ?? '') : String(x);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function exportCsv(repo: WorldRepo, v: Viewer, typeSlug: string): string {
  const t = repo.types.find((x) => x.slug === typeSlug);
  if (!t) throw badRequest(`unknown type "${typeSlug}"`);
  const rows = exportPages(repo, v).filter((p) => p.type === typeSlug);
  const head = ['title', 'aliases', 'tags', 'status', ...t.fields.map((f) => f.key), 'body'];
  const lines = [head.join(',')];
  for (const p of rows) lines.push([p.title, p.aliases.join('; '), p.tags.join('; '), p.status, ...t.fields.map((f) => p.fields[f.key]), p.body].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

// ---- HTML (single page, single-file world, static site) ----
const CSS = `body{font:16px/1.6 system-ui,sans-serif;margin:0;background:#fafafa;color:#1a1c2b}main{max-width:860px;margin:0 auto;padding:24px}nav.top{padding:12px 24px;background:#1a1c2b}nav.top a{color:#fff;margin-right:16px}a{color:#5b3df5}.wikilink.redlink{color:#c0334d}.wikilink.gated{color:#777;font-style:italic}.cite{font-size:.72rem;padding:1px 7px;border-radius:99px;background:#e0f2fe;color:#075985}mark.claim{background:none;border-bottom:2px solid #5b3df5}.spoiler-hidden{padding:12px;border:1px dashed #999;color:#666;text-align:center}.infobox{float:right;width:260px;margin:0 0 16px 16px;border:1px solid #d8dbea;border-radius:10px;overflow:hidden;background:#fff}.infobox-title{background:#5b3df5;color:#fff;padding:8px 12px;font-weight:700}.infobox-row{display:grid;grid-template-columns:40% 1fr;gap:8px;padding:6px 12px;border-top:1px solid #eee;font-size:.9rem}.k{color:#666}.callout{padding:8px 12px;background:#eef0f8;border-left:3px solid #5b3df5}.continuity{border-left:3px solid #38bdf8;padding-left:12px}.dm-only{border-left:3px solid #c0334d;padding-left:12px}h2{border-bottom:1px solid #ddd}.toc ol{list-style:none;padding:8px 12px;background:#eef0f8;display:inline-block}`;
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;
const shell = (title: string, inner: string, css = `<style>${CSS}</style>`) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${CSP}<title>${escapeHtml(title)}</title>${css}</head><body>${inner}</body></html>`;

function pageBody(repo: WorldRepo, p: Page, v: Viewer, href: (slug: string) => string) {
  const view = repo.view(p.id, v);
  if (view.hidden) return undefined;
  const rows = view.infobox.rows.map((r) => `<div class="infobox-row"><span class="k">${escapeHtml(r.label)}</span><span class="v">${escapeHtml(Array.isArray(r.value) ? r.value.join(', ') : String(r.value))}</span></div>`).join('');
  const base = `#/w/${repo.slug}/p/`;
  const html = view.html
    .replace(/href="#\/w\/[^"/]+\/new\?[^"]*"/g, 'href="#"')
    .replace(/href="#\/w\/[^"/]+\/p\/([^"#]+)(#[^"]*)?"/g, (_m, slug: string, hash?: string) => `href="${href(decodeURIComponent(slug))}${hash ?? ''}"`);
  void base;
  return `<h1 id="p-${escapeHtml(p.slug)}">${escapeHtml(view.title)}</h1>${view.aliases.length ? `<p><em>Also known as ${escapeHtml(view.aliases.join(', '))}</em></p>` : ''}<aside class="infobox"><div class="infobox-title">${escapeHtml(view.title)}</div>${rows}</aside>${html}`;
}

export function exportHtmlPage(repo: WorldRepo, v: Viewer, ref: string): string {
  const p = repo.findPage(ref);
  if (!p) throw badRequest('page not found');
  const inner = pageBody(repo, p, v, (slug) => `#p-${slug}`);
  if (!inner) throw badRequest('page not available');
  return shell(p.title, `<main>${inner}</main>`);
}
export function exportHtmlWorld(repo: WorldRepo, v: Viewer): string {
  const pages = exportPages(repo, v);
  const sections = pages.map((p) => `<section>${pageBody(repo, p, v, (slug) => `#p-${slug}`) ?? ''}</section>`).join('<hr>');
  const toc = `<nav class="toc"><ol>${pages.map((p) => `<li><a href="#p-${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></li>`).join('')}</ol></nav>`;
  return shell(repo.world.name, `<main><h1>${escapeHtml(repo.world.name)}</h1><p>${escapeHtml(repo.world.description)}</p>${toc}${sections}</main>`);
}
export function exportSiteZip(repo: WorldRepo, v: Viewer): Uint8Array {
  const pages = exportPages(repo, v);
  const css = '<link rel="stylesheet" href="style.css">';
  const files: Record<string, Uint8Array> = { 'style.css': strToU8(CSS.replace('img-src data:', '')) };
  const nav = `<nav class="top"><a href="index.html">${escapeHtml(repo.world.name)}</a></nav>`;
  const byType = new Map<string, Page[]>();
  for (const p of pages) (byType.get(p.type) ?? byType.set(p.type, []).get(p.type)!).push(p);
  const list = [...byType].map(([t, ps]) => `<h2>${escapeHtml(repo.types.find((x) => x.slug === t)?.name ?? t)}</h2><ul>${ps.map((p) => `<li><a href="${escapeHtml(p.slug)}.html">${escapeHtml(p.title)}</a></li>`).join('')}</ul>`).join('');
  files['index.html'] = strToU8(shell(repo.world.name, `${nav}<main><h1>${escapeHtml(repo.world.name)}</h1><p>${escapeHtml(repo.world.description)}</p>${list}</main>`, css));
  for (const p of pages) {
    const inner = pageBody(repo, p, v, (slug) => `${slug}.html`);
    if (inner) files[`${p.slug}.html`] = strToU8(shell(p.title, `${nav}<main>${inner}</main>`, css));
  }
  return zipSync(files);
}

// ====================== import ======================
export interface ImportItem {
  type: string; title: string; aliases: string[]; tags: string[]; status: Page['status']; fields: Record<string, unknown>; body: string;
  source: string; warnings: string[]; action?: 'create' | 'skip' | 'overwrite' | 'rename';
}
const listify = (x: unknown): string[] => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[;,|]/) : []).map((s) => String(s).trim().replace(/^#/, '')).filter(Boolean);
const matchType = (types: EntityType[], s?: string) => (s ? types.find((t) => t.slug === slugify(s) || titleKey(t.name) === titleKey(s)) : undefined);
const STATUSES = new Set(['stub', 'draft', 'complete']);

/** Parse a folder of Markdown files (plain or Obsidian vault) into import items. Nothing is written. */
export function parseMarkdownFiles(files: Array<{ path: string; text: string }>, types: EntityType[], defaultType?: string): ImportItem[] {
  const out: ImportItem[] = [];
  for (const f of files) {
    if (!/\.md$/i.test(f.path) || /(^|\/)(\.obsidian|\.trash|README\.md$)/i.test(f.path)) continue;
    const warnings: string[] = [];
    const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(f.text);
    let fm: Record<string, unknown> = {};
    if (m) {
      try { fm = (YAML.parse(m[1]!) as Record<string, unknown>) ?? {}; } catch { warnings.push('frontmatter is not valid YAML; ignored'); }
    }
    const body = (m ? f.text.slice(m[0].length) : f.text).replace(/^\r?\n/, '');
    const segs = f.path.split('/');
    const t = matchType(types, typeof fm.type === 'string' ? fm.type : undefined) ?? matchType(types, segs.length > 1 ? segs[0] : undefined) ?? matchType(types, defaultType);
    const title = String(fm.title ?? segs.at(-1)!.replace(/\.md$/i, '')).trim();
    if (!t) { out.push({ type: '', title, aliases: [], tags: [], status: 'draft', fields: {}, body, source: f.path, warnings: ['no matching type; choose a default type'], action: 'skip' }); continue; }
    const fields: Record<string, unknown> = {};
    const known = new Set(['title', 'type', 'aliases', 'alias', 'tags', 'tag', 'status', 'slug', 'id', 'createdAt', 'updatedAt', 'categories', 'cssclasses']);
    const ignored: string[] = [];
    const src = (fm.fields && typeof fm.fields === 'object' ? { ...(fm.fields as object), ...fm } : fm) as Record<string, unknown>;
    for (const [k, v] of Object.entries(src)) {
      if (known.has(k) || k === 'fields') continue;
      if (t.fields.some((d) => d.key === k)) fields[k] = v;
      else ignored.push(k);
    }
    if (ignored.length) warnings.push(`ignored properties: ${ignored.join(', ')}`);
    out.push({ type: t.slug, title, aliases: listify(fm.aliases ?? fm.alias), tags: listify(fm.tags ?? fm.tag), status: STATUSES.has(String(fm.status)) ? (fm.status as Page['status']) : 'draft', fields, body, source: f.path, warnings });
  }
  return out;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function parseCsvImport(text: string, types: EntityType[], typeSlug: string): ImportItem[] {
  const t = matchType(types, typeSlug);
  if (!t) throw badRequest(`unknown type "${typeSlug}"`);
  const [head, ...rows] = parseCsv(text);
  if (!head) throw badRequest('empty CSV');
  const cols = head.map((h) => h.trim());
  if (!cols.some((c) => c.toLowerCase() === 'title')) throw badRequest('CSV needs a "title" column');
  return rows.map((r, i) => {
    const get = (name: string) => r[cols.findIndex((c) => c.toLowerCase() === name)] ?? '';
    const fields: Record<string, unknown> = {};
    const warnings: string[] = [];
    cols.forEach((c, k) => {
      if (['title', 'aliases', 'tags', 'status', 'body', 'type'].includes(c.toLowerCase()) || r[k] === undefined || r[k] === '') return;
      const d = t.fields.find((f) => f.key === c || titleKey(f.label) === titleKey(c));
      if (d) fields[d.key] = d.type === 'multiselect' || d.multiple ? listify(r[k]) : r[k];
      else warnings.push(`unknown column "${c}" ignored`);
    });
    const st = get('status');
    return { type: t.slug, title: get('title').trim(), aliases: listify(get('aliases')), tags: listify(get('tags')), status: STATUSES.has(st) ? (st as Page['status']) : 'draft', fields, body: get('body'), source: `row ${i + 2}`, warnings: get('title').trim() ? warnings : ['missing title'] , action: get('title').trim() ? undefined : 'skip' };
  });
}
