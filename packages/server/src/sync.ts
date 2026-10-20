import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite, stableStringify } from '@worldloom/jsonstore';
import { PageMetaSchema, titleKey, type Page } from '@worldloom/shared';
import type { WorldRepo } from './repo';
import { exportJson, exportViewer } from './transfer';
import { ApiError, badRequest, conflict } from './errors';
import { openSealed, sealWithPassphrase } from './crypto-world';

export type Resolution = 'newer' | 'local' | 'remote' | 'both';
export interface Bundle {
  format: 'worldloom-bundle';
  version: 1;
  origin: { worldId: string; deviceId: string; worldName: string; exportedAt: string };
  includesSpoilers: boolean;
  world: Record<string, unknown> & { sources?: unknown[]; continuities?: unknown[]; arcs?: unknown[]; tierSystems?: unknown[] };
  types: Array<{ slug: string }>;
  pages: Page[];
  relations: Array<{ id: string; fromId: string; toId: string }>;
  timeline: Array<{ id: string; pageIds: string[] }>;
}
export interface PlanItem { id: string; title: string; type: string; action: 'add' | 'update' | 'keep-local' | 'conflict' | 'unchanged' | 'skip'; note?: string }
export interface Plan {
  items: PlanItem[];
  counts: Record<string, number>;
  extras: { relations: number; events: number; types: number; configAdded: string[]; configDiffers: string[] };
}

