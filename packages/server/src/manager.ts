import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { DATA_DIR_ENV, EntityTypesFileSchema, RelationsFileSchema, TimelineFileSchema, WorldSchema, slugify, type World } from '@worldloom/shared';
import { JsonFile, zipBackup } from '@worldloom/jsonstore';
import { WorldRepo, type RepoOptions } from './repo';
import { badRequest, conflict, notFound } from './errors';
import { BUILTIN_PACKS } from './packs';
import { defaultStarterDir, installStarter, listStarters } from './starters';

export const SettingsSchema = z.object({
  schemaVersion: z.number().default(1),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  hideTitles: z.boolean().default(false),
  blurStrength: z.number().min(0).max(40).default(8),
  hideImages: z.boolean().default(true),
  vimMode: z.boolean().default(false),
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
  /** One repo per world, even when many requests arrive at once (the in-flight open is shared). */
  async get(slug: string): Promise<WorldRepo> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw notFound('world');
    const hit = this.repos.get(slug);
    if (hit) return hit;
    let p = this.opening.get(slug);
    if (!p) {
      p = (async () => {
        const dir = path.join(this.worldsDir(), slug);
        try {
          await fs.access(path.join(dir, 'world.json'));
        } catch {
          throw notFound('world');
        }
        const repo = await new WorldRepo(dir, this.repoOpts).open();
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
      const r = await this.get(s);
      const h = r.health();
      out.push({
        slug: s, name: r.world.name, description: r.world.description, accent: r.world.accent, cover: r.world.cover,
        pageCount: r.pages.size, completeness: h.completeness, createdAt: r.world.createdAt,
        lastEdited: [...r.pages.values()].reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), r.world.createdAt),
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
    if (!b || b.format !== 'worldloom-backup' || b.version !== 1) throw badRequest('not a Worldloom backup (format/version mismatch)');
    const parsed = WorldSchema.safeParse({ ...(b.world as object), slug: 'imported', createdAt: new Date().toISOString() });
    if (!parsed.success) throw badRequest(`backup world config is invalid: ${parsed.error.issues[0]?.message}`);
    const w = parsed.data;
    const repo = await this.create({ name: name ?? `${w.name} (imported)`, description: w.description, accent: w.accent, continuities: w.continuities, sources: w.sources });
    try {
      await repo.updateWorld((x) => { x.arcs = w.arcs; x.tierSystems = w.tierSystems; x.theme = w.theme; x.progress = w.progress; });
      await repo.setTypes(EntityTypesFileSchema.parse({ types: b.types }).types);
      await repo.restorePages(z.array(z.any()).parse(b.pages ?? []));
      await repo.relationsFile.save(RelationsFileSchema.parse({ relations: b.relations ?? [] }));
      await repo.setTimeline(TimelineFileSchema.parse({ events: b.timeline ?? [] }).events);
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
    const repo = await this.get(slug);
    await repo.backup('pre-world-delete');
    await repo.close();
    this.repos.delete(slug);
    await fs.rm(repo.dir, { recursive: true, force: true });
  }
  async close() {
    for (const r of this.repos.values()) await r.close();
    this.repos.clear();
  }
}
