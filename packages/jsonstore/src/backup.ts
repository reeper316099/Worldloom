import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { atomicWrite, retryBusy } from './atomic';

/** Small per-file rolling snapshots (plain copies) used for corruption recovery. */
let snapSeq = 0;

export async function snapshotFile(file: string, dir: string, keep = 5): Promise<void> {
  let text: string;
  try {
    text = await retryBusy(() => fs.readFile(file, 'utf8'));
  } catch {
    return;
  }
  const base = path.basename(file);
  await fs.mkdir(dir, { recursive: true });
  await atomicWrite(path.join(dir, `${base}.${Date.now()}-${String(snapSeq++).padStart(6, '0')}.bak`), text);
  const all = (await fs.readdir(dir)).filter((f) => f.startsWith(base + '.') && f.endsWith('.bak')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) await fs.rm(path.join(dir, old), { force: true });
}

export async function restoreLatest(dir: string, base: string): Promise<string | undefined> {
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.startsWith(base + '.') && f.endsWith('.bak')).sort();
  } catch {
    return undefined;
  }
  for (const f of files.reverse()) {
    try {
      const t = await fs.readFile(path.join(dir, f), 'utf8');
      JSON.parse(t);
      return t;
    } catch {
      /* try older */
    }
  }
  return undefined;
}

async function walk(dir: string, root: string, out: Record<string, Uint8Array>) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, root, out);
    else if (e.isFile() && !e.name.endsWith('.tmp'))
      out[path.relative(root, full).split(path.sep).join('/')] = new Uint8Array(await fs.readFile(full));
  }
}

export interface ZipBackupOptions {
  keep?: number;
  /** Only create if the newest backup is older than this (ms). */
  minAgeMs?: number;
  reason?: string;
  exclude?: string[]; // top-level dir names to skip
}

/** Zip `srcDir` into `backupsDir`. Returns path or undefined if skipped (too recent). */
export async function zipBackup(srcDir: string, backupsDir: string, o: ZipBackupOptions = {}) {
  await fs.mkdir(backupsDir, { recursive: true });
  const existing = (await fs.readdir(backupsDir)).filter((f) => f.endsWith('.zip')).sort();
  if (o.minAgeMs && existing.length) {
    const st = await fs.stat(path.join(backupsDir, existing[existing.length - 1]!));
    if (Date.now() - st.mtimeMs < o.minAgeMs) return undefined;
  }
  const files: Record<string, Uint8Array> = {};
  await walk(srcDir, srcDir, files);
  for (const k of Object.keys(files)) if (o.exclude?.includes(k.split('/')[0]!)) delete files[k];
  files['.backup-reason'] = strToU8(o.reason ?? 'manual');
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${o.reason ?? 'manual'}.zip`;
  const out = path.join(backupsDir, name);
  await atomicWrite(out, zipSync(files));
  const all = (await fs.readdir(backupsDir)).filter((f) => f.endsWith('.zip')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - (o.keep ?? 20)))) await fs.rm(path.join(backupsDir, old), { force: true });
  return out;
}

export async function restoreZip(zipFile: string, destDir: string): Promise<void> {
  const files = unzipSync(new Uint8Array(await fs.readFile(zipFile)));
  const root = path.resolve(destDir);
  for (const [rel, data] of Object.entries(files)) {
    if (rel === '.backup-reason') continue;
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) throw new Error('unsafe path in backup: ' + strFromU8(strToU8(rel)));
    await atomicWrite(target, data);
  }
}
