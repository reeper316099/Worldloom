import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { diffLines } from 'diff';
import { z } from 'zod';
import {
  EntityTypesFileSchema, RelationsFileSchema, WorldSchema, PageMetaSchema, RevisionSchema, WORLD_SCHEMA_VERSION,
  coerceFields, FieldError, slugify, titleKey,
  type EntityType, type Page, type Revision, type World,
} from '@worldloom/shared';
import { JsonFile, atomicWrite, watchDir, withLock, zipBackup } from '@worldloom/jsonstore';
import { escapeHtml, extractLinks, extractSection, redact, render, rewriteLinks, type LinkResolution, type RenderResult, type WikiLink } from '@worldloom/wikisyntax';
import { badRequest, conflict, notFound } from './errors';
import { parsePageFile, serializePage, PageFileError } from './pagefile';
import { defaultEntityTypes } from './seed';
import { SearchIndex, snippet, type SearchDoc } from './search';
import { buildInfobox, infoboxHtml, resolveField, type Infobox } from './infobox';
import { pageVisible, revealOk, type Viewer } from './visibility';
import type { FSWatcher } from 'chokidar';

const sha = (s: string) => crypto.createHash('sha1').update(s).digest('hex');
const newId = () => 'p_' + crypto.randomBytes(7).toString('hex');
const tsName = (d = new Date()) => d.toISOString().replace(/:/g, '-');

export interface RepoOptions {
  revisionDebounceMs?: number;
  watch?: boolean;
}
export interface Tx {
  id: string;
  label: string;
  files: Array<{ file: string; before: string | null }>;
}
export interface PageInput {
  type?: string; title?: string; slug?: string; aliases?: string[]; status?: Page['status']; tags?: string[];
  categories?: string[]; fields?: Record<string, unknown>; appliesTo?: Page['appliesTo']; reveal?: Page['reveal'];
  dmOnly?: boolean; redirectsTo?: string; body?: string;
}

export class WorldRepo {
  readonly events = new EventEmitter();
  world!: World;
  types!: EntityType[];
  pages = new Map<string, Page>();
  private worldFile!: JsonFile<World>;
  private typesFile!: JsonFile<z.infer<typeof EntityTypesFileSchema>>;
  relationsFile!: JsonFile<z.infer<typeof RelationsFileSchema>>;
  private fileOf = new Map<string, string>(); // id -> abs file
  private idOf = new Map<string, string>(); // abs file -> id
  private hashOf = new Map<string, string>(); // abs file -> content hash
  private titleMap = new Map<string, string[]>();
  private aliasMap = new Map<string, string[]>();
  private namesDirty = true;
  private nameSig = new Map<string, string>();
  private linkNames = new Map<string, Array<{ name: string; type?: string }>>();
  private inboundCache?: Map<string, Set<string>>;
  private version = 0; // bumps on any page change
  private progressVersion = 0;
  private search = new SearchIndex();
  private readerIdx = new Map<string, { stamp: string; idx: SearchIndex }>();
  private txs: Tx[] = [];
  private claimCache = new Map<string, { stamp: string; claims: RenderResult['claims']; citations: number }>();
  private watcher?: FSWatcher;
  fileErrors = new Map<string, { message: string; line?: number }>();

  constructor(
    readonly dir: string,
    private opts: RepoOptions = {},
  ) {}

  get slug() {
    return this.world.slug;
  }
  private p(...s: string[]) {
    return path.join(this.dir, ...s);
  }

