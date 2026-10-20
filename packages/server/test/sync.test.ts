import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';
import { SERIES } from '../../../starter-worlds/src/series';

interface Dev { name: string; manager: WorldManager; app: FastifyInstance; call: (m: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) => Promise<{ status: number; body: any; text: string }> } // eslint-disable-line @typescript-eslint/no-explicit-any
let root: string, A: Dev, B: Dev, shared: string;
const W = '/worlds/the-ashen-ascent';

async function device(name: string): Promise<Dev> {
  const manager = await new WorldManager(path.join(root, name), { revisionDebounceMs: 0 }).init();
  const app = await buildApp({ token: 't', manager });
  const call: Dev['call'] = async (method, url, body) => {
    const r = await app.inject({ method, url: '/api/v1' + url, headers: { authorization: 'Bearer t' }, payload: body as object });
    let json: unknown; try { json = JSON.parse(r.body); } catch { json = undefined; }
    return { status: r.statusCode, body: json, text: r.body };
  };
  return { name, manager, app, call };
}
const raw = async (d: Dev, ref: string) => (await d.call('GET', `${W}/pages/${ref}/raw?mode=author`)).body;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-sync-'));
  shared = path.join(root, 'shared');
  await fs.mkdir(shared);
  A = await device('A');
  B = await device('B');
  await A.call('POST', '/starter-worlds/the-ashen-ascent/install');
});
afterAll(async () => { for (const d of [A, B]) { await d.app.close(); await d.manager.close(); } });

