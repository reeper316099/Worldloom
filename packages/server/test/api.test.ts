import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';

const TOKEN = 'test-token';
let dir: string, app: FastifyInstance, manager: WorldManager;
const H = { authorization: `Bearer ${TOKEN}` };
async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = H) {
  const res = await app.inject({ method: method as 'GET', url: '/api/v1' + url, headers, payload: body as object | undefined });
  return { status: res.statusCode, body: res.body ? safe(res.body) : undefined, raw: res };
}
const safe = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-api-'));
  manager = await new WorldManager(dir, { revisionDebounceMs: 0, watch: true }).init();
  app = await buildApp({ token: TOKEN, manager });
  await call('POST', '/worlds', {
    name: 'Test World', slug: 'tw',
    continuities: [{ id: 'wn', name: 'Web Novel', isPrimary: true }, { id: 'ln', name: 'Light Novel' }],
    sources: [{ id: 'wn', name: 'Web Novel', kind: 'web_novel', continuityId: 'wn', units: { label: 'Chapter' } }],
  });
});
afterAll(async () => {
  await app.close();
  await manager.close();
});

const page = (title: string, extra: object = {}) => call('POST', '/worlds/tw/pages', { type: 'character', title, ...extra });

describe('auth & errors', () => {
  it('rejects missing/bad token on every route', async () => {
    for (const [m, u] of [['GET', '/worlds'], ['GET', '/worlds/tw/pages'], ['POST', '/worlds/tw/pages'], ['GET', '/settings'], ['GET', '/events']] as const) {
      expect((await call(m, u, undefined, {})).status).toBe(401);
      expect((await call(m, u, undefined, { authorization: 'Bearer nope' })).status).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
  it('uses consistent error shape with request id', async () => {
    const r = await call('GET', '/worlds/nope');
    expect(r.status).toBe(404);
    expect(r.body.error).toMatchObject({ code: 'not_found' });
    expect(r.body.error.requestId).toBeTruthy();
    const bad = await call('POST', '/worlds/tw/pages', { type: 'character' });
    expect(bad.status).toBe(400);
  });
  it('rejects path-traversal world slugs and asset names', async () => {
    expect((await call('GET', '/worlds/..%2F..%2Fetc')).status).toBe(404);
    expect((await call('GET', '/worlds/tw/assets/..%2Fworld.json')).status).toBe(404);
  });
});

describe('worlds & pages', () => {
  it('creates pages as markdown files with frontmatter', async () => {
    const r = await page('Alice', { aliases: ['Al'], body: 'Hello [[Bob]].', fields: { species: 'human' } });
    expect(r.status).toBe(201);
    const file = path.join(dir, 'worlds/tw/pages/character/alice.md');
    const text = await fs.readFile(file, 'utf8');
    expect(text).toMatch(/^---\nid: p_/);
    expect(text).toContain('Hello [[Bob]].');
    expect((await page('Alice')).status).toBe(409);
  });
  it('looks up by id, slug and alias; coerces fields', async () => {
    const a = (await call('GET', '/worlds/tw/pages/alice')).body;
    expect((await call('GET', `/worlds/tw/pages/${a.id}`)).body.title).toBe('Alice');
    expect((await call('GET', '/worlds/tw/pages/Al')).body.title).toBe('Alice');
    const bad = await call('PATCH', `/worlds/tw/pages/${a.id}`, { fields: { status: 'zombie' } });
    expect(bad.status).toBe(400);
  });
  it('red links, backlinks and health report', async () => {
    const v = (await call('GET', '/worlds/tw/pages/alice')).body;
    expect(v.html).toContain('redlink');
    await page('Bob', { body: 'Friend of [[Al]].', status: 'complete' });
    const bob = (await call('GET', '/worlds/tw/pages/bob')).body;
    expect(bob.html).not.toContain('redlink');
    const bl = (await call('GET', `/worlds/tw/backlinks/${bob.id}`)).body;
    expect(bl.map((b: { title: string }) => b.title)).toEqual(['Alice']);
    const h = (await call('GET', '/worlds/tw/health-report?mode=author')).body;
    expect(h.redLinks).toEqual([]);
    expect(h.stubs.map((p: { title: string }) => p.title)).toContain('Alice');
    expect((await call('GET', '/worlds/tw/health-report')).status).toBe(403);
  });
  it('redirect pages resolve', async () => {
    await page('Robert', { redirectsTo: 'Bob' });
    await page('Carol', { body: 'See [[Robert]].' });
    const c = (await call('GET', '/worlds/tw/pages/carol')).body;
    expect(c.html).toContain('/p/bob');
  });
  it('rename rewrites links and is undoable', async () => {
    const before = await fs.readFile(path.join(dir, 'worlds/tw/pages/character/carol.md'), 'utf8');
    const bob = (await call('GET', '/worlds/tw/pages/bob')).body;
    const r = await call('POST', `/worlds/tw/pages/${bob.id}/rename`, { title: 'Robert Prime' });
    expect(r.status).toBe(200);
    const alice = (await call('GET', '/worlds/tw/pages/alice/raw?mode=author')).body;
    expect(alice.body).toContain('[[Robert Prime]]');
    expect((await call('GET', '/worlds/tw/pages/robert-prime')).body.title).toBe('Robert Prime');
    expect((await call('GET', '/worlds/tw/pages/bob')).status).toBe(404);
    const u = await call('POST', `/worlds/tw/tx/${r.body.txId}/undo`);
    expect(u.status).toBe(200);
    expect((await call('GET', '/worlds/tw/pages/alice/raw?mode=author')).body.body).toContain('[[Bob]]');
    expect((await call('GET', '/worlds/tw/pages/bob')).body.title).toBe('Bob');
    expect(await fs.readFile(path.join(dir, 'worlds/tw/pages/character/carol.md'), 'utf8')).toBe(before);
  });
  it('rename with redirect keeps old links working via alias', async () => {
    const dan = (await page('Dan')).body;
    await page('Eve', { body: '[[Dan]]' });
    await call('POST', `/worlds/tw/pages/${dan.id}/rename`, { title: 'Daniel', links: 'redirect' });
    expect((await call('GET', '/worlds/tw/pages/eve/raw?mode=author')).body.body).toBe('[[Dan]]');
    expect((await call('GET', '/worlds/tw/pages/eve')).body.html).not.toContain('redlink');
  });
  it('keeps revisions, diffs and restores', async () => {
    const a = (await call('GET', '/worlds/tw/pages/alice')).body;
    await call('PATCH', `/worlds/tw/pages/${a.id}`, { body: 'Version two.' });
    const h = (await call('GET', '/worlds/tw/history/alice?mode=author')).body;
    expect(h.length).toBeGreaterThanOrEqual(2);
    const oldest = h[h.length - 1];
    const d = (await call('GET', `/worlds/tw/history/alice/diff?mode=author&from=${encodeURIComponent(oldest.ts)}`)).body;
    expect(d.body.some((c: { op: string }) => c.op !== 'eq')).toBe(true);
    await call('POST', '/worlds/tw/history/alice/restore', { ts: oldest.ts });
    expect((await call('GET', '/worlds/tw/pages/alice/raw?mode=author')).body.body).toContain('Hello');
  });
  it('validates and serves assets safely', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const up = await app.inject({ method: 'POST', url: '/api/v1/worlds/tw/assets', headers: { ...H, 'content-type': 'image/png' }, payload: png });
    expect(up.statusCode).toBe(201);
    const { file } = up.json();
    expect(file).toMatch(/\.png$/);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/tw/assets/${file}`, headers: H })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/worlds/tw/assets/${file}?access_token=${TOKEN}` })).statusCode).toBe(200);
    const evil = await app.inject({ method: 'POST', url: '/api/v1/worlds/tw/assets', headers: { ...H, 'content-type': 'image/svg+xml' }, payload: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
    expect(evil.statusCode).toBe(400);
    const fake = await app.inject({ method: 'POST', url: '/api/v1/worlds/tw/assets', headers: { ...H, 'content-type': 'image/png' }, payload: Buffer.from('not an image') });
    expect(fake.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/worlds/tw/assets', headers: { ...H, 'content-type': 'image/svg+xml' }, payload: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>' });
    expect(ok.statusCode).toBe(201);
  });
});

