import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';
import { assertLoopback, progressOf } from '../src/lorekeeper';

// A stand-in for Lorekeeper's local API (same routes/auth/shape as its real server).
const TOKEN = 'lk-token';
const entries: Record<string, unknown> = {
  e1: { id: 'e1', title: 'Ashen Saga', library: 'reading', status: 'reading', totalUnits: 300, current: { raw: '120', number: 120, season: null, kind: 'number' }, consumedUpTo: { raw: '60', number: 60, season: null, kind: 'number' } },
  e2: { id: 'e2', title: 'Ashen Saga (anime)', library: 'watching', status: 'watching', totalUnits: 24, current: { raw: '8', number: 8, season: 1, kind: 'number' }, consumedUpTo: { raw: null, number: null, season: null, kind: null } },
  e3: { id: 'e3', title: 'Finished Show', library: 'watching', status: 'completed', totalUnits: 12, current: { raw: 'complete', number: null, season: null, kind: 'complete' }, consumedUpTo: { raw: null, number: null, season: null, kind: null } },
};
let fake: FastifyInstance, fakeUrl: string, hits: string[] = [];
let dir: string, app: FastifyInstance, manager: WorldManager;
const call = async (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
  const r = await app.inject({ method, url: '/api/v1' + url, headers: { authorization: 'Bearer t' }, payload: body as object });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
};

beforeAll(async () => {
  fake = Fastify();
  fake.addHook('onRequest', async (req, reply) => {
    hits.push(req.url);
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply.status(401).send({ error: { code: 'UNAUTHORIZED' } });
  });
  fake.get('/api/v1/health', async () => ({ ok: true }));
  fake.get('/api/v1/meta', async () => ({ entries: 3 }));
  fake.get('/api/v1/entries', async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').toLowerCase();
    const items = Object.values(entries).filter((e) => (e as { title: string }).title.toLowerCase().includes(q));
    return { items, total: items.length, page: 1, limit: 100 };
  });
  fake.get('/api/v1/entries/:id', async (req, reply) => entries[(req.params as { id: string }).id] ?? reply.status(404).send({ error: { code: 'NOT_FOUND' } }));
  fake.get('/api/v1/redirect/health', async (_r, reply) => reply.redirect('http://example.invalid/steal'));
  await fake.listen({ host: '127.0.0.1', port: 0 });
  fakeUrl = `http://127.0.0.1:${(fake.server.address() as { port: number }).port}`;

  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-lk-'));
  manager = await new WorldManager(path.join(dir, 'data'), { revisionDebounceMs: 0 }).init();
  app = await buildApp({ token: 't', manager });
  await call('POST', '/starter-worlds/the-ashen-ascent/install');
});
afterAll(async () => { await app.close(); await manager.close(); await fake.close(); });

describe('loopback guard', () => {
  it('accepts only plain-http local addresses', () => {
    for (const ok of ['http://127.0.0.1:4317', 'http://localhost:9', 'http://[::1]:4317/', 'http://127.0.0.1']) expect(() => assertLoopback(ok), ok).not.toThrow();
    for (const bad of ['https://127.0.0.1:4317', 'http://example.com', 'http://192.168.1.5:4317', 'http://localhost.evil.com', 'http://127.0.0.1@evil.com', 'http://user:pw@127.0.0.1', 'file:///etc/passwd', 'ftp://127.0.0.1', 'not a url', 'http://0.0.0.0:80', 'http://127.0.0.1.evil.com']) expect(() => assertLoopback(bad), bad).toThrow();
  });
});

