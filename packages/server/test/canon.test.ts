import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';

let dir: string, app: FastifyInstance, manager: WorldManager;
const call = async (method: 'GET' | 'PUT' | 'PATCH' | 'POST', url: string, body?: unknown) => {
  const r = await app.inject({ method, url: '/api/v1/worlds/w' + url, headers: { authorization: 'Bearer t' }, payload: body as object });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-canon-'));
  manager = await new WorldManager(path.join(dir, 'data'), { revisionDebounceMs: 0 }).init();
  app = await buildApp({ token: 't', manager });
  await app.inject({ method: 'POST', url: '/api/v1/starter-worlds/the-ashen-ascent/install', headers: { authorization: 'Bearer t' } });
  // install uses the starter slug; alias it as "w" for brevity
  await fs.rename(path.join(dir, 'data/worlds/the-ashen-ascent'), path.join(dir, 'data/worlds/w'));
  const wf = path.join(dir, 'data/worlds/w/world.json');
  const j = JSON.parse(await fs.readFile(wf, 'utf8'));
  j.slug = 'w';
  await fs.writeFile(wf, JSON.stringify(j));
  (manager as unknown as { repos: Map<string, unknown> }).repos.clear();
});
afterAll(async () => {
  await app.close();
  await manager.close();
});

describe('continuity compare & switching', () => {
  it('compares a page across continuities with an infobox diff', async () => {
    const r = (await call('GET', '/pages/kael-marrow/compare?mode=author&a=wn&b=adapt')).body;
    expect(r.a.html).toContain('Cinder</a> realm by chapter 100');
    expect(r.b.html).toContain('still only');
    expect(r.a.html).not.toContain('still only');
    const tier = r.infobox.find((x: { key: string }) => x.key === 'tier');
    expect(tier).toMatchObject({ a: 'Cinder', b: 'Ember', differs: true });
    expect(r.infobox.find((x: { key: string }) => x.key === 'species').differs).toBe(false);
  });
  it('compare does not leak gated values in reader mode', async () => {
    await call('PUT', '/progress', { sources: { wn: 10 } });
    const r = (await call('GET', '/pages/kael-marrow/compare?mode=reader&a=wn&b=adapt')).body;
    expect(JSON.stringify(r)).not.toContain('his core is a splinter');
    expect(r.infobox.find((x: { key: string }) => x.key === 'tier').a).toBe('???');
  });
  it('flags pages that do not apply to the selected continuity', async () => {
    await call('PATCH', '/pages/pell-anwick', { appliesTo: ['wn'] });
    expect((await call('GET', '/pages/pell-anwick?mode=author&cont=adapt')).body.appliesToSelected).toBe(false);
    expect((await call('GET', '/pages/pell-anwick?mode=author&cont=wn')).body.appliesToSelected).toBe(true);
    expect((await call('GET', '/pages/pell-anwick?mode=author')).body.appliesToSelected).toBe(true);
  });
  it('exposes citations with hover titles and claims', async () => {
    const v = (await call('GET', '/pages/tamsin-quill?mode=author')).body;
    expect(v.html).toContain('class="cite"');
    expect(v.html).toContain('title="Web Novel ch 52"');
    const s = (await call('GET', '/pages/sable?mode=author')).body;
    expect(s.claims.some((c: { kind: string; cited: boolean }) => c.kind === 'theory' && !c.cited)).toBe(true);
  });
});

describe('canon integrity', () => {
  it('rejects bad references and ranges', async () => {
    const sources = (await call('GET', '/sources')).body;
    expect((await call('PUT', '/sources', [{ ...sources[0], continuityId: 'nope' }])).status).toBe(400);
    const arcs = (await call('GET', '/arcs')).body;
    expect((await call('PUT', '/arcs', [{ ...arcs[0], ranges: { wn: { from: 9, to: 2 } } }])).status).toBe(400);
    expect((await call('PUT', '/arcs', [{ ...arcs[0], ranges: { ghost: { from: 1, to: 2 } } }])).status).toBe(400);
    expect((await call('PUT', '/continuities', [])).status).toBe(400);
  });
  it('blocks removing things that pages still use', async () => {
    const sources = (await call('GET', '/sources')).body;
    const r = await call('PUT', '/sources', sources.filter((s: { id: string }) => s.id !== 'wn'));
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/referenced by \d+ page/);
    const conts = (await call('GET', '/continuities')).body;
    expect((await call('PUT', '/continuities', conts.filter((c: { id: string }) => c.id !== 'adapt'))).status).toBe(409);
    const arcs = (await call('GET', '/arcs')).body;
    expect((await call('PUT', '/arcs', arcs.filter((a: { id: string }) => a.id !== 'a4'))).status).toBe(409);
  });
  it('cascades removal of an unused source into arc ranges and progress', async () => {
    await call('PUT', '/progress', { sources: { recap: 3 } });
    const sources = (await call('GET', '/sources')).body;
    expect((await call('PUT', '/sources', sources.filter((s: { id: string }) => s.id !== 'recap'))).status).toBe(200);
    const arcs = (await call('GET', '/arcs')).body;
    expect(arcs.every((a: { ranges: object }) => !('recap' in a.ranges))).toBe(true);
    expect((await call('GET', '/progress')).body.sources.recap).toBeUndefined();
  });
  it('normalises exactly one primary continuity', async () => {
    const conts = (await call('GET', '/continuities')).body.map((c: object) => ({ ...c, isPrimary: false }));
    const r = await call('PUT', '/continuities', conts);
    expect(r.body.filter((c: { isPrimary: boolean }) => c.isPrimary)).toHaveLength(1);
    expect((await call('PUT', '/continuities', r.body.map((c: object) => ({ ...c, isPrimary: true })))).status).toBe(400);
  });
});