describe('bundle share & merge', () => {
  let bundle: string;
  it('exports a bundle that a second machine can import as a new world', async () => {
    bundle = (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text;
    expect(JSON.parse(bundle)).toMatchObject({ format: 'worldloom-bundle', includesSpoilers: true });
    const r = await B.call('POST', '/import/backup', { backup: JSON.parse(bundle), name: 'B copy' });
    expect(r.status).toBe(201);
    expect(r.body.slug).toBe('b-copy');
    expect(r.body.syncId).toBe((JSON.parse(bundle) as { origin: { worldId: string } }).origin.worldId);
    expect((await B.call('GET', '/worlds/b-copy/pages?mode=author&limit=1000')).body.total).toBe(SERIES.pages.length);
  });

  it('never ships personal reading progress', async () => {
    await A.call('PUT', `${W}/progress`, { sources: { wn: 222 } });
    const b = JSON.parse((await A.call('POST', `${W}/sync/export`, { spoilers: true })).text);
    expect(JSON.stringify(b.world)).not.toContain('222');
    expect(b.world.progress).toBeUndefined();
    await A.call('PUT', `${W}/progress`, { sources: { wn: 0 } });
  });

  it('merges non-overlapping edits from both sides and is undoable', async () => {
    await A.call('PATCH', `${W}/pages/ashmere`, { body: 'Ashmere, edited on A.' });
    await A.call('POST', `${W}/pages`, { type: 'character', title: 'Only On A', body: 'new on A' });
    await B.call('PATCH', '/worlds/b-copy/pages/keld-pass', { body: 'Keld Pass, edited on B.' });
    const fromA = (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text;
    const prev = (await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: fromA })).body;
    const act = (title: string) => prev.items.find((i: { title: string }) => i.title === title)?.action;
    expect(act('Ashmere')).toBe('update');
    expect(act('Only On A')).toBe('add');
    expect(act('Keld Pass')).toBe('keep-local');
    expect(prev.counts.conflict).toBeUndefined();
    expect((await B.call('GET', '/worlds/b-copy/pages/ashmere/raw?mode=author')).body.body).not.toContain('edited on A'); // preview wrote nothing

    const res = await B.call('POST', '/worlds/b-copy/sync/apply', { bundle: fromA });
    expect(res.status).toBe(200);
    expect((await B.call('GET', '/worlds/b-copy/pages/ashmere/raw?mode=author')).body.body).toBe('Ashmere, edited on A.');
    expect((await B.call('GET', '/worlds/b-copy/pages/keld-pass/raw?mode=author')).body.body).toBe('Keld Pass, edited on B.');
    expect((await B.call('GET', '/worlds/b-copy/pages/only-on-a?mode=author')).status).toBe(200);
    expect((await fs.readdir(path.join(root, 'B/backups/b-copy'))).some((f) => f.includes('pre-sync'))).toBe(true);

    // merging the same bundle again is a no-op
    const again = (await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: fromA })).body;
    expect(again.counts.update ?? 0).toBe(0);
    expect(again.counts.add ?? 0).toBe(0);

    expect((await B.call('POST', `/worlds/b-copy/tx/${res.body.txId}/undo`)).status).toBe(200);
    expect((await B.call('GET', '/worlds/b-copy/pages/only-on-a?mode=author')).status).toBe(404);
    expect((await B.call('GET', '/worlds/b-copy/pages/ashmere/raw?mode=author')).body.body).not.toContain('edited on A');
  });

  it('detects real conflicts and never silently loses text', async () => {
    await B.call('POST', '/worlds/b-copy/sync/apply', { bundle: (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text });
    await A.call('PATCH', `${W}/pages/cinder-guild`, { body: 'Guild, A version.' });
    await wait(15);
    await B.call('PATCH', '/worlds/b-copy/pages/cinder-guild', { body: 'Guild, B version.' }); // B edited later
    const fromA = (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text;
    const prev = (await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: fromA })).body;
    expect(prev.items.find((i: { title: string }) => i.title === 'Cinder Guild')).toMatchObject({ action: 'conflict' });

    // 'newer' (default): B's later edit stays, A's version is kept as a conflict page
    await B.call('POST', '/worlds/b-copy/sync/apply', { bundle: fromA });
    expect((await B.call('GET', '/worlds/b-copy/pages/cinder-guild/raw?mode=author')).body.body).toBe('Guild, B version.');
    const list = (await B.call('GET', '/worlds/b-copy/pages?mode=author&limit=1000')).body.items as Array<{ title: string; slug: string }>;
    const copy = list.find((p) => p.title.startsWith('Cinder Guild (conflict'));
    expect(copy).toBeTruthy();
    expect((await B.call('GET', `/worlds/b-copy/pages/${copy!.slug}/raw?mode=author`)).body).toMatchObject({ body: 'Guild, A version.', status: 'draft', tags: expect.arrayContaining(['sync-conflict']) });

    // 'remote' resolution takes A's text instead (still keeping nothing extra when asked for plain remote)
    await B.call('PATCH', '/worlds/b-copy/pages/ashmere', { body: 'B again' });
    await A.call('PATCH', `${W}/pages/ashmere`, { body: 'A again' });
    const r2 = (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text;
    const before = (await B.call('GET', '/worlds/b-copy/pages?mode=author&limit=1000')).body.total;
    await B.call('POST', '/worlds/b-copy/sync/apply', { bundle: r2, resolution: 'remote' });
    expect((await B.call('GET', '/worlds/b-copy/pages/ashmere/raw?mode=author')).body.body).toBe('A again');
    expect((await B.call('GET', '/worlds/b-copy/pages?mode=author&limit=1000')).body.total).toBe(before);
  });

  it('keeps pages you deleted and pages deleted on the other side', async () => {
    const x = (await A.call('POST', `${W}/pages`, { type: 'character', title: 'Doomed', body: 'x' })).body;
    await B.call('POST', '/worlds/b-copy/sync/apply', { bundle: (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text });
    expect((await B.call('GET', '/worlds/b-copy/pages/doomed?mode=author')).status).toBe(200);
    await B.call('DELETE', '/worlds/b-copy/pages/doomed'); // deleted on B after syncing
    const again = (await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text })).body;
    expect(again.items.find((i: { id: string }) => i.id === x.id)).toMatchObject({ action: 'skip' });
    void x;
  });

  it('adds same-titled pages created independently instead of overwriting', async () => {
    await A.call('POST', `${W}/pages`, { type: 'character', title: 'Twin', body: 'A twin' });
    await B.call('POST', '/worlds/b-copy/pages', { type: 'character', title: 'Twin', body: 'B twin' });
    await B.call('POST', '/worlds/b-copy/sync/apply', { bundle: (await A.call('POST', `${W}/sync/export`, { spoilers: true })).text });
    const titles = ((await B.call('GET', '/worlds/b-copy/pages?mode=author&limit=1000')).body.items as Array<{ title: string }>).map((p) => p.title);
    expect(titles).toEqual(expect.arrayContaining(['Twin', 'Twin (from sync)']));
  });
});

describe('spoiler-safe sharing and sealed bundles', () => {
  it('a bundle without spoilers contains none and never overwrites existing pages', async () => {
    await A.call('PUT', `${W}/progress`, { sources: { wn: 0, adapt: 0, recap: 0 }, showAll: false });
    const text = (await A.call('POST', `${W}/sync/export`, { spoilers: false })).text;
    for (const s of SERIES.secrets) expect(text, s).not.toContain(s);
    expect(JSON.parse(text).includesSpoilers).toBe(false);
    // import into B's world: nothing is overwritten
    const prev = (await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: text })).body;
    expect(prev.includesSpoilers).toBe(false);
    expect(prev.items.filter((i: { action: string }) => i.action === 'update' || i.action === 'conflict')).toEqual([]);
    const k = (await B.call('GET', '/worlds/b-copy/pages/kael-marrow/raw?mode=author')).body.body as string;
    await B.call('POST', '/worlds/b-copy/sync/apply', { bundle: text });
    expect((await B.call('GET', '/worlds/b-copy/pages/kael-marrow/raw?mode=author')).body.body).toBe(k);
  });

  it('seals with a passphrase and rejects wrong passphrases and tampering', async () => {
    const sealed = (await A.call('POST', `${W}/sync/export`, { spoilers: true, passphrase: 'share secret 1' })).text;
    expect(JSON.parse(sealed).format).toBe('worldloom-sealed');
    expect(sealed).not.toContain('Kael Marrow');
    expect((await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: sealed })).body.error.code).toBe('bundle_passphrase_required');
    expect((await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: sealed, passphrase: 'nope nope' })).status).toBe(401);
    expect((await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: sealed, passphrase: 'share secret 1' })).status).toBe(200);
    const j = JSON.parse(sealed);
    j.data = j.data.slice(0, -8) + 'AAAAAAAA';
    expect((await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: JSON.stringify(j), passphrase: 'share secret 1' })).status).toBe(401);
  });

  it('rejects junk and invalid bundles', async () => {
    for (const bad of ['not json', '{}', JSON.stringify({ format: 'worldloom-bundle', version: 1, origin: { worldId: 'x' }, pages: [{ id: 1 }] })]) {
      expect((await B.call('POST', '/worlds/b-copy/sync/preview', { bundle: bad })).status).toBe(400);
    }
  });
});

