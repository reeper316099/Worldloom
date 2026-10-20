import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';
import { SERIES } from '../../../starter-worlds/src/series';

let dir: string, app: FastifyInstance, manager: WorldManager;
const H = { authorization: 'Bearer t' };
const W = '/api/v1/worlds/the-ashen-ascent';
const call = async (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => {
  const r = await app.inject({ method, url: url.startsWith('/api') ? url : W + url, headers: H, payload: body as object });
  return { status: r.statusCode, raw: r, text: r.body, json: () => JSON.parse(r.body) };
};
const zipText = (r: { raw: { rawPayload: Buffer } }) => Object.entries(unzipSync(new Uint8Array(r.raw.rawPayload))).map(([n, d]) => `${n}\n${strFromU8(d)}`).join('\n');

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-xfer-'));
  manager = await new WorldManager(path.join(dir, 'data'), { revisionDebounceMs: 0 }).init();
  app = await buildApp({ token: 't', manager });
  await call('POST', '/api/v1/starter-worlds/the-ashen-ascent/install');
  await call('PUT', '/progress', { sources: { wn: 0, adapt: 0, recap: 0 }, showAll: false });
});
afterAll(async () => { await app.close(); await manager.close(); });

describe('export', () => {
  it('excludes spoilers by default and includes them on request', async () => {
    const secrets = SERIES.secrets;
    for (const [fmt, text] of [
      ['json', (await call('GET', '/export/json')).text], ['markdown', zipText(await call('GET', '/export/markdown'))],
      ['site', zipText(await call('GET', '/export/site'))], ['html', (await call('GET', '/export/html')).text],
    ] as const) for (const s of secrets) expect(text, `${fmt} leaked: ${s}`).not.toContain(s);
    for (const [fmt, text] of [
      ['json', (await call('GET', '/export/json?spoilers=1')).text], ['markdown', zipText(await call('GET', '/export/markdown?spoilers=1'))],
    ] as const) for (const s of secrets.slice(0, 4)) expect(text.includes(s) || text.includes(s.replace(/’/g, "\\u2019")), `${fmt} should include: ${s}`).toBe(true);
  });
  it('omits gated pages and never names them', async () => {
    const j = (await call('GET', '/export/json')).json();
    const titles = j.pages.map((p: { title: string }) => p.title);
    expect(titles).toContain('Kael Marrow');
    expect(titles).not.toContain('Sable');
    expect(JSON.stringify(j)).not.toContain('Hollow Flame'); // gated page title, also referenced from visible pages' links/fields
    expect(JSON.stringify(j)).not.toMatch(/"reveal"/);
    expect(j.includesSpoilers).toBe(false);
  });
  it('csv has a header, escapes cells and respects visibility', async () => {
    await call('PUT', '/progress', { sources: { wn: 60 } });
    const csv = (await call('GET', '/export/csv?type=character')).text;
    expect(csv.split('\r\n')[0]).toContain('title,aliases,tags,status,species');
    expect(csv).toContain('Kael Marrow');
    expect(csv).not.toContain('Sable');
    expect((await call('GET', '/export/csv')).status).toBe(400);
    await call('PUT', '/progress', { sources: { wn: 0 } });
  });
  it('html exports are self-contained, sandboxed and link between pages', async () => {
    await call('PUT', '/progress', { sources: { wn: 60 } });
    const page = (await call('GET', '/export/html?page=kael-marrow')).text;
    expect(page).toContain("default-src 'none'");
    expect(page).not.toMatch(/<script/i);
    const site = unzipSync(new Uint8Array((await call('GET', '/export/site')).raw.rawPayload));
    expect(Object.keys(site)).toEqual(expect.arrayContaining(['index.html', 'style.css', 'kael-marrow.html']));
    expect(strFromU8(site['kael-marrow.html']!)).toContain('href="ashmere.html"');
    await call('PUT', '/progress', { sources: { wn: 0 } });
  });
});