describe('search', () => {
  it('finds by title/alias/body with operators', async () => {
    await page('Zorblax', { aliases: ['Great Zorb'], tags: ['villain'], body: 'A quantum gremlin.' });
    const q = async (s: string) => (await call('GET', `/worlds/tw/search?mode=author&q=${encodeURIComponent(s)}`)).body.map((x: { title: string }) => x.title);
    expect(await q('zorblax')).toContain('Zorblax');
    expect(await q('great zorb')).toContain('Zorblax');
    expect(await q('quantum')).toContain('Zorblax');
    expect(await q('tag:villain')).toEqual(['Zorblax']);
    expect(await q('type:faction quantum')).toEqual([]);
  });
});

describe('spoilers (server-side)', () => {
  let secretId: string;
  beforeAll(async () => {
    await page('Hero', { body: 'Public text.\n\n:::spoiler{src="wn" at=120}\nHERO IS SECRETLY ROYAL\n:::\n\nLinks [[Mystic Orb]].' });
    secretId = (await page('Mystic Orb', { aliases: ['Glimmerstone'], body: 'The orb powers ORBPOWER.', reveal: { sourceId: 'wn', at: 200 }, fields: { species: 'artifact' } })).body.id;
    await page('Fieldy', { fields: { species: { value: 'dragon', reveal: { sourceId: 'wn', at: 300 } } } });
  });
  const gated = ['HERO IS SECRETLY ROYAL', 'ORBPOWER'];

  it('unknown progress hides everything gated (default)', async () => {
    const hero = (await call('GET', '/worlds/tw/pages/hero')).body;
    expect(hero.html).toContain('Public text');
    for (const s of gated) expect(hero.html).not.toContain(s);
    expect(hero.html).toContain('Spoiler for');
    const orb = (await call('GET', `/worlds/tw/pages/${secretId}`)).body;
    expect(orb.hidden).toBe(true);
    expect(JSON.stringify(orb)).not.toContain('ORBPOWER');
    expect(JSON.stringify(orb)).not.toContain('Glimmerstone');
  });
  it('no leaks through search, suggest, backlinks, list, field values', async () => {
    const everything: unknown[] = [
      (await call('GET', '/worlds/tw/search?q=ORBPOWER')).body,
      (await call('GET', '/worlds/tw/search?q=SECRETLY')).body,
      (await call('GET', '/worlds/tw/search?q=Glimmerstone')).body,
      (await call('GET', '/worlds/tw/search?q=orb')).body,
      (await call('GET', '/worlds/tw/suggest?q=glimmer')).body,
      (await call('GET', `/worlds/tw/backlinks/${secretId}`)).body,
      (await call('GET', '/worlds/tw/pages')).body,
      (await call('GET', '/worlds/tw/categories')).body,
      (await call('GET', '/worlds/tw/pages/fieldy')).body,
    ];
    const s = JSON.stringify(everything);
    for (const g of [...gated, 'Glimmerstone', 'dragon']) expect(s, `leaked ${g}`).not.toContain(g);
    expect((await call('GET', '/worlds/tw/search?q=SECRETLY')).body).toEqual([]);
  });
  it('hideTitles masks titles of gated pages', async () => {
    await call('PUT', '/settings', { hideTitles: true });
    const list = JSON.stringify((await call('GET', '/worlds/tw/pages')).body);
    expect(list).not.toContain('Mystic');
    expect(JSON.stringify((await call('GET', '/worlds/tw/search?q=Mystic')).body)).not.toContain('Mystic');
    expect(JSON.stringify((await call('GET', '/worlds/tw/search?q=hero')).body)).not.toContain('Mystic');
    expect(JSON.stringify((await call('GET', '/worlds/tw/search?q=public')).body)).not.toContain('Mystic');
    expect((await call('GET', '/worlds/tw/search?q=Mystic')).body).toEqual([]);
    expect(JSON.stringify((await call('GET', '/worlds/tw/pages/hero')).body)).not.toContain('Mystic');
    await call('PUT', '/settings', { hideTitles: false });
    expect(JSON.stringify((await call('GET', '/worlds/tw/pages')).body)).toContain('Mystic Orb');
  });
  it('raising progress reveals, per-item reveal works and is undoable', async () => {
    await call('PUT', '/worlds/tw/progress', { sources: { wn: 150 } });
    let hero = (await call('GET', '/worlds/tw/pages/hero')).body;
    expect(hero.html).toContain('HERO IS SECRETLY ROYAL');
    expect((await call('GET', '/worlds/tw/search?q=SECRETLY')).body).toHaveLength(1);
    expect((await call('GET', `/worlds/tw/pages/${secretId}`)).body.hidden).toBe(true);
    await call('POST', '/worlds/tw/progress/reveal', { key: `page:${secretId}` });
    expect((await call('GET', `/worlds/tw/pages/${secretId}`)).body.hidden).toBe(false);
    await call('POST', '/worlds/tw/progress/reveal', { key: `page:${secretId}`, undo: true });
    expect((await call('GET', `/worlds/tw/pages/${secretId}`)).body.hidden).toBe(true);
    await call('PUT', '/worlds/tw/progress', { sources: { wn: 1 } });
    hero = (await call('GET', '/worlds/tw/pages/hero')).body;
    expect(hero.html).not.toContain('SECRETLY');
  });
  it('author mode and showAll see everything', async () => {
    expect(JSON.stringify((await call('GET', `/worlds/tw/pages/${secretId}?mode=author`)).body)).toContain('ORBPOWER');
    await call('PUT', '/worlds/tw/progress', { showAll: true });
    expect(JSON.stringify((await call('GET', '/worlds/tw/pages/hero')).body)).toContain('SECRETLY');
    await call('PUT', '/worlds/tw/progress', { showAll: false });
  });
  it('dm-only content is hidden in player view', async () => {
    await page('Dungeon Secret', { dmOnly: true, body: 'DMONLYTEXT' });
    expect(JSON.stringify((await call('GET', '/worlds/tw/search?q=DMONLYTEXT&player=1&mode=reader')).body)).not.toContain('Dungeon');
    expect((await call('GET', '/worlds/tw/search?q=DMONLYTEXT&mode=author')).body).toHaveLength(1);
  });
});