  // ---------- lifecycle ----------
  async open(): Promise<this> {
    const backupDir = this.p('..', '..', 'backups', 'files', path.basename(this.dir));
    this.worldFile = new JsonFile(this.p('world.json'), { schema: WorldSchema, version: WORLD_SCHEMA_VERSION, backupDir });
    this.typesFile = new JsonFile(this.p('schema', 'entity-types.json'), {
      schema: EntityTypesFileSchema, version: 1, backupDir, defaults: () => ({ schemaVersion: 1, types: defaultEntityTypes() }),
    });
    this.relationsFile = new JsonFile(this.p('relations.json'), {
      schema: RelationsFileSchema, version: 1, backupDir, defaults: () => ({ schemaVersion: 1, relations: [] }),
    });
    this.world = await this.worldFile.load();
    this.types = (await this.typesFile.load()).types;
    await this.relationsFile.load();
    await fs.mkdir(this.p('pages'), { recursive: true });
    for (const f of await this.scanPages()) await this.ingestFile(f, true);
    if (this.opts.watch) this.startWatching();
    return this;
  }
  async close() {
    await this.watcher?.close();
  }
  private async scanPages(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string) => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) await walk(f);
        else if (e.name.endsWith('.md')) out.push(f);
      }
    };
    await walk(this.p('pages'));
    return out;
  }
  private startWatching() {
    this.watcher = watchDir(this.dir, (e) => {
      const rel = path.relative(this.dir, e.file).split(path.sep);
      if (rel[0] === 'pages' && e.file.endsWith('.md')) {
        void (e.kind === 'unlink' ? this.removeFile(e.file) : this.ingestFile(e.file));
      } else if (rel.length === 1 && rel[0] === 'world.json') void this.reloadWorld();
      else if (rel.join('/') === 'schema/entity-types.json') void this.reloadTypes();
    });
  }
  private async reloadWorld() {
    try {
      const text = await fs.readFile(this.worldFile.file, 'utf8');
      const w = this.worldFile.parse(text);
      this.world = w;
      this.progressVersion++;
      this.events.emit('event', { type: 'world-changed' });
    } catch (e) {
      this.events.emit('event', { type: 'file-error', file: 'world.json', message: (e as Error).message });
    }
  }
  private async reloadTypes() {
    try {
      this.types = this.typesFile.parse(await fs.readFile(this.typesFile.file, 'utf8')).types;
      this.events.emit('event', { type: 'types-changed' });
    } catch (e) {
      this.events.emit('event', { type: 'file-error', file: 'schema/entity-types.json', message: (e as Error).message });
    }
  }

  // ---------- file <-> memory ----------
  /** Load a page file into memory. Invalid files never clobber the in-memory page. */
  async ingestFile(file: string, initial = false): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      return this.removeFile(file);
    }
    const h = sha(text);
    if (this.hashOf.get(file) === h) return;
    let page: Page;
    try {
      page = parsePageFile(text);
    } catch (e) {
      const err = { message: (e as Error).message, line: e instanceof PageFileError ? e.line : undefined };
      this.fileErrors.set(file, err);
      this.events.emit('event', { type: 'file-error', file: path.relative(this.dir, file), ...err });
      return;
    }
    const clash = this.fileOf.get(page.id);
    if (clash && clash !== file && this.idOf.get(clash) === page.id) {
      const msg = `duplicate page id ${page.id} (also in ${path.relative(this.dir, clash)})`;
      this.fileErrors.set(file, { message: msg });
      this.events.emit('event', { type: 'file-error', file: path.relative(this.dir, file), message: msg });
      return;
    }
    this.fileErrors.delete(file);
    this.hashOf.set(file, h);
    const prevId = this.idOf.get(file);
    if (prevId && prevId !== page.id) this.dropMemory(prevId);
    this.idOf.set(file, page.id);
    this.fileOf.set(page.id, file);
    this.putMemory(page);
    if (!initial) this.events.emit('event', { type: 'page-changed', id: page.id });
  }
  private async removeFile(file: string) {
    const id = this.idOf.get(file);
    this.hashOf.delete(file);
    this.fileErrors.delete(file);
    this.idOf.delete(file);
    if (id && this.fileOf.get(id) === file) {
      this.fileOf.delete(id);
      this.dropMemory(id);
      this.events.emit('event', { type: 'page-removed', id });
    }
  }
  private putMemory(page: Page) {
    this.pages.set(page.id, page);
    const sig = [page.type, page.title, page.aliases.join('\u0001'), page.redirectsTo ?? ''].join('\u0000');
    if (this.nameSig.get(page.id) !== sig) {
      this.nameSig.set(page.id, sig);
      this.namesDirty = true;
    }
    this.linkNames.set(page.id, this.computeLinkNames(page));
    this.search.upsert(this.searchDoc(page, page.body));
    this.version++;
    this.inboundCache = undefined;
  }
  private dropMemory(id: string) {
    this.pages.delete(id);
    this.nameSig.delete(id);
    this.linkNames.delete(id);
    this.search.remove(id);
    this.namesDirty = true;
    this.version++;
    this.inboundCache = undefined;
  }
  private searchDoc(p: Page, body: string): SearchDoc {
    const headings = [...body.matchAll(/^#{1,6}[ \t]+(.+)$/gm)].map((m) => m[1]).join(' ');
    const sources = [...body.matchAll(/\{\{\s*src\s*:\s*([^{}\n]*?)\s*\}\}/g)].map((m) => m[1]).join(' ');
    return {
      id: p.id, title: p.title, aliases: p.aliases.join(' '), headings, body, tags: p.tags.join(' '),
      type: p.type, status: p.status, appliesTo: p.appliesTo, sources,
    };
  }
  private computeLinkNames(p: Page, body = p.body, hideField?: (key: string, raw: unknown) => boolean) {
    const out: Array<{ name: string; type?: string }> = extractLinks(body).filter((l) => l.name).map((l) => ({ name: l.name, type: l.type }));
    const t = this.types?.find((x) => x.slug === p.type);
    for (const d of t?.fields ?? []) {
      if (d.type !== 'relation') continue;
      const raw = p.fields[d.key];
      if (raw === undefined || (hideField && hideField(d.key, raw))) continue;
      const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { value?: unknown }).value : raw;
      for (const n of Array.isArray(v) ? v : v ? [v] : []) out.push({ name: String(n), type: d.relationTo });
    }
    return out;
  }

  // ---------- names / links ----------
  private rebuildNames() {
    this.titleMap.clear();
    this.aliasMap.clear();
    const add = (m: Map<string, string[]>, k: string, id: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(id);
    const sorted = [...this.pages.values()].sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
    for (const p of sorted) {
      add(this.titleMap, titleKey(p.title), p.id);
      for (const a of p.aliases) add(this.aliasMap, titleKey(a), p.id);
    }
    this.namesDirty = false;
  }
  /** Resolve a link name (title > alias), optionally constrained by type slug/name; follows redirects. */
  resolve(name: string, type?: string, depth = 0): Page | undefined {
    if (this.namesDirty) this.rebuildNames();
    const k = titleKey(name);
    const typeOk = (id: string) => {
      if (!type) return true;
      const p = this.pages.get(id)!;
      const t = this.types.find((x) => x.slug === p.type);
      const want = titleKey(type);
      return p.type === want || titleKey(t?.name ?? '') === want || slugify(type) === p.type;
    };
    const ids = [...(this.titleMap.get(k) ?? []), ...(this.aliasMap.get(k) ?? [])].filter(typeOk);
    const page = ids.length ? this.pages.get(ids[0]!) : undefined;
    if (page?.redirectsTo && depth < 5) return this.resolve(page.redirectsTo, undefined, depth + 1) ?? page;
    return page;
  }
  /** Look up by id, then slug (if unambiguous), then title/alias. */
  findPage(ref: string): Page | undefined {
    const byId = this.pages.get(ref);
    if (byId) return byId;
    const bySlug = [...this.pages.values()].filter((p) => p.slug === ref);
    if (bySlug.length === 1) return bySlug[0];
    return this.resolve(ref);
  }
  typeOf(p: Page) {
    return this.types.find((t) => t.slug === p.type);
  }
  private inbound(): Map<string, Set<string>> {
    if (this.inboundCache) return this.inboundCache;
    const m = new Map<string, Set<string>>();
    for (const [from, links] of this.linkNames) {
      for (const l of links) {
        const t = this.resolve(l.name, l.type);
        if (t && t.id !== from) (m.get(t.id) ?? m.set(t.id, new Set()).get(t.id)!).add(from);
      }
    }
    return (this.inboundCache = m);
  }

  // ---------- viewer ----------
  viewer(q: { mode?: string; player?: string | boolean; hideTitles?: boolean }): Viewer {
    const w = this.world;
    return {
      mode: q.mode === 'author' ? 'author' : 'reader',
      player: q.player === true || q.player === '1' || q.player === 'true',
      hideTitles: !!q.hideTitles,
      progress: w.progress, arcs: w.arcs, sources: w.sources,
      primarySourceIds: w.sources.filter((s) => w.continuities.find((c) => c.id === s.continuityId)?.isPrimary).map((s) => s.id),
    };
  }
  private stubTitle(v: Viewer, p: Page) {
    return v.hideTitles ? '???' : p.title;
  }

  // ---------- reading ----------
  private resolverFor(v: Viewer) {
    return (l: WikiLink): LinkResolution => {
      const t = l.name ? this.resolve(l.name, l.type) : undefined;
      const section = l.section ? '#' + 'h-' + slugify(l.section) : '';
      if (!l.name) return { href: section || '#', exists: true };
      if (!t) return { href: `#/w/${this.slug}/new?title=${encodeURIComponent(l.name)}`, exists: false };
      if (!pageVisible(v, t)) return { href: '#', exists: true, hidden: true, title: this.stubTitle(v, t) };
      return { href: `#/w/${this.slug}/p/${t.slug}${section}`, exists: true, title: t.title };
    };
  }
  private renderOpts(v: Viewer, p: Page, continuity: string | undefined, depth = 0) {
    const resolveLink = this.resolverFor(v);
    const sources = this.world.sources;
    return {
      resolveLink,
      continuity,
      hideDm: v.mode === 'reader' && v.player,
      isRevealed: (r: Parameters<typeof revealOk>[1], key: string) => revealOk(v, r, `${p.id}:${key}`),
      resolveCitation: (text: string) => {
        const t = text.toLowerCase();
        const s = sources.find((x) => t.includes(x.name.toLowerCase()) || t.startsWith(x.id.toLowerCase() + ' '));
        return s ? { label: `${s.name} · ${text.replace(new RegExp('^' + s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '')}`.replace(/ · $/, ''), sourceId: s.id } : { label: text };
      },
      infobox: () => {
        const box = buildInfobox(p, this.typeOf(p), v, continuity);
        return infoboxHtml(box, (title) => {
          const t = this.resolve(title);
          if (!t) return undefined;
          const vis = pageVisible(v, t);
          return `<a class="wikilink${vis ? '' : ' gated'}" href="${vis ? escapeHtml(`#/w/${this.slug}/p/${t.slug}`) : '#'}">${escapeHtml(vis ? t.title : this.stubTitle(v, t))}</a>`;
        });
      },
      embed: (l: WikiLink) => {
        const t = l.name ? this.resolve(l.name, l.type) : undefined;
        if (!t || depth >= 3 || !pageVisible(v, t)) return undefined;
        const src = l.section ? extractSection(t.body, l.section) : t.body;
        if (src === undefined) return undefined;
        return `<div class="embed">${render(src, this.renderOpts(v, t, continuity, depth + 1)).html}</div>`;
      },
    };
  }
  /** Rendered page view, spoiler-filtered server-side. */
  view(ref: string, v: Viewer, continuity?: string) {
    const p = this.findPage(ref);
    if (!p) throw notFound('page');
    if (!pageVisible(v, p)) {
      return { id: p.id, hidden: true as const, title: this.stubTitle(v, p), message: "You haven't reached this yet", slug: v.hideTitles ? p.id : p.slug };
    }
    // the UI shows the infobox as a sticky card, so the inline {{infobox}} marker renders empty here
    const r = render(p.body, { ...this.renderOpts(v, p, continuity), infobox: () => '' });
    const t = this.typeOf(p);
    const infobox: Infobox = buildInfobox(p, t, v, continuity);
    return {
      hidden: false as const,
      id: p.id, title: p.title, slug: p.slug, type: p.type, typeName: t?.name ?? p.type, status: p.status,
      aliases: p.aliases, tags: p.tags, categories: this.categoriesOf(p), appliesTo: p.appliesTo,
      appliesToSelected: continuity === undefined || p.appliesTo === 'all' || p.appliesTo.includes(continuity),
      redirectsTo: p.redirectsTo, dmOnly: p.dmOnly, reveal: v.mode === 'author' ? p.reveal : undefined,
      html: r.html, headings: r.headings, infobox, claims: r.claims, hiddenBlocks: v.mode === 'author' ? [] : r.hiddenBlocks.length,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    };
  }
  /** Live preview of unsaved Markdown (author view) for the editor. */
  preview(body: string, pageId?: string, continuity?: string) {
    const base = pageId ? this.pages.get(pageId) : undefined;
    const now = new Date().toISOString();
    const p: Page = { ...(base ?? { id: 'preview', type: 'concept', title: 'Preview', slug: 'preview', aliases: [], status: 'draft', tags: [], categories: [], fields: {}, appliesTo: 'all', dmOnly: false, createdAt: now, updatedAt: now }), body };
    const v = this.viewer({ mode: 'author' });
    const r = render(body, { ...this.renderOpts(v, p, continuity), infobox: () => '' });
    return { html: r.html, headings: r.headings, claims: r.claims };
  }
  categoriesOf(p: Page) {
    const t = this.typeOf(p);
    return [...new Set([t?.name ?? p.type, ...p.categories])];
  }
  /** Raw page for editing (author mode only). */
  raw(ref: string): Page {
    const p = this.findPage(ref);
    if (!p) throw notFound('page');
    return p;
  }

  list(v: Viewer, f: { type?: string; tag?: string; category?: string; status?: string; sort?: string; order?: string; offset?: number; limit?: number; cont?: string }) {
    let items = [...this.pages.values()];
    if (f.type) items = items.filter((p) => p.type === f.type);
    if (f.tag) items = items.filter((p) => p.tags.includes(f.tag!));
    if (f.status) items = items.filter((p) => p.status === f.status);
    if (f.category) items = items.filter((p) => this.categoriesOf(p).some((c) => titleKey(c) === titleKey(f.category!)));
    if (f.cont) items = items.filter((p) => p.appliesTo === 'all' || p.appliesTo.includes(f.cont!));
    const key = f.sort === 'updated' ? (p: Page) => p.updatedAt : f.sort === 'created' ? (p: Page) => p.createdAt : (p: Page) => p.title.toLowerCase();
    items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    if (f.order === 'desc') items.reverse();
    const total = items.length;
    const page = items.slice(f.offset ?? 0, (f.offset ?? 0) + (f.limit ?? 100));
    return {
      total,
      items: page.map((p) =>
        pageVisible(v, p)
          ? { id: p.id, title: p.title, slug: p.slug, type: p.type, status: p.status, tags: p.tags, aliases: p.aliases, updatedAt: p.updatedAt, hidden: false as const }
          : { id: p.id, title: this.stubTitle(v, p), slug: v.hideTitles ? p.id : p.slug, hidden: true as const },
      ),
    };
  }

  categories(v: Viewer) {
    const m = new Map<string, number>();
    for (const p of this.pages.values()) if (pageVisible(v, p)) for (const c of this.categoriesOf(p)) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Pages that link here. Reader mode: only visible sources, and only links in visible content. */
  backlinks(ref: string, v: Viewer) {
    const target = this.findPage(ref);
    if (!target) throw notFound('page');
    if (!pageVisible(v, target)) return [];
    const out: Array<{ id: string; title: string; slug: string; type: string }> = [];
    for (const fromId of this.inbound().get(target.id) ?? []) {
      const from = this.pages.get(fromId)!;
      if (!pageVisible(v, from)) continue;
      if (v.mode === 'reader') {
        const red = redact(from.body, { hideDm: v.player, isRevealed: (r, key) => revealOk(v, r, `${from.id}:${key}`) });
        const names = this.computeLinkNames(from, red, (k, raw) => resolveField(raw, undefined, v, `${from.id}.${k}`).hidden);
        if (!names.some((l) => this.resolve(l.name, l.type)?.id === target.id)) continue;
      }
      out.push({ id: from.id, title: from.title, slug: from.slug, type: from.type });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  // ---------- search ----------
  /** Spoiler-filtered text with links flattened to display text (hidden targets masked per hideTitles). */
  private readerText(p: Page, v: Viewer): string {
    const red = redact(p.body, { hideDm: v.player, isRevealed: (r, k) => revealOk(v, r, `${p.id}:${k}`) });
    const res = this.resolverFor(v);
    let out = '';
    let pos = 0;
    for (const l of extractLinks(red)) {
      const r = res(l);
      const shown = r.hidden ? (r.title ?? '???') : (l.label ?? (l.name || l.section || ''));
      out += red.slice(pos, l.start) + shown;
      pos = l.end;
    }
    return out + red.slice(pos);
  }
  private readerIndex(v: Viewer): SearchIndex {
    const key = `${v.player ? 'player' : 'reader'}:${v.hideTitles ? 'h' : 's'}`;
    const stamp = `${this.version}:${this.progressVersion}`;
    const hit = this.readerIdx.get(key);
    if (hit?.stamp === stamp) return hit.idx;
    const idx = new SearchIndex();
    for (const p of this.pages.values()) {
      if (!pageVisible(v, p)) continue;
      idx.upsert(this.searchDoc(p, this.readerText(p, v)));
    }
    this.readerIdx.set(key, { stamp, idx });
    return idx;
  }
  searchPages(q: string, v: Viewer, limit = 25) {
    const idx = v.mode === 'author' ? this.search : this.readerIndex(v);
    return idx.search(q, limit).map(({ id, score }) => {
      const p = this.pages.get(id)!;
      const body = v.mode === 'author' ? p.body : this.readerText(p, v);
      return { id, title: p.title, slug: p.slug, type: p.type, score, snippet: snippet(body, q) };
    });
  }
  /** Quick-open / autocomplete: title+alias prefix matches (visible pages only in reader mode). */
  suggest(prefix: string, v: Viewer, limit = 10) {
    const k = titleKey(prefix);
    const out: Array<{ id: string; title: string; slug: string; type: string; alias?: string }> = [];
    for (const p of this.pages.values()) {
      if (!pageVisible(v, p)) continue;
      if (titleKey(p.title).includes(k)) out.push({ id: p.id, title: p.title, slug: p.slug, type: p.type });
      else {
        const a = p.aliases.find((x) => titleKey(x).includes(k));
        if (a) out.push({ id: p.id, title: p.title, slug: p.slug, type: p.type, alias: a });
      }
      if (out.length >= limit * 4) break;
    }
    out.sort((a, b) => Number(titleKey(b.title).startsWith(k)) - Number(titleKey(a.title).startsWith(k)) || a.title.localeCompare(b.title));
    return out.slice(0, limit);
  }

  // ---------- writing ----------
  private pageFile(p: Pick<Page, 'type' | 'slug'>) {
    return this.p('pages', p.type, `${p.slug}.md`);
  }
  private uniqueSlug(type: string, base: string, exceptId?: string) {
    let s = base;
    for (let i = 2; [...this.pages.values()].some((p) => p.type === type && p.slug === s && p.id !== exceptId); i++) s = `${base}-${i}`;
    return s;
  }
  private assertTitleFree(type: string, title: string, exceptId?: string) {
    const k = titleKey(title);
    if ([...this.pages.values()].some((p) => p.type === type && p.id !== exceptId && titleKey(p.title) === k)) {
      throw conflict(`a ${type} page titled "${title}" already exists`);
    }
  }
  private coerce(type: string, fields: Record<string, unknown>) {
    const t = this.types.find((x) => x.slug === type);
    if (!t) throw badRequest(`unknown entity type "${type}"`);
    try {
      return coerceFields(t.fields, fields);
    } catch (e) {
      if (e instanceof FieldError) throw badRequest(e.message);
      throw e;
    }
  }
  private async persist(page: Page, tx?: Tx, recordRevision = true, summary = '') {
    const file = this.pageFile(page);
    const prevFile = this.fileOf.get(page.id);
    await withLock(`world:${this.dir}`, async () => {
      if (tx) {
        await this.recordBefore(tx, file);
        if (prevFile && prevFile !== file) await this.recordBefore(tx, prevFile);
      }
      const text = serializePage(page);
      await atomicWrite(file, text);
      if (prevFile && prevFile !== file) {
        await fs.rm(prevFile, { force: true });
        this.hashOf.delete(prevFile);
        this.idOf.delete(prevFile);
      }
      this.hashOf.set(file, sha(text));
      this.idOf.set(file, page.id);
      this.fileOf.set(page.id, file);
      this.fileErrors.delete(file);
      this.putMemory(page);
    });
    if (recordRevision) await this.writeRevision(page, summary);
    this.events.emit('event', { type: 'page-changed', id: page.id });
  }
  private async recordBefore(tx: Tx, file: string) {
    if (tx.files.some((f) => f.file === file)) return;
    let before: string | null = null;
    try {
      before = await fs.readFile(file, 'utf8');
    } catch {
      /* new file */
    }
    tx.files.push({ file, before });
  }
  beginTx(label: string): Tx {
    return { id: 'tx_' + crypto.randomBytes(5).toString('hex'), label, files: [] };
  }
  async commitTx(tx: Tx) {
    this.txs.push(tx);
    if (this.txs.length > 20) this.txs.shift();
    await atomicWrite(this.p('history', '_tx', `${tx.id}.json`), JSON.stringify(tx));
    return tx.id;
  }
  async undoTx(id: string) {
    let tx = this.txs.find((t) => t.id === id);
    if (!tx) {
      try {
        tx = JSON.parse(await fs.readFile(this.p('history', '_tx', `${id}.json`), 'utf8')) as Tx;
      } catch {
        throw notFound('transaction');
      }
    }
    await withLock(`world:${this.dir}`, async () => {
      for (const f of [...tx!.files].reverse()) {
        if (f.before === null) await fs.rm(f.file, { force: true });
        else await atomicWrite(f.file, f.before);
      }
    });
    for (const f of tx.files) await this.ingestFile(f.file);
    await fs.rm(this.p('history', '_tx', `${id}.json`), { force: true });
    this.txs = this.txs.filter((t) => t.id !== id);
    return tx.files.length;
  }

  async create(input: PageInput, o: { template?: boolean } = {}): Promise<Page> {
    if (!input.type || !input.title) throw badRequest('type and title are required');
    const type = this.types.find((t) => t.slug === input.type);
    if (!type) throw badRequest(`unknown entity type "${input.type}"`);
    this.assertTitleFree(input.type, input.title);
    const now = new Date().toISOString();
    const page = PageMetaSchema.parse({
      id: newId(), type: input.type, title: input.title.trim(), slug: this.uniqueSlug(input.type, input.slug ?? slugify(input.title)),
      aliases: input.aliases ?? [], status: input.status ?? 'stub', tags: input.tags ?? [], categories: input.categories ?? [],
      fields: this.coerce(input.type, input.fields ?? {}), appliesTo: input.appliesTo ?? 'all', reveal: input.reveal, dmOnly: input.dmOnly ?? false,
      redirectsTo: input.redirectsTo, createdAt: now, updatedAt: now,
    }) as Page;
    page.body = input.body || (o.template ? type.bodyTemplate : '');
    await this.persist(page, undefined, true, 'created');
    return page;
  }

  async patch(id: string, input: PageInput, summary = 'edited'): Promise<Page> {
    const cur = this.pages.get(id);
    if (!cur) throw notFound('page');
    if (input.type && input.type !== cur.type) throw badRequest('use move to change type');
    if (input.title && input.title !== cur.title) throw badRequest('use rename to change title');
    const next = PageMetaSchema.parse({
      ...cur, ...stripUndef({ ...input, body: undefined, slug: undefined }), id,
      fields: input.fields ? this.coerce(cur.type, input.fields) : cur.fields, updatedAt: new Date().toISOString(),
    }) as Page;
    next.body = input.body ?? cur.body;
    await this.persist(next, undefined, true, summary);
    return next;
  }

  async remove(id: string, tx?: Tx): Promise<void> {
    const p = this.pages.get(id);
    if (!p) throw notFound('page');
    const file = this.fileOf.get(id)!;
    await withLock(`world:${this.dir}`, async () => {
      if (tx) await this.recordBefore(tx, file);
      await fs.rm(file, { force: true });
    });
    await this.removeFile(file);
  }
  async bulkDelete(ids: string[]) {
    if (ids.length >= 2) await this.backup('pre-bulk-delete');
    const tx = this.beginTx(`delete ${ids.length} pages`);
    for (const id of ids) await this.remove(id, tx);
    return this.commitTx(tx);
  }
  async backup(reason: string) {
    return zipBackup(this.dir, this.p('..', '..', 'backups', this.slug), { reason, exclude: ['history'] }).catch(() => undefined);
  }

  /** Rename with optional link rewrite; one undoable transaction. */
  async rename(id: string, newTitle: string, o: { links?: 'rewrite' | 'redirect' | 'none' } = {}) {
    const page = this.pages.get(id);
    if (!page) throw notFound('page');
    const title = newTitle.trim();
    if (!title) throw badRequest('title required');
    if (titleKey(title) === titleKey(page.title) && title === page.title) return { txId: undefined, changed: [] as string[] };
    this.assertTitleFree(page.type, title, id);
    const mode = o.links ?? 'rewrite';
    const oldKey = titleKey(page.title);
    const tx = this.beginTx(`rename ${page.title} → ${title}`);
    const changed: string[] = [];
    if (mode === 'rewrite') {
      for (const other of [...this.pages.values()]) {
        let body = other.body;
        let fields = other.fields;
        let touched = false;
        const r = rewriteLinks(body, (l) => (titleKey(l.name) === oldKey && this.resolve(l.name, l.type)?.id === id ? { name: title } : undefined));
        if (r.changed) {
          body = r.source;
          touched = true;
        }
        const ot = this.typeOf(other);
        for (const d of ot?.fields ?? []) {
          if (d.type !== 'relation') continue;
          const raw = fields[d.key];
          const swap = (x: unknown) => (typeof x === 'string' && titleKey(x) === oldKey && this.resolve(x, d.relationTo)?.id === id ? title : x);
          let nv: unknown = raw;
          if (Array.isArray(raw)) nv = raw.map(swap);
          else if (typeof raw === 'string') nv = swap(raw);
          if (JSON.stringify(nv) !== JSON.stringify(raw)) {
            fields = { ...fields, [d.key]: nv };
            touched = true;
          }
        }
        if (touched && other.id !== id) {
          await this.persist({ ...other, body, fields, updatedAt: new Date().toISOString() }, tx, true, `link update: ${page.title} → ${title}`);
          changed.push(other.id);
        } else if (touched) {
          page.body = body;
          page.fields = fields;
        }
      }
    }
    const aliases = mode === 'redirect' && !page.aliases.some((a) => titleKey(a) === oldKey) ? [...page.aliases, page.title] : page.aliases;
    const cur = this.pages.get(id)!;
    const renamed: Page = { ...cur, body: page.body, fields: page.fields, title, aliases, slug: this.uniqueSlug(cur.type, slugify(title), id), updatedAt: new Date().toISOString() };
    await this.persist(renamed, tx, true, `renamed from ${cur.title}`);
    changed.push(id);
    const txId = await this.commitTx(tx);
    return { txId, changed };
  }

  // ---------- world config ----------
  async updateWorld(fn: (w: World) => void) {
    this.world = await this.worldFile.update((w) => {
      fn(w);
    });
    this.progressVersion++;
    this.events.emit('event', { type: 'world-changed' });
    return this.world;
  }
  /** Pages/config that still reference a continuity, source or arc id. */
  references(kind: 'continuity' | 'source' | 'arc', id: string): string[] {
    const out: string[] = [];
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodyRe = kind === 'continuity' ? new RegExp(`ids="(?:[^"]*,)?\\s*${esc}\\s*(?:,[^"]*)?"`) : new RegExp(`${kind === 'source' ? 'src' : 'arc'}="${esc}"`);
    const keyRe = kind === 'source' ? `"sourceId":"${id}"` : kind === 'arc' ? `"arcId":"${id}"` : `"${id}":`;
    for (const p of this.pages.values()) {
      const hit =
        (kind === 'continuity' && p.appliesTo !== 'all' && p.appliesTo.includes(id)) ||
        bodyRe.test(p.body) ||
        (kind !== 'continuity' && JSON.stringify([p.reveal, p.fields]).includes(keyRe)) ||
        (kind === 'continuity' && JSON.stringify(p.fields).includes(`"byContinuity":{`) && JSON.stringify(p.fields).includes(keyRe));
      if (hit) out.push(p.title);
    }
    return out;
  }

  /** Replace continuities / sources / arcs with integrity checks (no dangling references). */
  async setCanon(key: 'continuities' | 'sources' | 'arcs', items: World[typeof key]) {
    const w = this.world;
    const next = { continuities: w.continuities, sources: w.sources, arcs: w.arcs, [key]: items } as Pick<World, 'continuities' | 'sources' | 'arcs'>;
    if (!next.continuities.length) throw badRequest('at least one continuity is required');
    const primaries = next.continuities.filter((c) => c.isPrimary).length;
    if (primaries > 1) throw badRequest('only one continuity can be primary');
    if (primaries === 0) next.continuities = next.continuities.map((c, i) => ({ ...c, isPrimary: i === 0 }));
    const cIds = new Set(next.continuities.map((c) => c.id));
    for (const s of next.sources) if (!cIds.has(s.continuityId)) throw key === 'continuities' ? conflict(`continuity "${s.continuityId}" still has sources (e.g. "${s.name}")`) : badRequest(`source "${s.name}" uses unknown continuity "${s.continuityId}"`);
    const sIds = new Set(next.sources.map((s) => s.id));
    for (const a of next.arcs) for (const [sid, r] of Object.entries(a.ranges)) {
      if (!sIds.has(sid)) {
        if (key === 'sources') delete a.ranges[sid]; // cascade: a removed source drops its arc ranges
        else throw badRequest(`arc "${a.name}" has a range for unknown source "${sid}"`);
      } else if (r.from > r.to) throw badRequest(`arc "${a.name}": range start is after its end`);
    }
    const old = { continuities: w.continuities, sources: w.sources, arcs: w.arcs }[key];
    const removed = old.filter((o) => !items.some((n) => n.id === o.id)).map((o) => o.id);
    const kind = key === 'continuities' ? 'continuity' : key === 'sources' ? 'source' : 'arc';
    for (const id of removed) {
      const refs = this.references(kind, id);
      if (key === 'continuities' && w.sources.some((s) => s.continuityId === id)) throw conflict(`continuity "${id}" still has sources`);
      if (key === 'arcs' && w.tierSystems.some((t) => JSON.stringify(t.reveal ?? '').includes(`"${id}"`))) throw conflict(`arc "${id}" gates a tier system`);
      if (refs.length) throw conflict(`"${id}" is still referenced by ${refs.length} page(s): ${refs.slice(0, 5).join(', ')}${refs.length > 5 ? '…' : ''}`);
    }
    return this.updateWorld((x) => {
      x.continuities = next.continuities;
      x.sources = next.sources;
      x.arcs = next.arcs;
      for (const id of removed) {
        if (key === 'sources') delete x.progress.sources[id];
        if (key === 'arcs' && x.progress.arcCheckpoint === id) delete x.progress.arcCheckpoint;
      }
    });
  }

  /** Side-by-side view of one page in two continuities, with an infobox diff. */
  compare(ref: string, v: Viewer, a: string, b: string) {
    const va = this.view(ref, v, a);
    const vb = this.view(ref, v, b);
    if (va.hidden || vb.hidden) return { a: va, b: vb, infobox: [] as Array<{ key: string; label: string; a: unknown; b: unknown; differs: boolean }> };
    const keys = [...new Set([...va.infobox.rows.map((r) => r.key), ...vb.infobox.rows.map((r) => r.key)])];
    const infobox = keys.map((key) => {
      const ra = va.infobox.rows.find((r) => r.key === key);
      const rb = vb.infobox.rows.find((r) => r.key === key);
      return { key, label: (ra ?? rb)!.label, a: ra?.value, b: rb?.value, differs: JSON.stringify(ra?.value) !== JSON.stringify(rb?.value) };
    });
    return { a: va, b: vb, infobox };
  }

  async setTypes(types: EntityType[]) {
    const parsed = EntityTypesFileSchema.parse({ schemaVersion: 1, types });
    await this.typesFile.save(parsed);
    this.types = parsed.types;
    this.events.emit('event', { type: 'types-changed' });
  }

  // ---------- revisions ----------
  private revDir(id: string) {
    return this.p('history', id);
  }
  private async writeRevision(page: Page, summary: string, name?: string) {
    const dir = this.revDir(page.id);
    await fs.mkdir(dir, { recursive: true });
    const existing = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    const debounce = this.opts.revisionDebounceMs ?? 60_000;
    const last = existing[existing.length - 1];
    if (last && !name && debounce > 0) {
      try {
        const prev = JSON.parse(await fs.readFile(path.join(dir, last), 'utf8')) as Revision;
        if (!prev.name && Date.now() - Date.parse(prev.ts) < debounce) await fs.rm(path.join(dir, last), { force: true });
      } catch {
        /* ignore */
      }
    }
    const ts = new Date().toISOString();
    const rev: Revision = { pageId: page.id, ts, summary, name, snapshot: page };
    await atomicWrite(path.join(dir, `${tsName(new Date(ts))}.json`), JSON.stringify(rev));
    await this.compactRevisions(dir);
  }
  /** Keep the newest 30 always, then one per day up to 100 total; named snapshots are never dropped. */
  private async compactRevisions(dir: string) {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort().reverse();
    if (files.length <= 30) return;
    const days = new Set<string>();
    let kept = 0;
    for (const [i, f] of files.entries()) {
      if (i < 30) {
        kept++;
        continue;
      }
      const rev = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as Revision;
      const day = rev.ts.slice(0, 10);
      if (rev.name || (!days.has(day) && kept < 100)) {
        days.add(day);
        kept++;
      } else await fs.rm(path.join(dir, f), { force: true });
    }
  }
  async history(id: string) {
    const dir = this.revDir(id);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort().reverse();
    } catch {
      return [];
    }
    return Promise.all(
      files.map(async (f) => {
        const r = RevisionSchema.parse(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
        return { ts: r.ts, summary: r.summary, name: r.name, title: r.snapshot.title, size: r.snapshot.body.length };
      }),
    );
  }
  async revision(id: string, ts: string): Promise<Revision> {
    try {
      return RevisionSchema.parse(JSON.parse(await fs.readFile(path.join(this.revDir(id), `${tsName(new Date(ts))}.json`), 'utf8')));
    } catch {
      throw notFound('revision');
    }
  }
  async snapshot(id: string, name: string) {
    const p = this.pages.get(id);
    if (!p) throw notFound('page');
    await this.writeRevision(p, 'named snapshot', name);
  }
  async restore(id: string, ts: string) {
    const rev = await this.revision(id, ts);
    const cur = this.pages.get(id);
    if (!cur) throw notFound('page');
    const { body, ...meta } = rev.snapshot;
    const restored: Page = { ...cur, ...meta, id, body, slug: cur.slug, title: cur.title, updatedAt: new Date().toISOString() };
    await this.persist(restored, undefined, true, `restored ${rev.ts}`);
    return restored;
  }
  async diff(id: string, from: string, to: string) {
    const a = await this.revision(id, from);
    const b = to === 'current' ? { snapshot: this.pages.get(id)! } : await this.revision(id, to);
    if (!b.snapshot) throw notFound('page');
    return {
      body: diffLines(a.snapshot.body, b.snapshot.body).map((c) => ({ op: c.added ? 'add' : c.removed ? 'del' : 'eq', text: c.value })),
      meta: diffLines(JSON.stringify({ ...a.snapshot, body: undefined }, null, 1), JSON.stringify({ ...b.snapshot, body: undefined }, null, 1)).filter((c) => c.added || c.removed).map((c) => ({ op: c.added ? 'add' : 'del', text: c.value })),
    };
  }

  // ---------- health ----------
  health() {
    const pages = [...this.pages.values()];
    const inbound = this.inbound();
    const red = new Map<string, { name: string; count: number; from: string[] }>();
    const out = new Map<string, number>();
    for (const [from, links] of this.linkNames) {
      for (const l of links) {
        const t = this.resolve(l.name, l.type);
        if (t) out.set(from, (out.get(from) ?? 0) + 1);
        else {
          const k = titleKey(l.name);
          const e = red.get(k) ?? { name: l.name, count: 0, from: [] };
          e.count++;
          if (!e.from.includes(from)) e.from.push(from);
          red.set(k, e);
        }
      }
    }
    const brief = (p: Page) => ({ id: p.id, title: p.title, slug: p.slug, type: p.type });
    const unsourced: Array<{ id: string; title: string; slug: string; kind: string; text: string }> = [];
    for (const p of pages) {
      const stamp = sha(p.body);
      let c = this.claimCache.get(p.id);
      if (!c || c.stamp !== stamp) {
        const r = render(p.body);
        c = { stamp, claims: r.claims, citations: r.citations.length };
        this.claimCache.set(p.id, c);
      }
      for (const cl of c.claims) if (!cl.cited || cl.kind === 'theory') unsourced.push({ id: p.id, title: p.title, slug: p.slug, kind: cl.kind, text: cl.text.slice(0, 120) });
    }
    const real = pages.filter((p) => !p.redirectsTo);
    return {
      total: real.length,
      completeness: real.length ? Math.round((real.filter((p) => p.status === 'complete').length / real.length) * 100) : 0,
      orphans: real.filter((p) => !inbound.get(p.id)?.size).map(brief),
      deadEnds: real.filter((p) => !out.get(p.id)).map(brief),
      stubs: real.filter((p) => p.status === 'stub').map(brief),
      needsReview: real.filter((p) => p.status === 'draft').map(brief),
      redLinks: [...red.values()].sort((a, b) => b.count - a.count),
      unsourcedClaims: unsourced,
      fileErrors: [...this.fileErrors].map(([f, e]) => ({ file: path.relative(this.dir, f), ...e })),
    };
  }
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