describe('Lorekeeper integration', () => {
  it('is off by default and never contacts anything', async () => {
    hits = [];
    expect((await call('GET', '/integrations/lorekeeper')).body).toMatchObject({ enabled: false });
    expect((await call('POST', '/integrations/lorekeeper/test')).status).toBe(400);
    expect((await call('POST', '/worlds/the-ashen-ascent/integrations/lorekeeper/sync', {})).status).toBe(400);
    expect(hits).toEqual([]);
  });

  it('refuses to store a non-local URL', async () => {
    const r = await call('PUT', '/integrations/lorekeeper', { enabled: true, baseUrl: 'http://example.com', token: 'x' });
    expect(r.status).toBe(400);
    expect((await call('GET', '/integrations/lorekeeper')).body.enabled).toBe(false);
  });

  it('never returns the token', async () => {
    const r = await call('PUT', '/integrations/lorekeeper', { enabled: true, baseUrl: fakeUrl, token: TOKEN });
    expect(r.body).toEqual({ enabled: true, baseUrl: fakeUrl, hasToken: true });
    expect(JSON.stringify((await call('GET', '/settings')).body)).not.toContain(TOKEN);
    // later updates without a token keep the stored one
    await call('PUT', '/integrations/lorekeeper', { enabled: true, baseUrl: fakeUrl });
    expect((await call('POST', '/integrations/lorekeeper/test')).body).toMatchObject({ ok: true, entries: 3 });
  });

  it('searches Lorekeeper entries', async () => {
    const r = (await call('GET', '/integrations/lorekeeper/search?q=ashen')).body;
    expect(r.map((e: { id: string }) => e.id)).toEqual(['e1', 'e2']);
    expect(r[0]).toMatchObject({ title: 'Ashen Saga', current: 120, consumedUpTo: 60, totalUnits: 300 });
  });

  it('reports clear errors for a bad token or an unreachable app', async () => {
    await call('PUT', '/integrations/lorekeeper', { enabled: true, baseUrl: fakeUrl, token: 'wrong' });
    const bad = await call('POST', '/integrations/lorekeeper/test');
    expect(bad.status).toBe(502);
    expect(bad.body.error.code).toBe('lorekeeper_unauthorized');
    await call('PUT', '/integrations/lorekeeper', { enabled: true, baseUrl: 'http://127.0.0.1:1', token: TOKEN });
    expect((await call('POST', '/integrations/lorekeeper/test')).body.error.code).toBe('lorekeeper_unreachable');
    await call('PUT', '/integrations/lorekeeper', { enabled: true, baseUrl: fakeUrl, token: TOKEN });
  });

  it('refuses redirects (no way to be bounced to another host)', async () => {
    const { LorekeeperClient } = await import('../src/lorekeeper');
    const c = new LorekeeperClient({ enabled: true, baseUrl: fakeUrl, token: TOKEN }, ((u: URL, init: RequestInit) => fetch(String(u).replace('/api/v1/health', '/api/v1/redirect/health'), init)) as unknown as typeof fetch);
    await expect(c.status()).rejects.toMatchObject({ code: 'lorekeeper_unreachable' });
  });

  it('links sources and syncs progress (max never lowers; follow mirrors; dry run changes nothing)', async () => {
    const W = '/worlds/the-ashen-ascent';
    const sources = (await call('GET', `${W}/sources?mode=author`)).body;
    const linked = sources.map((s: { id: string }) => (s.id === 'wn' ? { ...s, link: { app: 'lorekeeper', entryId: 'e1', title: 'Ashen Saga', field: 'current' } } : s.id === 'adapt' ? { ...s, link: { app: 'lorekeeper', entryId: 'e2', field: 'current' } } : s.id === 'recap' ? { ...s, link: { app: 'lorekeeper', entryId: 'missing', field: 'current' } } : s));
    expect((await call('PUT', `${W}/sources`, linked)).status).toBe(200);
    await call('PUT', `${W}/progress`, { sources: { wn: 150, adapt: 2 }, showAll: false });

    const dry = (await call('POST', `${W}/integrations/lorekeeper/sync`, { dryRun: true })).body;
    expect(dry.applied).toBe(false);
    expect((await call('GET', `${W}/progress`)).body.sources).toMatchObject({ wn: 150, adapt: 2 });

    const max = (await call('POST', `${W}/integrations/lorekeeper/sync`, {})).body;
    const by = (id: string) => max.report.find((r: { sourceId: string }) => r.sourceId === id);
    expect(by('wn')).toMatchObject({ from: 150, to: 150, action: 'unchanged' }); // Lorekeeper says 120 < 150: not lowered
    expect(by('adapt')).toMatchObject({ from: 2, to: 8, action: 'raised' });
    expect(by('recap').action).toBe('error');
    expect((await call('GET', `${W}/progress`)).body.sources).toMatchObject({ wn: 150, adapt: 8 });

    const follow = (await call('POST', `${W}/integrations/lorekeeper/sync`, { mode: 'follow' })).body;
    expect(follow.report.find((r: { sourceId: string }) => r.sourceId === 'wn')).toMatchObject({ to: 120, action: 'lowered' });
    expect((await call('GET', `${W}/progress`)).body.sources.wn).toBe(120);
  });

  it('uses the consumedUpTo field and treats a completed entry as total units', async () => {
    expect(progressOf(entries.e1 as never, 'consumedUpTo')).toBe(60);
    expect(progressOf(entries.e3 as never, 'current')).toBe(12);
    expect(progressOf(entries.e2 as never, 'consumedUpTo')).toBeNull();
  });

  it('synced progress drives spoiler filtering', async () => {
    const W = '/worlds/the-ashen-ascent';
    await call('PUT', `${W}/progress`, { sources: { wn: 5 } });
    const sources = (await call('GET', `${W}/sources?mode=author`)).body;
    await call('PUT', `${W}/sources`, sources.map((s: { id: string }) => (s.id === 'wn' ? { ...s, link: { app: 'lorekeeper', entryId: 'e1', field: 'current' } } : s)));
    await call('POST', `${W}/integrations/lorekeeper/sync`, {}); // wn -> 120
    const html = (await call('GET', `${W}/pages/kael-marrow?mode=reader`)).body.html as string;
    expect(html).toContain('splinter of the Cold Furnace'); // ch 120 block now revealed
    await call('PUT', `${W}/progress`, { sources: { wn: 10 } });
    expect(((await call('GET', `${W}/pages/kael-marrow?mode=reader`)).body.html as string)).not.toContain('splinter of the Cold Furnace');
  });
});