/** Content hash of what a user edits (ignores timestamps and file naming). */
export function pageHash(p: Page): string {
  const { id: _i, slug: _s, createdAt: _c, updatedAt: _u, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
  return crypto.createHash('sha1').update(stableStringify(rest)).digest('hex');
}

export async function ensureSyncId(repo: WorldRepo): Promise<string> {
  if (repo.world.syncId) return repo.world.syncId;
  const id = crypto.randomBytes(10).toString('hex');
  await repo.updateWorld((w) => { w.syncId = id; });
  return id;
}

export async function makeBundle(repo: WorldRepo, deviceId: string, spoilers: boolean): Promise<Bundle> {
  const worldId = await ensureSyncId(repo); // before exporting, so the bundle's world config carries the id
  const base = exportJson(repo, exportViewer(repo, { spoilers, player: false }));
  const { progress: _personal, ...world } = base.world as typeof base.world & { progress?: unknown }; // reading progress is personal: never synced
  void _personal;
  return {
    ...(base as unknown as Bundle), world, format: 'worldloom-bundle', version: 1,
    origin: { worldId, deviceId, worldName: repo.world.name, exportedAt: new Date().toISOString() },
    includesSpoilers: spoilers,
  };
}

/** Serialize a bundle; sealed (AES-GCM, scrypt) when a passphrase is given. */
export async function encodeBundle(b: Bundle, passphrase?: string): Promise<string> {
  const text = JSON.stringify(b);
  return passphrase ? sealWithPassphrase(Buffer.from(text, 'utf8'), passphrase) : text;
}
export async function decodeBundle(input: string | object, passphrase?: string): Promise<Bundle> {
  let obj: unknown;
  try { obj = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw badRequest('That is not a Worldloom bundle (not valid JSON).'); }
  if ((obj as { format?: string })?.format === 'worldloom-sealed') {
    if (!passphrase) throw new ApiError(401, 'bundle_passphrase_required', 'This bundle is passphrase-protected.');
    try { obj = JSON.parse((await openSealed(obj, passphrase)).toString('utf8')); } catch (e) { throw new ApiError(401, 'bad_passphrase', (e as Error).message); }
  }
  const b = obj as Bundle;
  if (b?.format !== 'worldloom-bundle' || b.version !== 1 || !Array.isArray(b.pages) || !b.origin?.worldId) throw badRequest('That is not a Worldloom sync bundle (or it is from a newer version).');
  for (const p of b.pages) {
    const r = PageMetaSchema.safeParse(p);
    if (!r.success) throw badRequest(`bundle contains an invalid page: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  }
  return b;
}

// ---------------- state (per channel base snapshot) ----------------
interface SyncState { peers: Record<string, { lastSyncAt: string; base: Record<string, string> }> }
const stateFile = (repo: WorldRepo) => path.join(repo.dir, 'sync-state.json');
async function readState(repo: WorldRepo): Promise<SyncState> {
  try { return JSON.parse(await fs.readFile(stateFile(repo), 'utf8')) as SyncState; } catch { return { peers: {} }; }
}
async function writeState(repo: WorldRepo, channel: string, pages: Iterable<Page>) {
  const st = await readState(repo);
  st.peers[channel] = { lastSyncAt: new Date().toISOString(), base: Object.fromEntries([...pages].map((p) => [p.id, pageHash(p)])) };
  await atomicWrite(stateFile(repo), stableStringify(st), repo.codec);
}

// ---------------- merge ----------------
export async function planMerge(repo: WorldRepo, b: Bundle, channel: string, resolution: Resolution): Promise<{ plan: Plan; apply: () => Promise<{ txId: string }> }> {
  const base = (await readState(repo)).peers[channel]?.base ?? {};
  const addOnly = !b.includesSpoilers; // a spoiler-filtered bundle must never overwrite fuller local content
  const items: PlanItem[] = [];
  const ops: Array<(tx: ReturnType<WorldRepo['beginTx']>) => Promise<void>> = [];
  const local = new Map(repo.pages.entries());
  const usedTitles = new Set([...local.values()].map((p) => `${p.type}\u0000${titleKey(p.title)}`));
  const typeSlugs = new Set(repo.types.map((t) => t.slug));
  const remoteIds = new Set(b.pages.map((p) => p.id));
  const stamp = new Date().toISOString().slice(0, 10);

  const freeTitle = (type: string, title: string, suffix: string) => {
    let t = `${title} (${suffix})`;
    for (let n = 2; usedTitles.has(`${type}\u0000${titleKey(t)}`); n++) t = `${title} (${suffix} ${n})`;
    usedTitles.add(`${type}\u0000${titleKey(t)}`);
    return t;
  };
  const addPage = (p: Page, title = p.title, extra: Partial<Page> = {}) => ops.push(async (tx) => { await repo.syncWrite({ ...p, ...extra, title }, tx); });

  for (const r of b.pages) {
    const l = local.get(r.id);
    const baseHash = base[r.id];
    if (!typeSlugs.has(r.type)) { items.push({ id: r.id, title: r.title, type: r.type, action: 'skip', note: `unknown page type "${r.type}"` }); continue; }
    if (!l) {
      if (baseHash) { items.push({ id: r.id, title: r.title, type: r.type, action: 'skip', note: 'deleted here since the last sync; not restored' }); continue; }
      const clash = usedTitles.has(`${r.type}\u0000${titleKey(r.title)}`);
      const title = clash ? freeTitle(r.type, r.title, 'from sync') : r.title;
      if (!clash) usedTitles.add(`${r.type}\u0000${titleKey(r.title)}`);
      items.push({ id: r.id, title: r.title, type: r.type, action: 'add', note: clash ? `a different page already has this title; added as "${title}"` : undefined });
      addPage(r, title);
      continue;
    }
    const hL = pageHash(l), hR = pageHash(r);
    if (hL === hR) { items.push({ id: r.id, title: l.title, type: l.type, action: 'unchanged' }); continue; }
    if (addOnly) { items.push({ id: r.id, title: l.title, type: l.type, action: 'keep-local', note: 'bundle has spoilers removed; existing pages are not overwritten' }); continue; }
    if (baseHash === hL) { items.push({ id: r.id, title: l.title, type: l.type, action: 'update', note: 'changed on the other side' }); addPage(r, r.title, { slug: l.slug }); continue; }
    if (baseHash === hR) { items.push({ id: r.id, title: l.title, type: l.type, action: 'keep-local', note: 'changed only here' }); continue; }
    // both changed since the last sync (or no shared history): a real conflict
    const remoteNewer = Date.parse(r.updatedAt) > Date.parse(l.updatedAt);
    const takeRemote = resolution === 'remote' || (resolution === 'newer' && remoteNewer) || false;
    const keepBoth = resolution === 'both' || resolution === 'newer';
    items.push({ id: r.id, title: l.title, type: l.type, action: 'conflict', note: `edited on both sides; ${takeRemote ? 'the other side was kept' : 'your version was kept'}${keepBoth ? ' and the other version saved as a "sync-conflict" page' : ''}` });
    if (takeRemote) {
      addPage(r, r.title, { slug: l.slug });
      if (keepBoth) ops.push(async (tx) => { await repo.syncWrite({ ...l, id: `${l.id}-conflict-${crypto.randomBytes(3).toString('hex')}`, title: freeTitle(l.type, l.title, `conflict ${stamp}`), slug: `${l.slug}-conflict`, status: 'draft', tags: [...l.tags, 'sync-conflict'], redirectsTo: undefined }, tx, true); });
    } else if (keepBoth) {
      ops.push(async (tx) => { await repo.syncWrite({ ...r, id: `${r.id}-conflict-${crypto.randomBytes(3).toString('hex')}`, title: freeTitle(r.type, r.title, `conflict ${stamp}`), slug: `${r.slug}-conflict`, status: 'draft', tags: [...r.tags, 'sync-conflict'], redirectsTo: undefined }, tx, true); });
    }
  }
  for (const l of local.values()) if (!remoteIds.has(l.id) && base[l.id] && !addOnly) items.push({ id: l.id, title: l.title, type: l.type, action: 'keep-local', note: 'deleted on the other side; kept here' });

  // relations / timeline / types / config: union, never overwrite
  const haveRel = new Set((repo.relationsFile.get()?.relations ?? []).map((r) => r.id));
  const mergedIds = (id: string) => local.has(id) || b.pages.some((p) => p.id === id && typeSlugs.has(p.type));
  const newRels = b.relations.filter((r) => !haveRel.has(r.id) && mergedIds(r.fromId) && mergedIds(r.toId));
  const haveEv = new Set((repo.timelineFile.get()?.events ?? []).map((e) => e.id));
  const newEvents = b.timeline.filter((e) => !haveEv.has(e.id) && e.pageIds.every(mergedIds));
  const newTypes = (b.types ?? []).filter((t) => !typeSlugs.has(t.slug));
  const configAdded: string[] = [], configDiffers: string[] = [];
  const cfgOps: Array<() => Promise<void>> = [];
  for (const key of ['continuities', 'sources', 'arcs', 'tierSystems'] as const) {
    const mine = (repo.world[key] as Array<{ id: string }>) ?? [];
    const theirs = ((b.world[key] as Array<{ id: string }> | undefined) ?? []);
    const add = theirs.filter((t) => !mine.some((m) => m.id === t.id));
    for (const t of theirs) { const m = mine.find((x) => x.id === t.id); if (m && JSON.stringify(m) !== JSON.stringify(t)) configDiffers.push(`${key}:${t.id}`); }
    if (add.length) { configAdded.push(...add.map((a) => `${key}:${a.id}`)); cfgOps.push(async () => { await repo.updateWorld((w) => { (w[key] as unknown[]) = [...(w[key] as unknown[]), ...add]; }); }); }
  }

  const counts: Record<string, number> = {};
  for (const i of items) counts[i.action] = (counts[i.action] ?? 0) + 1;
  const plan: Plan = { items, counts, extras: { relations: newRels.length, events: newEvents.length, types: newTypes.length, configAdded, configDiffers } };

  const apply = async () => {
    await repo.backup('pre-sync');
    for (const op of cfgOps) await op(); // config first so referenced ids exist
    if (newTypes.length) await repo.setTypes([...repo.types, ...(newTypes as unknown as typeof repo.types)]);
    const tx = repo.beginTx(`sync from ${b.origin.worldName}`);
    for (const op of ops) await op(tx);
    if (newRels.length) await repo.setRelations([...(repo.relationsFile.get()?.relations ?? []), ...(newRels as never[])]);
    if (newEvents.length) await repo.setTimeline([...(repo.timelineFile.get()?.events ?? []), ...(newEvents as never[])]);
    const txId = await repo.commitTx(tx);
    // base = what the other side had (so an unchanged remote later reads as "changed only here", never as an update that would revert our edits)
    await writeState(repo, channel, b.pages);
    return { txId };
  };
  return { plan, apply };
}

// ---------------- folder sync ----------------
const SYNC_EXT = '.worldloom-sync';
async function assertFolder(p: string) {
  if (!path.isAbsolute(p)) throw badRequest('Choose an absolute folder path.');
  const st = await fs.stat(p).catch(() => null);
  if (!st?.isDirectory()) throw badRequest('That folder does not exist.');
  return path.resolve(p);
}
export async function listSyncFiles(folder: string) {
  const dir = await assertFolder(folder);
  const out = [];
  for (const f of await fs.readdir(dir)) {
    if (!f.endsWith(SYNC_EXT)) continue;
    const st = await fs.stat(path.join(dir, f));
    let name: string | undefined;
    let sealed = false;
    try {
      const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      sealed = j.format === 'worldloom-sealed';
      name = j.origin?.worldName;
    } catch { /* unreadable */ }
    out.push({ file: f, size: st.size, modified: st.mtime.toISOString(), sealed, name });
  }
  return out;
}
export async function readSyncFile(folder: string, file: string, passphrase?: string) {
  const dir = await assertFolder(folder);
  if (!file.endsWith(SYNC_EXT) || file !== path.basename(file)) throw badRequest('invalid sync file name');
  const text = await fs.readFile(path.join(dir, file), 'utf8');
  return decodeBundle(text, passphrase);
}

/** Merge from the shared file (if any) and write the merged state back. Aborts if the file changes meanwhile. */
export async function folderSync(repo: WorldRepo, deviceId: string, o: { folder: string; passphrase?: string; resolution: Resolution; apply: boolean; encrypted: boolean }) {
  if (o.encrypted && !o.passphrase) throw badRequest('This world is encrypted: sync files must be sealed with a passphrase.');
  const dir = await assertFolder(o.folder);
  const syncId = await ensureSyncId(repo);
  const file = path.join(dir, `${syncId}${SYNC_EXT}`);
  const channel = `folder:${dir}`;
  let before: string | null = null;
  try { before = await fs.readFile(file, 'utf8'); } catch { /* first push */ }
  let plan: Plan | undefined;
  let txId: string | undefined;
  if (before) {
    const remote = await decodeBundle(before, o.passphrase);
    if (remote.origin.worldId !== syncId) throw conflict('That sync file belongs to a different world.');
    const m = await planMerge(repo, remote, channel, o.resolution);
    plan = m.plan;
    if (o.apply) txId = (await m.apply()).txId;
  }
  if (!o.apply) return { plan, wrote: false as const };
  const bundle = await makeBundle(repo, deviceId, true);
  const now = await fs.readFile(file, 'utf8').catch(() => null);
  if (now !== before) throw conflict('The sync file changed while syncing (another device wrote it). Run the sync again.');
  await atomicWrite(file, await encodeBundle(bundle, o.passphrase));
  await writeState(repo, channel, repo.pages.values());
  return { plan, txId, wrote: true as const, file: path.basename(file) };
}

/** Create a new world from a shared sync file (first-time setup on a second machine). */
export async function joinFromFolder(manager: import('./manager').WorldManager, o: { folder: string; file: string; passphrase?: string; name?: string }) {
  const bundle = await readSyncFile(o.folder, o.file, o.passphrase);
  const repo = await manager.importBackup(bundle, o.name);
  await writeState(repo, `folder:${path.resolve(o.folder)}`, repo.pages.values());
  return repo;
}
export async function markSynced(repo: WorldRepo, channel: string) {
  await writeState(repo, channel, repo.pages.values());
}
