import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ZodType } from 'zod';
import { atomicWrite, locked, stableStringify, withLock } from './atomic';
import { snapshotFile, restoreLatest } from './backup';

export type Migration = (data: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface JsonFileOptions<T> {
  schema: ZodType<T, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Current schema version; files carry `schemaVersion`. */
  version?: number;
  /** migrations[n] upgrades data from version n to n+1. */
  migrations?: Record<number, Migration>;
  /** Produce default contents when the file doesn't exist. */
  defaults?: () => T;
  /** Extra validation hook run after schema parse; throw to reject. */
  validate?: (data: T) => void;
  /** Directory for backups of this file (rolling, used for corruption recovery). */
  backupDir?: string;
}

export class JsonStoreError extends Error {
  constructor(
    message: string,
    public file: string,
    public line?: number,
  ) {
    super(message);
  }
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function migrate(data: any, version: number, migrations: Record<number, Migration> = {}) {
  let v = typeof data?.schemaVersion === 'number' ? data.schemaVersion : 1;
  if (v > version) throw new Error(`file schemaVersion ${v} is newer than supported ${version}`);
  while (v < version) {
    const m = migrations[v];
    if (!m) throw new Error(`missing migration ${v} -> ${v + 1}`);
    data = { ...m(data), schemaVersion: v + 1 };
    v++;
  }
  return data;
}

function jsonErrorLine(text: string, err: unknown): number | undefined {
  const m = /position (\d+)/.exec(String((err as Error)?.message));
  if (!m) return undefined;
  return text.slice(0, Number(m[1])).split('\n').length;
}

/** A single validated JSON document on disk with atomic writes and self-healing reads. */
export class JsonFile<T> {
  private cache: T | undefined;
  readonly file: string;
  constructor(
    file: string,
    private opts: JsonFileOptions<T>,
  ) {
    this.file = path.resolve(file);
  }

  /** Read from disk (validated). Corrupt files are quarantined and restored from backup. */
  async load(): Promise<T> {
    return withLock(locked(this.file), async () => {
      let text: string;
      try {
        text = await fs.readFile(this.file, 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          if (!this.opts.defaults) throw new JsonStoreError('file not found', this.file);
          const d = this.opts.defaults();
          await this.writeUnlocked(d);
          return d;
        }
        throw e;
      }
      try {
        return (this.cache = this.parse(text));
      } catch (e) {
        return (this.cache = await this.recover(text, e));
      }
    });
  }

  /** Parse+validate text without touching disk or cache. Throws JsonStoreError with line info. */
  parse(text: string): T {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new JsonStoreError(`invalid JSON: ${(e as Error).message}`, this.file, jsonErrorLine(text, e));
    }
    try {
      const migrated = this.opts.version ? migrate(raw, this.opts.version, this.opts.migrations) : raw;
      const data = this.opts.schema.parse(migrated);
      this.opts.validate?.(data);
      return data;
    } catch (e) {
      throw new JsonStoreError(`validation failed: ${(e as Error).message}`, this.file);
    }
  }

  private async recover(text: string, cause: unknown): Promise<T> {
    const q = `${this.file}.corrupt-${Date.now()}`;
    await fs.writeFile(q, text);
    if (this.opts.backupDir) {
      const restored = await restoreLatest(this.opts.backupDir, path.basename(this.file));
      if (restored !== undefined) {
        try {
          const data = this.parse(restored);
          await this.writeUnlocked(data);
          return data;
        } catch {
          /* fall through */
        }
      }
    }
    if (this.opts.defaults) {
      const d = this.opts.defaults();
      await this.writeUnlocked(d);
      return d;
    }
    throw cause;
  }

  get(): T | undefined {
    return this.cache;
  }

  private async writeUnlocked(data: T) {
    const validated = this.opts.schema.parse(data);
    this.opts.validate?.(validated);
    const out = this.opts.version ? { ...validated, schemaVersion: this.opts.version } : validated;
    if (this.opts.backupDir) await snapshotFile(this.file, this.opts.backupDir).catch(() => undefined);
    await atomicWrite(this.file, stableStringify(out));
    this.cache = validated;
  }

  /** Validate and persist. */
  save(data: T): Promise<void> {
    return withLock(locked(this.file), () => this.writeUnlocked(data));
  }

  /** Read-modify-write under the file lock. */
  update(fn: (current: T) => T | void): Promise<T> {
    return withLock(locked(this.file), async () => {
      let current: T;
      try {
        current = this.parse(await fs.readFile(this.file, 'utf8'));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' && this.opts.defaults) current = this.opts.defaults();
        else throw e;
      }
      const next = (fn(current) ?? current) as T;
      await this.writeUnlocked(next);
      return next;
    });
  }
}