describe('folder sync (Dropbox-style shared folder)', () => {
  it('pushes, joins on another machine, and keeps both sides in step', async () => {
    const first = await A.call('POST', `${W}/sync/folder`, { path: shared, apply: true });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ wrote: true });
    const files = (await A.call('GET', `/sync/folder-files?path=${encodeURIComponent(shared)}`)).body;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('The Ashen Ascent');

    const C = await device('C');
    const joined = await C.call('POST', '/sync/join', { path: shared, file: files[0].file, name: 'Joined' });
    expect(joined.status).toBe(201);
    const Wc = '/worlds/joined';
    expect((await C.call('GET', `${Wc}/pages?mode=author&limit=1000`)).body.total).toBe((await A.call('GET', `${W}/pages?mode=author&limit=1000`)).body.total);

    await C.call('PATCH', `${Wc}/pages/ashmere`, { body: 'Edited on C.' });
    expect((await C.call('POST', `${Wc}/sync/folder`, { path: shared, apply: true })).body.wrote).toBe(true);
    await A.call('PATCH', `${W}/pages/keld-pass`, { body: 'Edited on A.' });
    const pulled = (await A.call('POST', `${W}/sync/folder`, { path: shared, apply: true })).body;
    expect(pulled.plan.counts.update).toBe(1);
    expect((await raw(A, 'ashmere')).body).toBe('Edited on C.');
    // C picks up A's edit on its next sync
    await C.call('POST', `${Wc}/sync/folder`, { path: shared, apply: true });
    expect((await C.call('GET', `${Wc}/pages/keld-pass/raw?mode=author`)).body.body).toBe('Edited on A.');
    await C.app.close(); await C.manager.close();
  });

  it('preview (apply:false) writes nothing', async () => {
    const file = path.join(shared, (await fs.readdir(shared))[0]!);
    const before = await fs.readFile(file, 'utf8');
    await A.call('PATCH', `${W}/pages/ashmere`, { body: 'preview only' });
    const r = await A.call('POST', `${W}/sync/folder`, { path: shared, apply: false });
    expect(r.body.wrote).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('validates paths and file names', async () => {
    expect((await A.call('POST', `${W}/sync/folder`, { path: 'relative/dir', apply: true })).status).toBe(400);
    expect((await A.call('POST', `${W}/sync/folder`, { path: path.join(root, 'nope'), apply: true })).status).toBe(400);
    expect((await A.call('POST', '/sync/join', { path: shared, file: '../../etc/passwd' })).status).toBe(400);
    expect((await A.call('POST', '/sync/join', { path: shared, file: 'x.txt' })).status).toBe(400);
  });

  it('requires a passphrase for encrypted worlds so sync files are never plaintext', async () => {
    const D = await device('D');
    await D.call('POST', '/worlds', { name: 'Private', slug: 'private' });
    await D.call('POST', '/worlds/private/pages', { type: 'character', title: 'Hidden Person', body: 'MARKER-ENC-SYNC' });
    await D.call('POST', '/worlds/private/encryption/enable', { passphrase: 'a long passphrase' });
    const dir = path.join(root, 'shared-enc');
    await fs.mkdir(dir);
    expect((await D.call('POST', '/worlds/private/sync/folder', { path: dir, apply: true })).status).toBe(400);
    expect((await D.call('POST', '/worlds/private/sync/export', { spoilers: true })).status).toBe(400);
    const ok = await D.call('POST', '/worlds/private/sync/folder', { path: dir, apply: true, passphrase: 'bundle pass phrase' });
    expect(ok.status).toBe(200);
    const content = await fs.readFile(path.join(dir, (await fs.readdir(dir))[0]!), 'utf8');
    expect(content).not.toContain('MARKER-ENC-SYNC');
    expect(content).not.toContain('Hidden Person');
    await D.app.close(); await D.manager.close();
  });
});
