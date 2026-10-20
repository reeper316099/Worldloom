/**
 * Spoiler leak suite (see docs/SPOILERS.md). Installs the demo worlds with unknown/zero progress and
 * walks EVERY registered GET route as a reader, asserting no gated string appears in any response.
 * Adding a route without classifying it below fails the build.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { unzipSync, strFromU8 } from 'fflate';
import { WorldManager, buildApp } from '../src';
import { SERIES } from '../../../starter-worlds/src/series';
import { CAMPAIGN } from '../../../starter-worlds/src/campaign';
import type { StarterWorld } from '../../../starter-worlds/src/dsl';

type Kind = 'filtered' | 'author-only' | 'safe' | 'skip';
const API = '/api/v1';
const CLASSIFY: Record<string, Kind> = {
  '/healthz': 'safe', [`${API}/settings`]: 'safe', [`${API}/info`]: 'safe', [`${API}/worlds`]: 'safe', [`${API}/starter-worlds`]: 'safe',
  [`${API}/type-packs`]: 'safe', [`${API}/type-packs/:id`]: 'safe', [`${API}/events`]: 'skip',
  [`${API}/worlds/:w`]: 'filtered', [`${API}/worlds/:w/entity-types`]: 'safe', [`${API}/worlds/:w/continuities`]: 'filtered',
  [`${API}/worlds/:w/sources`]: 'filtered', [`${API}/worlds/:w/arcs`]: 'filtered', [`${API}/worlds/:w/progress`]: 'safe',
  [`${API}/worlds/:w/type-pack/export`]: 'safe', [`${API}/worlds/:w/pages`]: 'filtered', [`${API}/worlds/:w/pages/:ref`]: 'filtered',
  [`${API}/worlds/:w/pages/:ref/compare`]: 'filtered', [`${API}/worlds/:w/pages/:ref/raw`]: 'author-only',
  [`${API}/worlds/:w/search`]: 'filtered', [`${API}/worlds/:w/suggest`]: 'filtered', [`${API}/worlds/:w/backlinks/:ref`]: 'filtered',
  [`${API}/worlds/:w/relations`]: 'filtered', [`${API}/worlds/:w/relations/explicit`]: 'author-only', [`${API}/worlds/:w/card/:ref`]: 'filtered',
  [`${API}/worlds/:w/graph`]: 'filtered', [`${API}/worlds/:w/tree`]: 'filtered', [`${API}/worlds/:w/timeline`]: 'filtered',
  [`${API}/worlds/:w/timeline/events`]: 'author-only', [`${API}/worlds/:w/tiers`]: 'filtered', [`${API}/worlds/:w/tiers/:sid/ladder`]: 'filtered',
  [`${API}/worlds/:w/compare`]: 'filtered', [`${API}/worlds/:w/boards`]: 'filtered', [`${API}/worlds/:w/boards/:bid`]: 'filtered',
  [`${API}/worlds/:w/export/:format`]: 'filtered', [`${API}/worlds/:w/encryption`]: 'safe',
  [`${API}/integrations/lorekeeper`]: 'safe', [`${API}/integrations/lorekeeper/search`]: 'safe', [`${API}/sync/folder-files`]: 'safe',
  [`${API}/worlds/:w/categories`]: 'filtered', [`${API}/worlds/:w/health-report`]: 'author-only',
  [`${API}/worlds/:w/history/:ref`]: 'author-only', [`${API}/worlds/:w/history/:ref/diff`]: 'author-only',
  [`${API}/worlds/:w/assets/:name`]: 'skip', // content-addressed binary images; no text
};

let dir: string, app: FastifyInstance, manager: WorldManager;
const pageIdOf = (type: string, title: string) => `st_${type}_${title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d))).replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const req = (method: 'GET' | 'PUT', url: string, body?: unknown) => app.inject({ method, url, headers: { authorization: 'Bearer t' }, payload: body as object });

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-leak-'));
  manager = await new WorldManager(path.join(dir, 'data'), { revisionDebounceMs: 0 }).init();
  app = await buildApp({ token: 't', manager });
  for (const id of ['the-ashen-ascent', 'gloamreach-campaign']) await req('POST' as 'GET', `${API}/starter-worlds/${id}/install`);
});
afterAll(async () => {
  await app.close();
  await manager.close();
});

describe('route classification', () => {
  it('every GET route is classified (new routes must be reviewed for spoiler leaks)', () => {
    const gets = app.routeTable.filter((r) => r.method === 'GET').map((r) => r.url);
    expect(gets.filter((u) => !(u in CLASSIFY)), 'unclassified GET routes').toEqual([]);
    expect(Object.keys(CLASSIFY).filter((u) => !gets.includes(u)), 'stale classifications').toEqual([]);
  });
  it('mutating routes cannot be used to read gated data without author intent', () => {
    const writes = app.routeTable.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url}`);
    // POST/PUT/PATCH responses echo author-owned data; read-like POSTs must be author-gated
    const readLike = writes.filter((w) => /render|compare|diff|sync\/(export|preview)/.test(w));
    // sync/export & sync/preview return world content; they are explicit author actions with their own spoilers flag (tested in sync.test.ts)
    expect(readLike.sort()).toEqual([`POST ${API}/worlds/:w/render`, `POST ${API}/worlds/:w/sync/export`, `POST ${API}/worlds/:w/sync/preview`].sort());
    // boards PUT filters its response per viewer (see boardView) and never echoes hidden pages
  });
});

for (const def of [SERIES, CAMPAIGN] as StarterWorld[]) {
  describe(`leaks: ${def.slug}`, () => {
    const W = `${API}/worlds/${def.slug}`;
    const sources = def.world.sources.map((s) => s.id);
    let pages: Array<{ id: string; slug: string; title: string }> = [];
    const gatedTitles = def.pages.filter((p) => p.reveal || p.dmOnly).map((p) => p.title);

    beforeAll(async () => {
      await req('PUT', `${W}/progress`, { sources: Object.fromEntries(sources.map((s) => [s, 0])), showAll: false });
      await manager.settingsFile.save({ ...manager.settings, hideTitles: true });
      const r = await req('GET', `${W}/pages?mode=author&limit=1000`);
      pages = r.json().items;
      const ids = pages.slice(0, 6).map((p) => p.id).concat(def.pages.filter((p) => p.reveal || p.dmOnly).map((p) => pageIdOf(p.type, p.title)));
      const put = await req('PUT', `${W}/boards/leak-board?mode=author`, { name: 'Leak board', tiers: [{ id: 's', label: 'S', color: '#f00' }, { id: 'a', label: 'A', color: '#0f0' }], placements: { s: ids.slice(0, 4), a: ids.slice(4, 8) }, pool: ids.slice(8) });
      expect(put.statusCode, put.body).toBe(200);
    });
    afterAll(async () => {
      await manager.settingsFile.save({ ...manager.settings, hideTitles: false });
    });

    const passes = [
      { name: 'default mode (reader)', qs: '', secrets: def.spoilerSecrets, titles: gatedTitles.filter((t) => !def.pages.some((p) => p.dmOnly && p.title === t)) },
      { name: 'reader + player view', qs: 'mode=reader&player=1', secrets: def.secrets, titles: gatedTitles },
    ];
    for (const pass of passes) {
      it(`no gated text from any filtered route (${pass.name})`, async () => {
        const urls: string[] = [];
        const hiddenIds = def.pages.filter((p) => p.reveal || p.dmOnly).map((p) => pageIdOf(p.type, p.title));
        const someIds = pages.slice(0, 5).map((p) => p.id);
        for (const [pattern, kind] of Object.entries(CLASSIFY)) {
          if (kind !== 'filtered' || !pattern.includes('/worlds/:w')) continue;
          const base = pattern.replace(':w', def.slug);
          if (base.includes(':ref')) for (const p of pages) for (const ref of [p.slug, p.id]) urls.push(base.replace(':ref', encodeURIComponent(ref)));
          else if (base.includes(':format')) {
            for (const f of ['json', 'markdown', 'html', 'site']) urls.push(base.replace(':format', f));
            for (const t of new Set(def.pages.map((p) => p.type))) urls.push(base.replace(':format', 'csv') + `?type=${t}`);
            for (const p of pages) urls.push(base.replace(':format', 'html') + `?page=${encodeURIComponent(p.slug)}`);
          }
          else if (base.includes(':sid')) for (const t of def.world.tierSystems) for (const a of ['', ...def.world.arcs.map((x) => `?arc=${x.id}`)]) urls.push(base.replace(':sid', t.id) + a);
          else if (base.includes(':bid')) urls.push(base.replace(':bid', 'leak-board'));
          else if (base.endsWith('/tree')) urls.push(`${base}?field=region&type=location`, `${base}?kind=master_student`, `${base}?field=leaders&type=faction`);
          else if (base.endsWith('/compare')) { urls.push(`${base}?ids=${someIds.join(',')}`); for (const h of hiddenIds) urls.push(`${base}?ids=${h},${someIds[0]}`); }
          else if (base.endsWith('/graph')) { urls.push(base); for (const p of pages) urls.push(`${base}?focus=${encodeURIComponent(p.slug)}&hops=3`); }
          else if (base.endsWith('/timeline')) { urls.push(base); for (const p of pages) urls.push(`${base}?page=${encodeURIComponent(p.slug)}`); }
          else urls.push(base);
        }
        // compare + search/suggest need query params
        const extra = ['flame', 'core', 'sister', 'vault', 'key', 'ledger', 'furnace', 'syndicate', 'orrin', 'sable', 'quench', 'crown', 'bell', 'lighthouse', ...pass.secrets.flatMap((s) => s.split(' ').filter((w) => w.length > 5)), ...pass.titles];
        const all: string[] = [];
        const labelled: Array<[string, string]> = [];
        const q = (extraQs: string) => [pass.qs, extraQs].filter(Boolean).join('&');
        for (const u of urls) {
          let qs = q('');
          if (/\/pages\/[^/]+\/compare$/.test(u)) qs = q(`a=${def.world.continuities[0]!.id}&b=${def.world.continuities.at(-1)!.id}`);
          if (u.endsWith('/search') || u.endsWith('/suggest')) {
            for (const term of extra) all.push(decode((await req('GET', `${u}?${q('q=' + encodeURIComponent(term))}`)).body));
            continue;
          }
          const res = await req('GET', u.includes('?') ? `${u}&${qs}` : `${u}${qs ? '?' + qs : ''}`);
          expect(res.statusCode, u).toBeLessThan(500);
          const txt = /\/export\/(markdown|site)/.test(u) ? Object.entries(unzipSync(new Uint8Array(res.rawPayload))).map(([n, d]) => n + '\n' + decode(strFromU8(d))).join('\n') : decode(res.body);
          all.push(txt);
          labelled.push([u, txt]);
        }
        const text = all.join('\n');
        for (const s of [...pass.secrets, ...(def.eventSecrets ?? [])]) expect(text, `LEAK (text): ${s}`).not.toContain(s);
        for (const t of pass.titles) expect(text, `LEAK (title with hideTitles): ${t} in ${labelled.filter(([, x]) => x.includes(t)).map(([u]) => u).slice(0, 3).join(' | ')}`).not.toContain(t);
      });
    }

    it('author-only routes refuse readers', async () => {
      for (const [pattern, kind] of Object.entries(CLASSIFY)) {
        if (kind !== 'author-only') continue;
        const u = pattern.replace(':w', def.slug).replace(':ref', pages[0]!.slug).replace(':sid', 'x');
        for (const qs of ['?from=x', '?mode=reader&from=x', '?mode=reader&player=1&from=x&to=current']) expect((await req('GET', u + qs)).statusCode, u + qs).toBe(403);
      }
    });

    it('SSE events carry only ids, never titles or content', async () => {
      const seen: unknown[] = [];
      const on = (e: unknown) => seen.push(e);
      manager.events.on('event', on);
      const target = pages.find((p) => !gatedTitles.includes(p.title))!;
      await (await manager.get(def.slug)).patch(target.id, { tags: ['leak-test'] });
      manager.events.off('event', on);
      expect(seen.length).toBeGreaterThan(0);
      for (const e of seen) expect(Object.keys(e as object).sort()).toEqual(expect.arrayContaining(['type', 'world']));
      expect(JSON.stringify(seen)).not.toContain(target.title);
    });
  });
}

describe('relations & hover cards', () => {
  const W = `${API}/worlds/the-ashen-ascent`;
  const set = (wn: number) => req('PUT', `${W}/progress`, { sources: { wn, adapt: 0, recap: 0 }, showAll: false });
  const edges = async (qs = '') => (await req('GET', `${W}/relations?mode=reader${qs}`)).json() as { nodes: Array<{ id: string; title: string }>; edges: Array<{ id: string; from: string; to: string; kind: string; label?: string }> };
  const id = (title: string) => SERIES.pages.find((p) => p.title === title) && `st_${SERIES.pages.find((p) => p.title === title)!.type}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  it('gated pages and edges never appear until their gates open', async () => {
    await set(60);
    let r = await edges();
    expect(r.nodes.map((n) => n.title)).not.toContain('Sable');
    expect(JSON.stringify(r)).not.toContain(id('Sable')!);
    await set(200); // Sable's page is visible (arc a4), but the Sable->Kael edge is gated at 210
    r = await edges();
    expect(r.nodes.map((n) => n.title)).toContain('Sable');
    const bound = (x: typeof r) => x.edges.some((e) => e.from === id('Sable') && e.to === id('Kael Marrow') && e.label === 'bound');
    expect(bound(r)).toBe(false); // explicit edge gated at wn 210 (the derived 'enemies' field edge is ungated)
    await set(215);
    r = await edges();
    expect(bound(r)).toBe(true);
    await set(0);
  });
  it('per-continuity explicit edges are filtered', async () => {
    await set(60);
    const wn = await edges('&cont=wn');
    const ad = await edges('&cont=adapt');
    const fam = (r: typeof wn) => r.edges.find((e) => e.from === id('Kael Marrow') && e.to === id('Mira Ashgrove') && e.kind === 'family');
    expect(fam(wn)).toBeTruthy();
    expect(fam(ad)).toBeUndefined();
  });
  it('hover cards are filtered', async () => {
    await set(0);
    const hidden = (await req('GET', `${W}/card/hollow-flame?mode=reader`)).json();
    expect(hidden).toMatchObject({ hidden: true });
    expect(JSON.stringify(hidden)).not.toContain('Secret flame');
    const kael = (await req('GET', `${W}/card/kael-marrow?mode=reader`)).json();
    expect(kael.excerpt).toContain('protagonist');
    expect(JSON.stringify(kael)).not.toContain('splinter of the Cold Furnace');
    expect(kael.rows.some((r: { key: string; value: unknown }) => r.key === 'tier' && r.value === 'Cinder')).toBe(false); // tier is gated behind ch 100
  });
  it('arc names are masked until reached; author mode sees all', async () => {
    await set(10);
    const arcs = (await req('GET', `${W}/arcs?mode=reader`)).json() as Array<{ name: string }>;
    expect(arcs[0]!.name).toBe('Spark in Ashmere');
    expect(arcs.slice(2).every((a) => a.name === '???')).toBe(true);
    expect(JSON.stringify((await req('GET', `${W}?mode=reader`)).json())).not.toContain('Crown of Ash');
    expect(JSON.stringify((await req('GET', `${W}/arcs?mode=author`)).json())).toContain('Crown of Ash');
  });
});