describe('import', () => {
  const files = [
    { path: 'Character/Zed Rowan.md', text: '---\ntitle: Zed Rowan\naliases: [Zed, The Quiet]\ntags: [new, "#cast"]\nspecies: elf\nmood: grumpy\nstatus: complete\n---\nZed knows [[Kael Marrow|Kael]] and ![[map.png]].\n' },
    { path: 'Faction/Ink Circle.md', text: 'No frontmatter, just text about [[Zed Rowan]].' },
    { path: 'loose/Mystery.md', text: 'Nothing to place this.' },
    { path: '.obsidian/app.md', text: 'ignored' },
    { path: 'Character/Kael Marrow.md', text: '---\nspecies: robot\n---\nOverwritten body.' },
  ];
  it('previews without writing, then commits and undoes as one transaction', async () => {
    const before = (await call('GET', '/pages?mode=author&limit=1000')).json().total;
    const prev = (await call('POST', '/import/preview', { format: 'markdown', files, mode: 'skip' })).json();
    expect(prev.counts).toEqual({ create: 2, overwrite: 0, rename: 0, skip: 2 });
    expect(prev.items.find((i: { title: string }) => i.title === 'Zed Rowan').warnings[0]).toContain('ignored properties: mood');
    expect((await call('GET', '/pages?mode=author&limit=1000')).json().total).toBe(before);
    const res = (await call('POST', '/import/commit', { format: 'markdown', files, mode: 'overwrite', type: 'concept' })).json();
    expect(res).toMatchObject({ created: 3, updated: 1, skipped: 0 });
    const zed = (await call('GET', '/pages/zed-rowan/raw?mode=author')).json();
    expect(zed).toMatchObject({ type: 'character', status: 'complete', aliases: ['Zed', 'The Quiet'], tags: ['new', 'cast'] });
    expect(zed.fields.species).toBe('elf');
    expect((await call('GET', '/pages/kael-marrow/raw?mode=author')).json().body).toContain('Overwritten body');
    expect((await call('GET', '/pages/zed-rowan?mode=author')).json().html).toContain('/p/kael-marrow');
    expect((await fs.readdir(path.join(dir, 'data/backups/the-ashen-ascent'))).some((f) => f.includes('pre-import'))).toBe(true);
    expect((await call('POST', `/tx/${res.txId}/undo`)).status).toBe(200);
    expect((await call('GET', '/pages/zed-rowan?mode=author')).status).toBe(404);
    expect((await call('GET', '/pages/kael-marrow/raw?mode=author')).json().body).not.toContain('Overwritten body');
    expect((await call('GET', '/pages?mode=author&limit=1000')).json().total).toBe(before);
  });
  it('rename mode keeps both pages', async () => {
    const res = (await call('POST', '/import/commit', { format: 'markdown', mode: 'rename', files: [files[4]!] })).json();
    expect(res.created).toBe(1);
    expect((await call('GET', '/pages/kael-marrow-2?mode=author')).json().title).toBe('Kael Marrow (2)');
    await call('POST', `/tx/${res.txId}/undo`);
  });
  it('imports CSV (quoted cells, multi-values) and rejects bad input', async () => {
    const csv = 'title,aliases,tags,status,species,body\r\n"Rho, the Tall","Rho;Tall",a|b,draft,"Giant","Line one\nLine ""two"""\r\n,x,,,,\r\n';
    const prev = (await call('POST', '/import/preview', { format: 'csv', type: 'character', files: [{ path: 'c.csv', text: csv }] })).json();
    expect(prev.counts.create).toBe(1);
    expect(prev.counts.skip).toBe(1);
    const res = (await call('POST', '/import/commit', { format: 'csv', type: 'character', files: [{ path: 'c.csv', text: csv }] })).json();
    expect(res.created).toBe(1);
    const rho = (await call('GET', '/pages/rho-the-tall/raw?mode=author')).json();
    expect(rho).toMatchObject({ title: 'Rho, the Tall', aliases: ['Rho', 'Tall'], tags: ['a', 'b'] });
    expect(rho.body).toBe('Line one\nLine "two"');
    expect((await call('POST', '/import/preview', { format: 'csv', type: 'nope', files: [{ path: 'c.csv', text: csv }] })).status).toBe(400);
    expect((await call('POST', '/import/preview', { format: 'csv', type: 'character', files: [{ path: 'c.csv', text: 'name\nx' }] })).status).toBe(400);
  });
  it('round-trips a world through a JSON backup into a new world', async () => {
    await call('PUT', '/progress', { showAll: true });
    const backup = (await call('GET', '/export/json?spoilers=1')).json();
    await call('PUT', '/progress', { showAll: false });
    const res = await call('POST', '/api/v1/import/backup', { backup, name: 'Restored' });
    expect(res.status).toBe(201);
    const slug = res.json().slug;
    const total = (await call('GET', `/api/v1/worlds/${slug}/pages?mode=author&limit=1000`)).json().total;
    expect(total).toBe(backup.pages.length);
    const k = (await call('GET', `/api/v1/worlds/${slug}/pages/kael-marrow?mode=author`)).json();
    expect(k.html).toContain('splinter of the Cold Furnace');
    expect((await call('GET', `/api/v1/worlds/${slug}/timeline?mode=author`)).json().events.length).toBe(backup.timeline.length);
    expect((await call('POST', '/api/v1/import/backup', { backup: { format: 'nope' } })).status).toBe(400);
  });
});
