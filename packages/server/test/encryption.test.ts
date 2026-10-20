import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WorldManager, buildApp } from '../src';

const MARKER = 'ZEBRA-SECRET-42';
const PASS = 'correct horse battery';
let dir: string, data: string, app: FastifyInstance, manager: WorldManager;
const H = { authorization: 'Bearer t' };
const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown) => {
  const r = await app.inject({ method, url: '/api/v1' + url, headers: H, payload: body as object });
  return { status: r.statusCode, body: r.body && r.headers['content-type']?.toString().includes('json') ? JSON.parse(r.body) : r.body, raw: r };
};
async function allFiles(d: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) out.push(...(await allFiles(f)));
    else out.push(f);
  }
  return out;
}
const hasMarkerOnDisk = async (root: string) => {
  for (const f of await allFiles(root)) {
    if (f.endsWith('crypto.json')) continue;
    if ((await fs.readFile(f)).includes(Buffer.from(MARKER))) return f;
    if (f.toLowerCase().includes('zebra')) return f;
  }
  return null;
};
const start = async () => {
  manager = await new WorldManager(data, { revisionDebounceMs: 0, watch: true }).init();
  app = await buildApp({ token: 't', manager });
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-enc-'));
  data = path.join(dir, 'data');
  await start();
  await call('POST', '/worlds', { name: 'Vault', slug: 'vault' });
  const page = (await call('POST', '/worlds/vault/pages', { type: 'character', title: 'Zebra Person', body: `Secret: ${MARKER}. Links [[Other]].` })).body;
  await call('POST', '/worlds/vault/pages', { type: 'character', title: 'Other', body: 'plain' });
  await call('PATCH', `/worlds/vault/pages/${page.id}`, { body: `Edited ${MARKER}` }); // creates a revision
  await call('PUT', '/worlds/vault/boards/b1?mode=author', { name: `Board ${MARKER}`, tiers: [{ id: 's', label: 'S' }], placements: { s: [page.id] }, pool: [] });
  await app.inject({ method: 'POST', url: '/api/v1/worlds/vault/assets', headers: { ...H, 'content-type': 'image/png' }, payload: Buffer.from('89504e470d0a1a0a0000000d49484452' + Buffer.from(MARKER).toString('hex'), 'hex') });
});
afterAll(async () => { await app.close(); await manager.close(); });