describe('live reload & corruption safety', () => {
  it('picks up hand edits and survives invalid ones', async () => {
    const file = path.join(dir, 'worlds/tw/pages/character/zorblax.md');
    const orig = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, orig.replace('A quantum gremlin.', 'Hand edited text.'));
    await waitFor(async () => (await call('GET', '/worlds/tw/pages/zorblax/raw?mode=author')).body.body.includes('Hand edited'));
    await fs.writeFile(file, '---\nid: [oops\n---\nbroken');
    await waitFor(async () => (await call('GET', '/worlds/tw/health-report?mode=author')).body.fileErrors.length > 0);
    const kept = (await call('GET', '/worlds/tw/pages/zorblax/raw?mode=author')).body;
    expect(kept.body).toContain('Hand edited');
  });
  it('world.json corruption restores from backup', async () => {
    const f = path.join(dir, 'worlds/tw/world.json');
    await call('PATCH', '/worlds/tw', { description: 'one' });
    await call('PATCH', '/worlds/tw', { description: 'two' });
    await fs.writeFile(f, '{ broken');
    const { JsonFile } = await import('@worldloom/jsonstore');
    const { WorldSchema } = await import('@worldloom/shared');
    const loaded = await new JsonFile(f, { schema: WorldSchema, version: 1, backupDir: path.join(dir, 'backups/files/tw') }).load();
    expect(loaded.name).toBe('Test World');
  });
});

async function waitFor(fn: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('timeout waiting for condition');
}

describe('concurrency', () => {
  it('opens a world once and answers a burst of simultaneous first requests', async () => {
    const fresh = await new WorldManager(dir, { revisionDebounceMs: 0 }).init();
    const app2 = await buildApp({ token: TOKEN, manager: fresh });
    const rs = await Promise.all(Array.from({ length: 60 }, () => app2.inject({ method: 'GET', url: '/api/v1/worlds/tw/pages?mode=author', headers: H })));
    expect(rs.map((r) => r.statusCode).filter((c) => c !== 200)).toEqual([]);
    const repos = (fresh as unknown as { repos: Map<string, unknown> }).repos;
    expect(repos.size).toBe(1);
    await app2.close();
    await fresh.close();
  });
});
