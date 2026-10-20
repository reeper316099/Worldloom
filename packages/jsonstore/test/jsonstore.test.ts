import { describe, expect, it, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { JsonFile, JsonStoreError, atomicWrite, stableStringify, withLock, zipBackup, restoreZip, watchDir, acquireInstanceLock } from '../src';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonstore-'));
});
const Schema = z.object({ schemaVersion: z.number().default(1), n: z.number(), name: z.string().default('x') });
type D = z.infer<typeof Schema>;

describe('jsonstore', () => {
  it('stable pretty JSON', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n');
  });

  it('atomic write leaves no tmp files', async () => {
    const f = path.join(dir, 'a.json');
    await Promise.all(Array.from({ length: 20 }, (_, i) => atomicWrite(f, String(i))));
    expect((await fs.readdir(dir)).filter((x) => x.endsWith('.tmp'))).toEqual([]);
  });

  it('mutex serialises concurrent updates', async () => {
    const jf = new JsonFile<D>(path.join(dir, 'c.json'), { schema: Schema, version: 1, defaults: () => ({ schemaVersion: 1, n: 0, name: 'x' }) });
    await jf.load();
    await Promise.all(Array.from({ length: 50 }, () => jf.update((d) => ({ ...d, n: d.n + 1 }))));
    expect((await jf.load()).n).toBe(50);
  });

  it('withLock orders tasks per key', async () => {
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((i) => withLock('k', async () => { await new Promise((r) => setTimeout(r, 10 - i * 3)); order.push(i); })));
    expect(order).toEqual([1, 2, 3]);
  });

  it('rejects invalid saves without touching disk', async () => {
    const f = path.join(dir, 'v.json');
    const jf = new JsonFile<D>(f, { schema: Schema, version: 1, defaults: () => ({ schemaVersion: 1, n: 1, name: 'x' }) });
    await jf.load();
    await expect(jf.save({ n: 'bad' } as unknown as D)).rejects.toThrow();
    expect(JSON.parse(await fs.readFile(f, 'utf8')).n).toBe(1);
  });

  it('corrupt file is quarantined and restored from backup', async () => {
    const f = path.join(dir, 'r.json');
    const opts = { schema: Schema, version: 1, backupDir: path.join(dir, 'bk'), defaults: () => ({ schemaVersion: 1, n: 0, name: 'x' }) };
    const jf = new JsonFile<D>(f, opts);
    await jf.load();
    await jf.save({ schemaVersion: 1, n: 7, name: 'x' });
    await jf.save({ schemaVersion: 1, n: 8, name: 'x' }); // backup now holds n:7
    await fs.writeFile(f, '{ not json');
    const again = await new JsonFile<D>(f, opts).load();
    expect(again.n).toBe(7);
    expect((await fs.readdir(dir)).some((x) => x.includes('.corrupt-'))).toBe(true);
  });

  it('parse errors carry file and line', () => {
    const jf = new JsonFile<D>(path.join(dir, 'p.json'), { schema: Schema });
    try {
      jf.parse('{\n"n": 1,\n oops }');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(JsonStoreError);
      expect((e as JsonStoreError).file).toContain('p.json');
    }
  });

  it('runs migrations in order and rejects newer versions', async () => {
    const f = path.join(dir, 'm.json');
    await fs.writeFile(f, '{"schemaVersion":1,"old":5}');
    const S = z.object({ schemaVersion: z.number(), n: z.number() });
    const jf = new JsonFile(f, { schema: S, version: 3, migrations: { 1: (d) => ({ ...d, mid: d.old }), 2: (d) => ({ n: d.mid * 2 }) } });
    expect((await jf.load()).n).toBe(10);
    await fs.writeFile(f, '{"schemaVersion":9,"n":1}');
    await expect(new JsonFile(f, { schema: S, version: 3 }).load()).rejects.toThrow();
  });

  it('zip backup round-trips, rotates and skips when recent', async () => {
    const src = path.join(dir, 'src');
    await atomicWrite(path.join(src, 'x/y.md'), 'hello');
    const bk = path.join(dir, 'backups');
    for (let i = 0; i < 4; i++) await zipBackup(src, bk, { keep: 3, reason: 't' + i });
    expect((await fs.readdir(bk)).length).toBe(3);
    expect(await zipBackup(src, bk, { minAgeMs: 60_000 })).toBeUndefined();
    const z = (await fs.readdir(bk)).sort().pop()!;
    const dest = path.join(dir, 'restored');
    await restoreZip(path.join(bk, z), dest);
    expect(await fs.readFile(path.join(dest, 'x/y.md'), 'utf8')).toBe('hello');
  });

  it('watcher reports external edits', async () => {
    const f = path.join(dir, 'w.md');
    await fs.writeFile(f, 'a');
    const events: string[] = [];
    const w = watchDir(dir, (e) => events.push(e.kind + ':' + path.basename(e.file)));
    await new Promise<void>((r) => w.on('ready', () => r()));
    await fs.writeFile(f, 'b');
    for (let i = 0; i < 50 && !events.includes('change:w.md'); i++) await new Promise((r) => setTimeout(r, 50));
    await w.close();
    expect(events).toContain('change:w.md');
  });

  it('instance lock blocks a second holder in a live process', async () => {
    const rel = await acquireInstanceLock(dir);
    await fs.writeFile(path.join(dir, '.lock'), String(process.ppid)); // pretend parent holds it
    await expect(acquireInstanceLock(dir)).rejects.toThrow(/another instance/);
    await rel();
  });
});