describe('encrypted worlds', () => {
  it('plaintext marker exists before encryption', async () => {
    expect(await hasMarkerOnDisk(path.join(data, 'worlds/vault'))).toBeTruthy();
  });

  it('enabling encrypts every file, hides titles in file names and purges plaintext backups', async () => {
    expect((await call('POST', '/worlds/vault/encryption/enable', { passphrase: 'short' })).status).toBe(400);
    const r = await call('POST', '/worlds/vault/encryption/enable', { passphrase: PASS, label: 'My vault' });
    expect(r.status).toBe(200);
    expect(await hasMarkerOnDisk(path.join(data, 'worlds/vault'))).toBeNull();
    expect(await hasMarkerOnDisk(path.join(data, 'backups'))).toBeNull();
    const pages = await fs.readdir(path.join(data, 'worlds/vault/pages/character'));
    expect(pages.every((p) => /^p_[a-f0-9]+\.md$/.test(p))).toBe(true);
    // still fully usable while unlocked
    expect((await call('GET', '/worlds/vault/pages/zebra-person?mode=author')).body.html).toContain(MARKER);
    expect((await call('GET', '/worlds/vault/search?mode=author&q=zebra')).body).toHaveLength(1);
    const asset = (await call('GET', '/worlds/vault/assets/' + (await fs.readdir(path.join(data, 'worlds/vault/assets')))[0]));
    expect(asset.status).toBe(200);
    expect(Buffer.from(asset.raw.rawPayload).includes(Buffer.from(MARKER))).toBe(true);
    // writes after enabling are encrypted too
    await call('PATCH', '/worlds/vault/pages/other', { body: `new ${MARKER}` });
    expect(await hasMarkerOnDisk(path.join(data, 'worlds/vault'))).toBeNull();
  });

  it('locking makes the world unreadable and hides its name', async () => {
    expect((await call('POST', '/worlds/vault/lock')).status).toBe(200);
    expect((await call('GET', '/worlds/vault/pages')).status).toBe(423);
    expect((await call('GET', '/worlds/vault')).body.error.code).toBe('locked');
    const list = (await call('GET', '/worlds')).body;
    expect(list.find((w: { slug: string }) => w.slug === 'vault')).toMatchObject({ name: 'My vault', encrypted: true, locked: true });
    expect(JSON.stringify(list)).not.toContain('Zebra');
  });

  it('rejects wrong passphrases (with throttling) and accepts the right one', async () => {
    expect((await call('POST', '/worlds/vault/unlock', { passphrase: 'nope nope nope' })).status).toBe(401);
    expect((await call('POST', '/worlds/vault/unlock', { passphrase: 'nope again' })).status).toBe(429);
    await new Promise((r) => setTimeout(r, 900));
    expect((await call('POST', '/worlds/vault/unlock', { passphrase: PASS })).status).toBe(200);
    expect((await call('GET', '/worlds/vault/pages/zebra-person?mode=author')).body.html).toContain(MARKER);
    expect((await call('GET', '/worlds/vault/boards/b1?mode=author')).body.name).toContain(MARKER);
    expect((await call('GET', '/worlds/vault/history/zebra-person?mode=author')).body.length).toBeGreaterThan(1);
  });

  it('survives an app restart: locked until unlocked, data intact', async () => {
    await app.close(); await manager.close();
    await start();
    expect((await call('GET', '/worlds/vault/pages')).status).toBe(423);
    await call('POST', '/worlds/vault/unlock', { passphrase: PASS });
    expect((await call('GET', '/worlds/vault/pages/other?mode=author')).body.html).toContain(MARKER);
  });

  it('detects tampering without losing the page in memory', async () => {
    const f = path.join(data, 'worlds/vault/pages/character', (await fs.readdir(path.join(data, 'worlds/vault/pages/character')))[0]!);
    const buf = await fs.readFile(f);
    const original = Buffer.from(buf);
    buf[buf.length - 3] = buf[buf.length - 3]! ^ 0xff;
    await fs.writeFile(f, buf);
    await (await manager.get('vault')).ingestFile(f); // same path the file watcher takes (watcher timing is covered in api.test.ts)
    const h = (await call('GET', '/worlds/vault/health-report?mode=author')).body;
    expect(h.fileErrors.length).toBeGreaterThan(0);
    expect(h.fileErrors[0].message).toContain('decryption failed');
    expect((await call('GET', '/worlds/vault/pages?mode=author')).body.total).toBe(2); // still in memory
    await fs.writeFile(f, original); // repair
    await (await manager.get('vault')).ingestFile(f);
    expect((await call('GET', '/worlds/vault/health-report?mode=author')).body.fileErrors).toEqual([]);
  });

  it('changes the passphrase without rewriting world files', async () => {
    const before = (await fs.stat(path.join(data, 'worlds/vault/world.json'))).mtimeMs;
    expect((await call('POST', '/worlds/vault/encryption/change', { passphrase: 'wrong wrong', newPassphrase: 'a new passphrase' })).status).toBe(401);
    await new Promise((r) => setTimeout(r, 900));
    expect((await call('POST', '/worlds/vault/encryption/change', { passphrase: PASS, newPassphrase: 'a new passphrase' })).status).toBe(200);
    expect((await fs.stat(path.join(data, 'worlds/vault/world.json'))).mtimeMs).toBe(before);
    await call('POST', '/worlds/vault/lock');
    await new Promise((r) => setTimeout(r, 900));
    expect((await call('POST', '/worlds/vault/unlock', { passphrase: PASS })).status).toBe(401);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await call('POST', '/worlds/vault/unlock', { passphrase: 'a new passphrase' })).status).toBe(200);
  });

  it('finishes an interrupted migration on unlock and tolerates mixed plain/encrypted files', async () => {
    // simulate a crash: one page file back in plaintext, marker says "encrypting"
    const repoDir = path.join(data, 'worlds/vault');
    const { createAesCodec } = await import('@worldloom/jsonstore');
    const { readCryptoMeta, unwrapKey, writeCryptoMeta } = await import('../src/crypto-world');
    const meta = (await readCryptoMeta(repoDir))!;
    const key = (await unwrapKey(meta, 'a new passphrase'))!;
    const codec = createAesCodec(key);
    const pagesDir = path.join(repoDir, 'pages/character');
    const file = path.join(pagesDir, (await fs.readdir(pagesDir)).find((f) => f.startsWith('p_'))!);
    const plain = Buffer.from(codec.decode(await fs.readFile(file)));
    await fs.writeFile(file, plain);
    await writeCryptoMeta(repoDir, { ...meta, state: 'encrypting' });
    await call('POST', '/worlds/vault/lock');
    await new Promise((r) => setTimeout(r, 1500));
    expect((await call('POST', '/worlds/vault/unlock', { passphrase: 'a new passphrase' })).status).toBe(200);
    expect(await hasMarkerOnDisk(repoDir)).toBeNull();
    expect((await readCryptoMeta(repoDir))!.state).toBe('ready');
  });

  it('auto-locks after idle time', async () => {
    await app.close(); await manager.close();
    // generous window: a slow CI runner can stall for hundreds of ms between unlock and the first read
    manager = await new WorldManager(data, { revisionDebounceMs: 0 }, undefined, { autoLockMs: 2500 }).init();
    app = await buildApp({ token: 't', manager });
    const unlock = await call('POST', '/worlds/vault/unlock', { passphrase: 'a new passphrase' });
    expect(unlock.status, `unlock: ${JSON.stringify(unlock.body)}`).toBe(200);
    expect((await call('GET', '/worlds/vault/pages')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 4500));
    expect((await call('GET', '/worlds/vault/pages')).status).toBe(423);
  });

  it('disabling decrypts everything back to readable Markdown with slug names', async () => {
    await app.close(); await manager.close();
    await start();
    await new Promise((r) => setTimeout(r, 1500));
    await call('POST', '/worlds/vault/unlock', { passphrase: 'a new passphrase' });
    expect((await call('POST', '/worlds/vault/encryption/disable', { passphrase: 'nope nope nope' })).status).toBe(401);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await call('POST', '/worlds/vault/encryption/disable', { passphrase: 'a new passphrase' })).status).toBe(200);
    await expect(fs.access(path.join(data, 'worlds/vault/crypto.json'))).rejects.toThrow();
    expect(await fs.readdir(path.join(data, 'worlds/vault/pages/character'))).toEqual(expect.arrayContaining(['zebra-person.md', 'other.md']));
    const md = await fs.readFile(path.join(data, 'worlds/vault/pages/character/zebra-person.md'), 'utf8');
    expect(md).toContain(MARKER);
    expect((await call('GET', '/worlds/vault/pages/zebra-person?mode=author')).status).toBe(200);
  });

  it('deleting a locked encrypted world works without the passphrase', async () => {
    await call('POST', '/worlds/vault/encryption/enable', { passphrase: PASS });
    await call('POST', '/worlds/vault/lock');
    expect((await call('DELETE', '/worlds/vault?confirm=yes')).status).toBe(204);
  });
});
