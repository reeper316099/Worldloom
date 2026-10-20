import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { DATA_DIR_ENV, EntityTypesFileSchema, RelationsFileSchema, TimelineFileSchema, WorldSchema, slugify, type World } from '@worldloom/shared';
import { JsonFile, zipBackup, type Codec } from '@worldloom/jsonstore';
import { WorldRepo, type RepoOptions } from './repo';
import { ApiError, badRequest, conflict, notFound } from './errors';
import { CRYPTO_FILE, codecFor, convertTree, newKdf, readCryptoMeta, unwrapKey, wrapKey, writeCryptoMeta, type CryptoMeta } from './crypto-world';
import crypto from 'node:crypto';
import { markSynced } from './sync';
import { BUILTIN_PACKS } from './packs';
import { DEFAULT_LOREKEEPER } from './lorekeeper';
import { defaultStarterDir, installStarter, listStarters } from './starters';

export const SettingsSchema = z.object({
  schemaVersion: z.number().default(1),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  hideTitles: z.boolean().default(false),
  blurStrength: z.number().min(0).max(40).default(8),
  hideImages: z.boolean().default(true),
  /** Lock encrypted worlds after this many idle minutes (0 = never). */
  /** Identifies this installation in sync bundles. */
  deviceId: z.string().default(''),
  autoLockMinutes: z.number().int().min(0).max(1440).default(0),
  vimMode: z.boolean().default(false),
  integrations: z.object({ lorekeeper: z.object({ enabled: z.boolean().default(false), baseUrl: z.string().default(DEFAULT_LOREKEEPER.baseUrl), token: z.string().default('') }).default({}) }).default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export function defaultDataDir(): string {
  if (process.env[DATA_DIR_ENV]) return path.resolve(process.env[DATA_DIR_ENV]!);
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Worldloom');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Worldloom');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Worldloom');
}

export class WorldManager {
  readonly events = new EventEmitter();
  private repos = new Map<string, WorldRepo>();
  settingsFile: JsonFile<Settings>;
  constructor(
    readonly dataDir: string,
    private repoOpts: RepoOptions = {},
    readonly starterDir: string = defaultStarterDir(),
    private opts: { autoLockMs?: number } = {},
  ) {
    this.settingsFile = new JsonFile(path.join(dataDir, 'config', 'settings.json'), {
      schema: SettingsSchema, version: 1, defaults: () => SettingsSchema.parse({}), backupDir: path.join(dataDir, 'backups', 'files', 'config'),
    });
  }
  private worldsDir() {
    return path.join(this.dataDir, 'worlds');
  }
  async init(o: { launchBackup?: boolean } = {}) {
    await fs.mkdir(this.worldsDir(), { recursive: true });
    await fs.mkdir(path.join(this.dataDir, 'logs'), { recursive: true });
    await this.settingsFile.load();
    if (!this.settings.deviceId) await this.settingsFile.save({ ...this.settings, deviceId: crypto.randomBytes(8).toString('hex') });
    this.startAutoLock();
    if (o.launchBackup) await zipBackup(this.worldsDir(), path.join(this.dataDir, 'backups', 'launch'), { minAgeMs: 6 * 3600_000, reason: 'launch' }).catch(() => undefined);
    return this;
  }
  get settings(): Settings {
    return this.settingsFile.get() ?? SettingsSchema.parse({});
  }
  async slugs(): Promise<string[]> {
    const out: string[] = [];
    for (const e of await fs.readdir(this.worldsDir(), { withFileTypes: true })) {
      if (e.isDirectory()) {
        try {
          await fs.access(path.join(this.worldsDir(), e.name, 'world.json'));
          out.push(e.name);
        } catch {
          /* not a world */
        }
      }
    }
    return out.sort();
  }
  private opening = new Map<string, Promise<WorldRepo>>();
  private keys = new Map<string, Buffer>(); // unlocked data keys (memory only)
  private lastUse = new Map<string, number>();
  private failed = new Map<string, { n: number; until: number }>();
  private timer?: ReturnType<typeof setInterval>;
  /** One repo per world, even when many requests arrive at once (the in-flight open is shared). */
  async get(slug: string): Promise<WorldRepo> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw notFound('world');
    const hit = this.repos.get(slug);
    if (hit) {
      this.lastUse.set(slug, Date.now());
      return hit;
    }
    let p = this.opening.get(slug);
    if (!p) {
      p = (async () => {
        const dir = path.join(this.worldsDir(), slug);
        try {
          await fs.access(path.join(dir, 'world.json'));
        } catch {
          throw notFound('world');
        }
        const meta = await readCryptoMeta(dir);
        let codec: Codec | undefined;
        if (meta) {
          const key = this.keys.get(slug);
          if (!key) throw new ApiError(423, 'locked', 'This world is locked. Unlock it with its passphrase.');
          codec = codecFor(key);
        }
        const repo = await new WorldRepo(dir, { ...this.repoOpts, codec }).open();
        repo.events.on('event', (e) => this.events.emit('event', { world: slug, ...e }));
        this.repos.set(slug, repo);
        return repo;
      })().finally(() => this.opening.delete(slug));
      this.opening.set(slug, p);
    }
    return p;
  }
  async summaries() {
    const out = [];
    for (const s of await this.slugs()) {
      const cm = await readCryptoMeta(path.join(this.worldsDir(), s));
      if (cm && !this.keys.has(s)) {
        out.push({ slug: s, name: cm.label, description: '', accent: '#7c5cff', cover: undefined, pageCount: 0, completeness: 0, createdAt: '', lastEdited: '', encrypted: true, locked: true });
        continue;
      }
      const r = await this.get(s);
      const h = r.health();
      out.push({
        slug: s, name: r.world.name, description: r.world.description, accent: r.world.accent, cover: r.world.cover,
        pageCount: r.pages.size, completeness: h.completeness, createdAt: r.world.createdAt,
        lastEdited: [...r.pages.values()].reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), r.world.createdAt),
        encrypted: !!cm, locked: false,
      });
    }
    return out;
  }
  async create(input: { pack?: string; name: string; slug?: string; description?: string; accent?: string; continuities?: World['continuities']; sources?: World['sources'] }) {
    const base = input.slug ?? slugify(input.name);
    const existing = new Set(await this.slugs());
    if (input.slug && existing.has(base)) throw conflict(`world "${base}" already exists`);
    let slug = base;
    for (let i = 2; existing.has(slug); i++) slug = `${base}-${i}`;
    const continuities = input.continuities?.length ? input.continuities : [{ id: 'canon', name: 'Canon', color: '#7c5cff', order: 0, isPrimary: true }];
    let world: World;
    try {
      world = WorldSchema.parse({
        name: input.name, slug, description: input.description ?? '', accent: input.accent ?? '#7c5cff', createdAt: new Date().toISOString(),
        continuities, sources: input.sources ?? [],
      });
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const dir = path.join(this.worldsDir(), slug);
    await new JsonFile(path.join(dir, 'world.json'), { schema: WorldSchema, version: 1 }).save(world);
    const repo = await this.get(slug);
    if (input.pack) {
      const pack = BUILTIN_PACKS[input.pack];
      if (!pack) throw badRequest(`unknown type pack "${input.pack}"`);
      await repo.setTypes(pack.types);
    }
    return repo;
  }
  /** Create a new world from a Worldloom JSON backup. */
  async importBackup(backup: unknown, name?: string) {
    const b = backup as { format?: string; version?: number; world?: unknown; types?: unknown; pages?: unknown; relations?: unknown; timeline?: unknown };
    if (!b || (b.format !== 'worldloom-backup' && b.format !== 'worldloom-bundle') || b.version !== 1) throw badRequest('not a Worldloom backup (format/version mismatch)');
    const parsed = WorldSchema.safeParse({ ...(b.world as object), slug: 'imported', createdAt: new Date().toISOString() });
    if (!parsed.success) throw badRequest(`backup world config is invalid: ${parsed.error.issues[0]?.message}`);
    const w = parsed.data;
    const repo = await this.create({ name: name ?? `${w.name} (imported)`, description: w.description, accent: w.accent, continuities: w.continuities, sources: w.sources });
    try {
      await repo.updateWorld((x) => { x.arcs = w.arcs; x.tierSystems = w.tierSystems; x.theme = w.theme; x.progress = w.progress; if (w.syncId) x.syncId = w.syncId; });
      await repo.setTypes(EntityTypesFileSchema.parse({ types: b.types }).types);
      await repo.restorePages(z.array(z.any()).parse(b.pages ?? []));
      await repo.relationsFile.save(RelationsFileSchema.parse({ relations: b.relations ?? [] }));
      await repo.setTimeline(TimelineFileSchema.parse({ events: b.timeline ?? [] }).events);
      const origin = (backup as { origin?: { worldId?: string } }).origin;
      if (b.format === 'worldloom-bundle' && origin?.worldId) await markSynced(repo, `bundle:${origin.worldId}`); // shared starting point for later merges
    } catch (e) {
      await this.remove(repo.slug);
      throw badRequest(`backup could not be imported: ${(e as Error).message.slice(0, 300)}`);
    }
    return repo;
  }
  starters() {
    return listStarters(this.starterDir);
  }
  async installStarter(id: string) {
    const slug = await installStarter(this.starterDir, id, this.worldsDir(), new Set(await this.slugs()));
    return this.get(slug);
  }
  async remove(slug: string) {
    const dir = path.join(this.worldsDir(), slug);
    const meta = await readCryptoMeta(dir).catch(() => null);
    if (meta && !this.keys.has(slug)) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw notFound('world');
      await fs.rm(dir, { recursive: true, force: true }); // locked: nothing readable to back up (files are already encrypted)
      return;
    }
    const repo = await this.get(slug);
    await repo.backup('pre-world-delete');
    await repo.close();
    this.repos.delete(slug);
    this.keys.delete(slug);
    await fs.rm(repo.dir, { recursive: true, force: true });
  }

  // ---------- encryption ----------
  private dirOf(slug: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw notFound('world');
    return path.join(this.worldsDir(), slug);
  }
  async encryptionStatus(slug: string) {
    const m = await readCryptoMeta(this.dirOf(slug));
    return { encrypted: !!m, locked: !!m && !this.keys.has(slug), state: m?.state, label: m?.label };
  }
  private throttle(slug: string) {
    const f = this.failed.get(slug);
    if (f && Date.now() < f.until) throw new ApiError(429, 'too_many_attempts', `Wait ${Math.ceil((f.until - Date.now()) / 1000)}s before trying again.`);
  }
  private async verify(slug: string, pass: string): Promise<{ meta: CryptoMeta; key: Buffer }> {
    const meta = await readCryptoMeta(this.dirOf(slug));
    if (!meta) throw badRequest('this world is not encrypted');
    this.throttle(slug);
    const key = await unwrapKey(meta, pass);
    if (!key) {
      const n = (this.failed.get(slug)?.n ?? 0) + 1;
      this.failed.set(slug, { n, until: Date.now() + Math.min(5000, 400 * 2 ** (n - 1)) });
      throw new ApiError(401, 'bad_passphrase', 'Wrong passphrase.');
    }
    this.failed.delete(slug);
    return { meta, key };
  }
  /** Close the open repo (flushing nothing: every write is already on disk) and forget the key. */
  private async dropRepo(slug: string) {
    const open = this.repos.get(slug) ?? (await this.opening.get(slug)?.catch(() => undefined));
    await open?.close();
    this.repos.delete(slug);
  }
  async unlock(slug: string, pass: string) {
    const { meta, key } = await this.verify(slug, pass);
    this.keys.set(slug, key);
    const dir = this.dirOf(slug);
    if (meta.state === 'encrypting') await convertTree(dir, codecFor(key), codecFor(key)); // finish an interrupted migration
    else if (meta.state === 'decrypting') {
      await convertTree(dir, null, codecFor(key));
      await fs.rm(path.join(dir, CRYPTO_FILE), { force: true });
      this.keys.delete(slug);
      return this.get(slug);
    }
    if (meta.state !== 'ready') await writeCryptoMeta(dir, { ...meta, state: 'ready' });
    return this.get(slug);
  }
  async lock(slug: string) {
    if (!(await readCryptoMeta(this.dirOf(slug)))) throw badRequest('this world is not encrypted');
    await this.dropRepo(slug);
    this.keys.delete(slug);
    this.events.emit('event', { world: slug, type: 'locked' });
  }
  async enableEncryption(slug: string, pass: string, o: { label?: string; purgeBackups?: boolean } = {}) {
    if (pass.length < 8) throw badRequest('Use a passphrase of at least 8 characters.');
    const dir = this.dirOf(slug);
    if (await readCryptoMeta(dir)) throw conflict('this world is already encrypted');
    await this.get(slug); // must exist and be readable
    await this.dropRepo(slug);
    const dataKey = crypto.randomBytes(32);
    const kdf = newKdf();
    const meta: CryptoMeta = { format: 'worldloom-crypto', version: 1, label: o.label?.trim() || 'Encrypted world', state: 'encrypting', kdf, wrapped: await wrapKey(dataKey, pass, kdf) };
    await writeCryptoMeta(dir, meta); // first: a crash mid-way leaves a recoverable "encrypting" marker
    await convertTree(dir, codecFor(dataKey), null);
    await writeCryptoMeta(dir, { ...meta, state: 'ready' });
    this.keys.set(slug, dataKey);
    let purged = 0;
    if (o.purgeBackups !== false) {
      for (const d of [path.join(this.dataDir, 'backups', slug), path.join(this.dataDir, 'backups', 'files', slug)]) {
        purged += await fs.readdir(d).then((x) => x.length).catch(() => 0);
        await fs.rm(d, { recursive: true, force: true });
      }
      // automatic launch backups may hold an unencrypted copy of every world as it was before encryption
      const lb = path.join(this.dataDir, 'backups', 'launch');
      purged += await fs.readdir(lb).then((x) => x.length).catch(() => 0);
      await fs.rm(lb, { recursive: true, force: true });
    }
    await this.get(slug);
    return { encrypted: true, purgedBackups: purged };
  }
  async disableEncryption(slug: string, pass: string) {
    const { meta, key } = await this.verify(slug, pass);
    const dir = this.dirOf(slug);
    await this.dropRepo(slug);
    await writeCryptoMeta(dir, { ...meta, state: 'decrypting' });
    await convertTree(dir, null, codecFor(key));
    await fs.rm(path.join(dir, CRYPTO_FILE), { force: true });
    this.keys.delete(slug);
    await this.get(slug);
    return { encrypted: false };
  }
  async changePassphrase(slug: string, oldPass: string, newPass: string) {
    if (newPass.length < 8) throw badRequest('Use a passphrase of at least 8 characters.');
    const { meta, key } = await this.verify(slug, oldPass);
    const kdf = newKdf();
    await writeCryptoMeta(this.dirOf(slug), { ...meta, kdf, wrapped: await wrapKey(key, newPass, kdf) });
    return { ok: true };
  }
  private startAutoLock() {
    const every = this.opts.autoLockMs ? Math.max(50, Math.floor(this.opts.autoLockMs / 4)) : 30_000;
    this.timer = setInterval(() => {
      const limit = this.opts.autoLockMs ?? this.settings.autoLockMinutes * 60_000;
      if (!limit) return;
      for (const slug of [...this.keys.keys()]) if (Date.now() - (this.lastUse.get(slug) ?? 0) > limit) void this.lock(slug).catch(() => undefined);
    }, every);
    this.timer.unref?.();
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.keys.clear();
    for (const r of this.repos.values()) await r.close();
    this.repos.clear();
  }
}
