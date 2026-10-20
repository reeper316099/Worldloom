import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';
import { SERIES } from '../../../starter-worlds/src/series';
import { CAMPAIGN } from '../../../starter-worlds/src/campaign';
import { buildWorld } from '../../../starter-worlds/src/build';
import { BUILTIN_PACKS } from '../src/packs';

const TOKEN = 't';
let dir: string, app: FastifyInstance, manager: WorldManager;
const get = async (url: string) => {
  const r = await app.inject({ method: 'GET', url: '/api/v1' + url, headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: r.statusCode, text: r.body, json: () => JSON.parse(r.body) };
};
const send = async (method: 'POST' | 'PUT', url: string, body: unknown) => {
  const r = await app.inject({ method, url: '/api/v1' + url, headers: { authorization: `Bearer ${TOKEN}` }, payload: body as object });
  return { status: r.statusCode, json: () => JSON.parse(r.body) };
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-starter-'));
  // the committed starter dirs must match the TS definitions
  const gen = path.join(dir, 'gen');
  await buildWorld(SERIES, path.join(gen, SERIES.slug));
  const committed = await fs.readFile(path.resolve(__dirname, '../../../starter-worlds', SERIES.slug, 'world.json'), 'utf8');
  expect(committed).toBe(await fs.readFile(path.join(gen, SERIES.slug, 'world.json'), 'utf8'));
  manager = await new WorldManager(path.join(dir, 'data'), { revisionDebounceMs: 0 }).init();
  app = await buildApp({ token: TOKEN, manager });
});
afterAll(async () => {
  await app.close();
  await manager.close();
});

describe('starter worlds', () => {
  it('lists and installs both worlds with valid files', async () => {
    const list = (await get('/starter-worlds')).json();
    expect(list.map((s: { id: string }) => s.id).sort()).toEqual(['gloamreach-campaign', 'the-ashen-ascent']);
    for (const s of list) expect((await send('POST', `/starter-worlds/${s.id}/install`, {})).status).toBe(201);
    expect((await send('POST', '/starter-worlds/the-ashen-ascent/install', {})).json().slug).toBe('the-ashen-ascent-2');
    for (const slug of ['the-ashen-ascent', 'gloamreach-campaign']) {
      const h = (await get(`/worlds/${slug}/health-report?mode=author`)).json();
      expect(h.fileErrors).toEqual([]);
    }
    expect((await get('/worlds/the-ashen-ascent/health-report?mode=author')).json().total).toBeGreaterThanOrEqual(40);
  });

  it('series demo exercises red links, stubs, unsourced claims and continuity differences', async () => {
    const h = (await get('/worlds/the-ashen-ascent/health-report?mode=author')).json();
    expect(h.redLinks.map((r: { name: string }) => r.name).sort()).toEqual(['Third Lantern', 'Is Sable Kael\'s other half?'].filter((n) => n !== "Is Sable Kael's other half?").sort());
    expect(h.stubs.length).toBeGreaterThan(3);
    expect(h.unsourcedClaims.length).toBeGreaterThan(0);
    const wn = (await get('/worlds/the-ashen-ascent/pages/kael-marrow?mode=author&cont=wn')).json().html;
    const ad = (await get('/worlds/the-ashen-ascent/pages/kael-marrow?mode=author&cont=adapt')).json().html;
    expect(wn).toContain('Cinder</a> realm by chapter 100');
    expect(wn).not.toContain('still only');
    expect(ad).toContain('still only');
  });

  for (const [def, label] of [[SERIES, 'series'], [CAMPAIGN, 'campaign']] as const) {
    it(`${label}: no gated string leaks in reader mode (demo progress and unknown progress)`, async () => {
      const slug = def.slug;
      for (const progress of [{ sources: Object.fromEntries(def.world.sources.map((s) => [s.id, 0])) }, null]) {
        if (progress) await send('PUT', `/worlds/${slug}/progress`, { sources: progress.sources });
        const list = (await get(`/worlds/${slug}/pages?mode=reader&player=1&limit=1000`)).json().items as Array<{ slug: string; id: string; title: string }>;
        const bodies: string[] = [JSON.stringify(list)];
        for (const p of list) {
          bodies.push((await get(`/worlds/${slug}/pages/${encodeURIComponent(p.slug)}?mode=reader&player=1`)).text);
          bodies.push((await get(`/worlds/${slug}/backlinks/${p.id}?mode=reader&player=1`)).text);
        }
        for (const q of ['the', 'flame', 'core', 'sister', 'vault', 'key', 'ledger', 'furnace', 'syndicate', 'orrin', 'sable', ...def.secrets.flatMap((s) => s.split(' ').filter((w) => w.length > 5))]) {
          bodies.push((await get(`/worlds/${slug}/search?mode=reader&player=1&q=${encodeURIComponent(q)}`)).text);
          bodies.push((await get(`/worlds/${slug}/suggest?mode=reader&player=1&q=${encodeURIComponent(q)}`)).text);
        }
        bodies.push((await get(`/worlds/${slug}/categories?mode=reader&player=1`)).text);
        const all = bodies.join('\n');
        for (const secret of def.secrets) expect(all, `leaked: ${secret}`).not.toContain(secret);
      }
    });
    it(`${label}: control - the leak check can fail (showAll exposes every secret)`, async () => {
      const slug = def.slug;
      await send('PUT', `/worlds/${slug}/progress`, { showAll: true });
      const list = (await get(`/worlds/${slug}/pages?mode=reader&limit=1000`)).json().items as Array<{ slug: string }>;
      const all = (await Promise.all(list.map((p) => get(`/worlds/${slug}/pages/${encodeURIComponent(p.slug)}?mode=reader`)))).map((r) => r.text).join('\n');
      const decoded = all.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      for (const secret of def.secrets) expect(decoded, `secret never rendered: ${secret}`).toContain(secret);
      await send('PUT', `/worlds/${slug}/progress`, { showAll: false });
    });
    it(`${label}: author mode shows gated content`, async () => {
      const all = (await get(`/worlds/${def.slug}/search?mode=author&q=${encodeURIComponent(def.secrets[0]!.split(' ').slice(0, 3).join(' '))}`)).text;
      expect(all.length).toBeGreaterThan(5);
    });
  }

  it('type packs export/import round-trip and protect used types', async () => {
    const exp = (await get('/worlds/gloamreach-campaign/type-pack/export')).json();
    expect(exp.types.length).toBe(BUILTIN_PACKS['ttrpg-campaign']!.types.length);
    const slug = (await send('POST', '/worlds', { name: 'Blank One', pack: 'series-lore' })).json().slug;
    expect((await get(`/worlds/${slug}/entity-types`)).json().map((t: { slug: string }) => t.slug)).toContain('character');
    const r = (await send('POST', `/worlds/${slug}/type-pack/import`, { pack: exp, mode: 'add' })).json();
    expect(r.added).toContain('npc');
    expect(r.skipped).toContain('location');
    expect((await send('POST', `/worlds/gloamreach-campaign/type-pack/import`, { pack: { name: 'x', types: [exp.types[0]] }, mode: 'replace' })).status).toBe(400);
    expect((await send('POST', `/worlds/${slug}/type-pack/import`, { pack: { name: 'bad', types: [] }, mode: 'add' })).status).toBe(400);
  });
});
