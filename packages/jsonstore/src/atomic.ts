import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Codec } from './codec';

const queues = new Map<string, Promise<unknown>>();

/** Per-key mutex: serialises async work on the same key (usually a file path). */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  queues.set(key, next);
  const clear = () => {
    if (queues.get(key) === next) queues.delete(key);
  };
  next.then(clear, clear);
  return next;
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** Windows briefly locks files that watchers/antivirus/indexers hold open: retry instead of failing. */
export async function retryBusy<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || !BUSY.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await new Promise((r) => setTimeout(r, 15 * (i + 1)));
    }
  }
}

let counter = 0;

/** Atomic write: tmp file in same dir -> fsync -> rename. */
export async function atomicWrite(file: string, data: string | Uint8Array, codec?: Codec): Promise<void> {
  if (codec) data = codec.encode(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${counter++}.tmp`);
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await retryBusy(() => fs.rename(tmp, file));
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

export function locked(file: string) {
  return path.resolve(file);
}

/** JSON with sorted keys, 2-space indent, trailing newline. */
export function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .filter((k) => o[k] !== undefined)
          .map((k) => [k, sort(o[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}
