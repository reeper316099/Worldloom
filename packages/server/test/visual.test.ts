import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';

let dir: string, app: FastifyInstance, manager: WorldManager;
const W = '/api/v1/worlds/the-ashen-ascent';
const call = async (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, body?: unknown) => {
  const r = await app.inject({ method, url: W + url, headers: { authorization: 'Bearer t' }, payload: body as object });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
};
const progress = (wn: number, extra: object = {}) => call('PUT', '/progress', { sources: { wn, adapt: 0, recap: 0 }, showAll: false, ...extra });
const pid = (type: string, title: string) => `st_${type}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-vis-'));
  manager = await new WorldManager(path.join(dir, 'data'), { revisionDebounceMs: 0 }).init();
  app = await buildApp({ token: 't', manager });
  await app.inject({ method: 'POST', url: '/api/v1/starter-worlds/the-ashen-ascent/install', headers: { authorization: 'Bearer t' } });
});
afterAll(async () => {
  await app.close();
  await manager.close();
});

describe('graph', () => {
  it('builds typed edges, filters by type/kind/continuity and focuses N hops', async () => {
    await progress(60);
    const g = (await call('GET', '/graph?mode=reader')).body;
    expect(g.nodes.length).toBeGreaterThan(10);
    expect(g.kinds).toEqual(expect.arrayContaining(['ally', 'enemy', 'master_student']));
    const onlyChars = (await call('GET', '/graph?mode=reader&types=character')).body;
    expect(onlyChars.nodes.every((n: { type: string }) => n.type === 'character')).toBe(true);
    const rivals = (await call('GET', '/graph?mode=reader&kinds=rival')).body;
    expect(rivals.edges.every((e: { kind: string }) => e.kind === 'rival')).toBe(true);
    const one = (await call('GET', '/graph?mode=reader&focus=ilex-thorne&hops=1')).body;
    const two = (await call('GET', '/graph?mode=reader&focus=ilex-thorne&hops=2')).body;
    expect(one.nodes.length).toBeLessThan(two.nodes.length);
    expect(one.nodes.map((n: { id: string }) => n.id)).toContain(pid('character', 'Ilex Thorne'));
  });
  it('time-bounded edges end at their arc', async () => {
    await progress(0, { showAll: true });
    const has = async (arc: string) => (await call('GET', `/graph?mode=reader&arc=${arc}`)).body.edges.some((e: { from: string; to: string; origin: string }) => e.origin === 'explicit' && e.from === pid('character', 'Dovan Reth') && e.to === pid('character', 'Lady Corvane'));
    expect(await has('a2')).toBe(true);
    expect(await has('a4')).toBe(true);
    expect(await has('a5')).toBe(false);
    await progress(0);
  });
  it('a few hundred extra nodes do not slow the graph (5,000 nodes are covered in perf.test.ts)', async () => {
    const repo = await manager.get('the-ashen-ascent');
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) ids.push((await repo.create({ type: 'character', title: `Perf ${i}`, status: 'draft', fields: i > 0 ? { allies: [`Perf ${Math.floor(i / 2)}`, `Perf ${(i * 7) % i}`] } : {} })).id);
    const t = Date.now();
    const g = (await call('GET', '/graph?mode=author')).body;
    expect(g.nodes.length).toBeGreaterThanOrEqual(300);
    expect(Date.now() - t).toBeLessThan(1500);
    await repo.bulkDelete(ids);
  }, 120_000);
});

describe('tree & breadcrumbs', () => {
  it('builds a location tree from a parent field and a master/student tree from edges', async () => {
    await progress(60);
    const t = (await call('GET', '/tree?mode=reader&field=region&type=location')).body;
    const verrow = t.roots.find((r: { title: string }) => r.title === 'Verrow');
    expect(verrow.children.map((c: { title: string }) => c.title)).toEqual(expect.arrayContaining(['Ashmere', 'Keld Pass']));
    const ms = (await call('GET', '/tree?mode=reader&kind=master_student')).body;
    expect(ms.roots[0].title).toBe('Orrin Vale');
    expect(ms.roots[0].children[0].title).toBe('Kael Marrow');
    expect((await call('GET', '/tree?mode=reader')).status).toBe(400);
  });
  it('page views carry location breadcrumbs, and hidden ancestors cut the chain', async () => {
    const v = (await call('GET', '/pages/the-sunken-forge?mode=reader')).body;
    expect(v.breadcrumbs.map((b: { title: string }) => b.title)).toEqual(['Verrow', 'Ashmere']);
  });
});

describe('timeline', () => {
  it('shows one track per continuity and applies each gate layer independently', async () => {
    await progress(130); // arc a3 reached, Orrin's event gate (wn 140) not yet
    let tl = (await call('GET', '/timeline?mode=reader')).body;
    expect(tl.tracks.map((t: { id: string }) => t.id)).toEqual(['wn', 'adapt']);
    const titles = (r: typeof tl) => r.events.map((e: { title: string }) => e.title);
    expect(titles(tl)).toContain('Orrin retires to Ashmere');
    expect(titles(tl)).not.toContain('Orrin Vale falls at Keld Pass');
    expect(tl.arcs.map((a: { id: string }) => a.id)).toContain('a3');
    await progress(145);
    tl = (await call('GET', '/timeline?mode=reader&cont=wn')).body;
    expect(titles(tl)).toContain('Orrin Vale falls at Keld Pass');
    expect(titles(tl)).not.toContain('Orrin retires to Ashmere'); // adaptation-only track
    expect(titles((await call('GET', '/timeline?mode=reader&page=sable')).body)).toEqual([]);
    expect(titles((await call('GET', '/timeline?mode=reader&arc=a2')).body)).toEqual(['Kael enters the guild trials', 'Kael faces Ilex in Lantern Hall']);
    await progress(0);
  });
  it('an event mentioning a hidden page is hidden even without its own gate', async () => {
    await progress(0);
    const repo = await manager.get('the-ashen-ascent');
    await repo.setTimeline([...(repo.timelineFile.get()!.events), { id: 'ev-x', title: 'Plain title', summary: '', pageIds: [pid('item', 'Crown of Ash')], order: 1, trackId: null }]);
    expect((await call('GET', '/timeline?mode=reader')).body.events.map((e: { id: string }) => e.id)).not.toContain('ev-x');
    expect((await call('GET', '/timeline?mode=author')).body.events.map((e: { id: string }) => e.id)).toContain('ev-x');
  });
  it('validates event writes', async () => {
    expect((await call('PUT', '/timeline/events', [{ id: 'a', title: 'x', order: 1, pageIds: ['nope'] }])).status).toBe(400);
  });
});

describe('tier ladders', () => {
  it('places entities per continuity, honours history by arc, and hides gated tiers', async () => {
    await progress(60);
    const lad = (await call('GET', '/tiers/tempering/ladder?mode=reader')).body;
    expect(lad.tiers.map((t: { name: string }) => t.name)).not.toContain('Zenith'); // tier gated at wn 250
    const where = (r: typeof lad, id: string) => r.tiers.find((t: { entries: Array<{ id: string }> }) => t.entries.some((e) => e.id === id))?.name;
    expect(where(lad, pid('character', 'Orrin Vale'))).toBe('Pyre');
    expect(where(lad, pid('character', 'Kael Marrow'))).toBeUndefined(); // his tier is gated at ch 100
    await progress(0, { showAll: true });
    const a1 = (await call('GET', '/tiers/tempering/ladder?mode=reader&arc=a1')).body;
    const a2 = (await call('GET', '/tiers/tempering/ladder?mode=reader&arc=a2')).body;
    const a3 = (await call('GET', '/tiers/tempering/ladder?mode=reader&arc=a3')).body;
    expect([where(a1, pid('character', 'Kael Marrow')), where(a2, pid('character', 'Kael Marrow')), where(a3, pid('character', 'Kael Marrow'))]).toEqual(['Spark', 'Ember', 'Cinder']);
    const adapt = (await call('GET', '/tiers/tempering/ladder?mode=reader&cont=adapt')).body;
    expect(where(adapt, pid('character', 'Kael Marrow'))).toBe('Ember');
    expect(adapt.tiers.map((t: { name: string }) => t.name)).toContain('Zenith');
    expect((await call('GET', '/tiers/nope/ladder')).status).toBe(404);
    await progress(0);
  });
});

describe('multi compare', () => {
  it('aligns fields, finds shared neighbours/abilities and tier positions', async () => {
    await progress(0, { showAll: true });
    const r = (await call('GET', `/compare?mode=reader&ids=${pid('character', 'Kael Marrow')},${pid('character', 'Ilex Thorne')},${pid('character', 'Orrin Vale')}`)).body;
    expect(r.pages).toHaveLength(3);
    expect(r.rows.find((x: { key: string }) => x.key === 'species').differs).toBe(false);
    expect(r.byField.abilities.shared).toContain('Ember Step');
    expect(r.tiers[0].placements[pid('character', 'Orrin Vale')]).toBe('Pyre');
    await progress(0);
    const hidden = (await call('GET', `/compare?mode=reader&ids=${pid('character', 'Sable')},${pid('character', 'Kael Marrow')}`)).body;
    expect(hidden.pages.find((p: { id: string }) => p.id === pid('character', 'Sable'))).toMatchObject({ hidden: true });
    expect(JSON.stringify(hidden)).not.toContain('Hollow Flame');
  });
});

describe('boards', () => {
  const board = { name: 'Strongest', tiers: [{ id: 's', label: 'S', color: '#f00' }, { id: 'a', label: 'A', color: '#0f0' }], placements: { s: [pid('character', 'Orrin Vale')], a: [] }, pool: [pid('character', 'Mira Ashgrove')], context: { arcId: 'a3', note: 'end of arc 3' } };
  it('round-trips and rejects unknown pages', async () => {
    await progress(0);
    expect((await call('PUT', '/boards/strongest?mode=reader', board)).status).toBe(200);
    expect((await call('GET', '/boards/strongest?mode=reader')).body.items[pid('character', 'Orrin Vale')].title).toBe('Orrin Vale');
    expect((await call('GET', '/boards?mode=reader')).body[0]).toMatchObject({ id: 'strongest', items: 2 });
    expect((await call('PUT', '/boards/bad?mode=reader', { ...board, pool: ['nope'] })).status).toBe(400);
    expect((await call('GET', '/boards/..%2Fx')).status).toBe(404);
  });
  it('a reader saving a board never drops placements of pages they cannot see', async () => {
    const hiddenId = pid('character', 'Sable');
    await call('PUT', '/boards/mixed?mode=author', { ...board, name: 'Mixed', placements: { s: [pid('character', 'Orrin Vale'), hiddenId], a: [] }, pool: [] });
    const asReader = (await call('GET', '/boards/mixed?mode=reader')).body;
    expect(asReader.placements.s).toEqual([pid('character', 'Orrin Vale')]);
    await call('PUT', '/boards/mixed?mode=reader', { ...asReader, placements: { s: [], a: asReader.placements.s } });
    const author = (await call('GET', '/boards/mixed?mode=author')).body;
    expect(author.placements.a).toEqual([pid('character', 'Orrin Vale')]);
    expect(author.placements.s).toEqual([hiddenId]); // preserved
    expect((await call('DELETE', '/boards/mixed')).status).toBe(204);
  });
});
