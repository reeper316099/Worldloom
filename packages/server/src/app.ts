import crypto from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import {
  API_PREFIX, ArcSchema, BoardSchema, RelationSchema, RevealSchema, TimelineEventSchema, ContinuitySchema, EntityTypeSchema, TypePackSchema, PageCreateSchema, PagePatchSchema, ProgressSchema, SourceSchema,
  type Progress,
} from '@worldloom/shared';
import { WorldManager, SettingsSchema, defaultDataDir } from './manager';
import { ApiError, badRequest } from './errors';
import { BUILTIN_PACKS } from './packs';
import { exportCsv, exportHtmlPage, exportHtmlWorld, exportJson, exportMarkdownZip, exportSiteZip, exportViewer, parseCsvImport, parseMarkdownFiles } from './transfer';
import { buildGraph, buildLadder, buildTimeline, buildTree, compareMany, listTierSystems } from './visual';
import { readAsset, storeAsset, MAX_ASSET_BYTES } from './assets';
import type { WorldRepo } from './repo';

export interface AppOptions {
  token: string;
  manager: WorldManager;
  log?: (line: Record<string, unknown>) => void;
}

const ModeQ = z.object({
  mode: z.enum(['reader', 'author']).default('reader'),
  player: z.string().optional(),
  cont: z.string().optional(),
});

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

declare module 'fastify' { interface FastifyInstance { routeTable: Array<{ method: string; url: string }> } }

export async function buildApp({ token, manager, log }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024, genReqId: () => crypto.randomBytes(6).toString('hex') });
  const want = Buffer.from(token);
  const routeTable: Array<{ method: string; url: string }> = [];
  app.addHook('onRoute', (o) => { for (const m of [o.method].flat()) if (m !== 'HEAD' && m !== 'OPTIONS') routeTable.push({ method: m, url: o.url }); });
  app.decorate('routeTable', routeTable);

  app.addContentTypeParser(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_ASSET_BYTES + 1024 }, (_r, body, done) => done(null, body));

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    const url = req.url.split('?')[0]!;
    if (url === '/healthz') return;
    let got = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    // EventSource and <img> cannot set headers; allow a query token only on those two GET routes.
    if (!got && req.method === 'GET' && /\/(events|assets\/[^/]+)$/.test(url)) got = (req.query as { access_token?: string }).access_token;
    const have = Buffer.from(got ?? '');
    if (have.length !== want.length || !crypto.timingSafeEqual(have, want)) throw new ApiError(401, 'unauthorized', 'missing or invalid token');
  });
  app.addHook('onResponse', async (req, reply) => {
    log?.({ id: req.id, method: req.method, route: req.routeOptions?.url ?? 'unmatched', status: reply.statusCode, ms: Math.round(reply.elapsedTime) });
  });
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    let status = 500, code = 'internal', message = 'internal error', details: unknown;
    if (err instanceof ApiError) ({ status, code, message, details } = err);
    else if (err instanceof ZodError) ({ status, code, message } = { status: 400, code: 'bad_request', message: 'validation failed' });
    else if (err.statusCode && err.statusCode < 500) ({ status, code, message } = { status: err.statusCode, code: 'bad_request', message: err.message });
    else log?.({ id: req.id, level: 'error', route: req.routeOptions?.url, error: err.name });
    reply.status(status).send({ error: { code, message, requestId: req.id, details } });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'route not found', requestId: req.id } }));

  app.get('/healthz', async () => ({ ok: true }));

  const r = `${API_PREFIX}`;
  const W = `${r}/worlds/:w`;
  const repo = (req: FastifyRequest) => manager.get((req.params as { w: string }).w);
  const viewerOf = (rp: WorldRepo, q: z.infer<typeof ModeQ>) => rp.viewer({ ...q, hideTitles: manager.settings.hideTitles });
  const authorOnly = (q: z.infer<typeof ModeQ>) => {
    if (q.mode !== 'author') throw new ApiError(403, 'forbidden', 'this endpoint requires mode=author');
  };
  const MutQ = z.object({ mode: z.string().optional() });
  void MutQ;

  // ----- settings -----
  app.get(`${r}/settings`, async () => manager.settings);
  app.put(`${r}/settings`, async (req) => {
    const s = parse(SettingsSchema.partial(), req.body);
    await manager.settingsFile.save(SettingsSchema.parse({ ...manager.settings, ...s }));
    return manager.settings;
  });
  app.get(`${r}/info`, async () => ({ dataDir: manager.dataDir, defaultDataDir: defaultDataDir() }));

  // ----- worlds -----
  app.get(`${r}/worlds`, async () => manager.summaries());
  app.post(`${r}/worlds`, async (req, reply) => {
    const b = parse(z.object({ pack: z.string().optional(), name: z.string().min(1), slug: z.string().optional(), description: z.string().optional(), accent: z.string().optional(), continuities: z.array(ContinuitySchema).optional(), sources: z.array(SourceSchema).optional() }), req.body);
    const created = await manager.create(b);
    reply.status(201);
    return created.world;
  });
  app.get(W, async (req) => {
    const rp = await repo(req);
    return rp.worldView(viewerOf(rp, parse(ModeQ, req.query)));
  });
  app.patch(W, async (req) => {
    const b = parse(z.object({ name: z.string().min(1), description: z.string(), accent: z.string(), cover: z.string(), theme: z.object({ readingFont: z.enum(['serif', 'sans']) }) }).partial(), req.body);
    return (await repo(req)).updateWorld((w) => Object.assign(w, b));
  });
  app.delete(W, async (req, reply) => {
    parse(z.object({ confirm: z.literal('yes') }), req.query);
    await manager.remove((req.params as { w: string }).w);
    reply.status(204);
  });

  // ----- starter worlds & type packs -----
  app.get(`${r}/starter-worlds`, async () => manager.starters());
  app.post(`${r}/starter-worlds/:id/install`, async (req, reply) => {
    const created = await manager.installStarter((req.params as { id: string }).id);
    reply.status(201);
    return created.world;
  });
  app.get(`${r}/type-packs`, async () => Object.entries(BUILTIN_PACKS).map(([id, p]) => ({ id, name: p.name, description: p.description, types: p.types.length })));
  app.get(`${r}/type-packs/:id`, async (req) => BUILTIN_PACKS[(req.params as { id: string }).id] ?? Promise.reject(new ApiError(404, 'not_found', 'type pack not found')));
  app.get(`${W}/type-pack/export`, async (req) => {
    const rp = await repo(req);
    return TypePackSchema.parse({ name: `${rp.world.name} types`, description: 'Exported from Worldloom', types: rp.types });
  });
  app.post(`${W}/type-pack/import`, async (req) => {
    const rp = await repo(req);
    const b = parse(z.object({ pack: TypePackSchema, mode: z.enum(['add', 'overwrite', 'replace']).default('add') }), req.body);
    const have = new Map(rp.types.map((t) => [t.slug, t]));
    const added: string[] = [], updated: string[] = [], skipped: string[] = [];
    let next = b.mode === 'replace' ? [] : [...rp.types];
    for (const t of b.pack.types) {
      if (b.mode === 'replace') { next.push(t); added.push(t.slug); }
      else if (!have.has(t.slug)) { next.push(t); added.push(t.slug); }
      else if (b.mode === 'overwrite') { next = next.map((x) => (x.slug === t.slug ? t : x)); updated.push(t.slug); }
      else skipped.push(t.slug);
    }
    const used = new Set([...rp.pages.values()].map((p) => p.type));
    for (const u of used) if (!next.some((t) => t.slug === u)) throw badRequest(`entity type "${u}" is still used by pages`);
    await rp.setTypes(next);
    return { added, updated, skipped };
  });

  // ----- entity types, continuities, sources, arcs -----
  app.get(`${W}/entity-types`, async (req) => (await repo(req)).types);
  app.put(`${W}/entity-types`, async (req) => {
    const types = parse(z.array(EntityTypeSchema), req.body);
    const rp = await repo(req);
    const used = new Set([...rp.pages.values()].map((p) => p.type));
    for (const u of used) if (!types.some((t) => t.slug === u)) throw badRequest(`entity type "${u}" is still used by pages`);
    await rp.setTypes(types);
    return rp.types;
  });
  for (const [name, schema, key] of [['continuities', ContinuitySchema, 'continuities'], ['sources', SourceSchema, 'sources'], ['arcs', ArcSchema, 'arcs']] as const) {
    app.get(`${W}/${name}`, async (req) => {
      const rp = await repo(req);
      return rp.worldView(viewerOf(rp, parse(ModeQ, req.query)))[key];
    });
    app.put(`${W}/${name}`, async (req) => {
      const items = parse(z.array(schema), req.body);
      const ids = items.map((i) => i.id);
      if (new Set(ids).size !== ids.length) throw badRequest('duplicate ids');
      const w = await (await repo(req)).setCanon(key, items as never);
      return w[key];
    });
  }

  // ----- progress / spoilers -----
  app.get(`${W}/progress`, async (req) => (await repo(req)).world.progress);
  app.put(`${W}/progress`, async (req) => {
    const b = parse(ProgressSchema.partial().omit({ revealed: true }), req.body);
    const w = await (await repo(req)).updateWorld((w) => {
      const p: Progress = { ...w.progress, ...b, sources: { ...w.progress.sources, ...(b.sources ?? {}) } };
      if (b.arcCheckpoint === undefined && 'arcCheckpoint' in (req.body as object)) delete p.arcCheckpoint;
      w.progress = p;
    });
    return w.progress;
  });
  app.post(`${W}/progress/reveal`, async (req) => {
    const { key, undo, clear } = parse(z.object({ key: z.string().min(1).optional(), undo: z.boolean().optional(), clear: z.boolean().optional() }), req.body);
    if (!key && !clear) throw badRequest('key or clear required');
    const w = await (await repo(req)).updateWorld((w) => {
      const s = new Set(w.progress.revealed);
      if (clear) s.clear();
      else if (undo) s.delete(key!);
      else s.add(key!);
      w.progress.revealed = [...s];
    });
    return w.progress;
  });

  // ----- pages -----
  app.get(`${W}/pages`, async (req) => {
    const rp = await repo(req);
    const q = parse(
      ModeQ.extend({ type: z.string().optional(), tag: z.string().optional(), category: z.string().optional(), status: z.string().optional(), sort: z.string().optional(), order: z.string().optional(), offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(1000).optional() }),
      req.query,
    );
    return rp.list(viewerOf(rp, q), q);
  });
  app.post(`${W}/pages`, async (req, reply) => {
    const rp = await repo(req);
    const { template } = parse(z.object({ template: z.enum(['0', '1']).optional() }), req.query);
    const p = await rp.create(parse(PageCreateSchema, req.body), { template: template === '1' });
    reply.status(201);
    return p;
  });
  app.post(`${W}/pages/bulk`, async (req) => {
    const rp = await repo(req);
    const b = parse(z.object({ op: z.literal('delete'), ids: z.array(z.string()).min(1).max(1000) }), req.body);
    return { txId: await rp.bulkDelete(b.ids) };
  });
  app.get(`${W}/pages/:ref`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ, req.query);
    return rp.view((req.params as { ref: string }).ref, viewerOf(rp, q), q.cont);
  });
  app.get(`${W}/pages/:ref/compare`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ a: z.string(), b: z.string() }), req.query);
    return rp.compare((req.params as { ref: string }).ref, viewerOf(rp, q), q.a, q.b);
  });
  app.get(`${W}/pages/:ref/raw`, async (req) => {
    const rp = await repo(req);
    authorOnly(parse(ModeQ, req.query));
    return rp.raw((req.params as { ref: string }).ref);
  });
  app.patch(`${W}/pages/:ref`, async (req) => {
    const rp = await repo(req);
    return rp.patch(rp.raw((req.params as { ref: string }).ref).id, parse(PagePatchSchema.extend({ reveal: RevealSchema.nullable().optional() }), req.body));
  });
  app.delete(`${W}/pages/:ref`, async (req) => {
    const rp = await repo(req);
    const tx = rp.beginTx('delete page');
    await rp.remove(rp.raw((req.params as { ref: string }).ref).id, tx);
    return { txId: await rp.commitTx(tx) };
  });
  app.post(`${W}/pages/:ref/rename`, async (req) => {
    const rp = await repo(req);
    const b = parse(z.object({ title: z.string().min(1), links: z.enum(['rewrite', 'redirect', 'none']).optional() }), req.body);
    return rp.rename(rp.raw((req.params as { ref: string }).ref).id, b.title, { links: b.links });
  });
  app.post(`${W}/tx/:id/undo`, async (req) => ({ restoredFiles: await (await repo(req)).undoTx((req.params as { id: string }).id) }));

  app.post(`${W}/render`, async (req) => {
    authorOnly(parse(ModeQ, req.query));
    const b = parse(z.object({ body: z.string().max(2_000_000), pageId: z.string().optional(), continuity: z.string().optional() }), req.body);
    return (await repo(req)).preview(b.body, b.pageId, b.continuity);
  });

  // ----- search / links / categories -----
  app.get(`${W}/search`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ q: z.string().max(200), limit: z.coerce.number().int().min(1).max(100).optional() }), req.query);
    return rp.searchPages(q.q, viewerOf(rp, q), q.limit);
  });
  app.get(`${W}/suggest`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ q: z.string().max(100) }), req.query);
    return rp.suggest(q.q, viewerOf(rp, q));
  });
  app.get(`${W}/backlinks/:ref`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ, req.query);
    return rp.backlinks((req.params as { ref: string }).ref, viewerOf(rp, q));
  });
  app.get(`${W}/relations`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ, req.query);
    return rp.relations(viewerOf(rp, q), q.cont);
  });
  app.get(`${W}/relations/explicit`, async (req) => {
    authorOnly(parse(ModeQ, req.query));
    return (await repo(req)).relationsFile.get()?.relations ?? [];
  });
  app.put(`${W}/relations/explicit`, async (req) => (await repo(req)).setRelations(parse(z.array(RelationSchema), req.body)));
  app.get(`${W}/card/:ref`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ, req.query);
    return rp.card((req.params as { ref: string }).ref, viewerOf(rp, q), q.cont);
  });
  // ----- visual tools -----
  const csv = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
  app.get(`${W}/graph`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ types: z.string().optional(), kinds: z.string().optional(), focus: z.string().optional(), hops: z.coerce.number().int().min(1).max(6).optional(), arc: z.string().optional() }), req.query);
    return buildGraph(rp, viewerOf(rp, q), { cont: q.cont, types: csv(q.types), kinds: csv(q.kinds), focus: q.focus, hops: q.hops, arc: q.arc });
  });
  app.get(`${W}/tree`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ type: z.string().optional(), field: z.string().optional(), kind: z.string().optional(), parent: z.enum(['from', 'to']).optional(), root: z.string().optional() }), req.query);
    if (!q.field && !q.kind) throw badRequest('field or kind is required');
    return buildTree(rp, viewerOf(rp, q), q);
  });
  app.get(`${W}/timeline`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ arc: z.string().optional(), page: z.string().optional() }), req.query);
    return buildTimeline(rp, viewerOf(rp, q), q);
  });
  app.get(`${W}/timeline/events`, async (req) => {
    authorOnly(parse(ModeQ, req.query));
    return (await repo(req)).timelineFile.get()?.events ?? [];
  });
  app.put(`${W}/timeline/events`, async (req) => (await repo(req)).setTimeline(parse(z.array(TimelineEventSchema), req.body)));
  app.get(`${W}/tiers`, async (req) => {
    const rp = await repo(req);
    return listTierSystems(rp, viewerOf(rp, parse(ModeQ, req.query)));
  });
  app.get(`${W}/tiers/:sid/ladder`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ arc: z.string().optional() }), req.query);
    return buildLadder(rp, viewerOf(rp, q), (req.params as { sid: string }).sid, { cont: q.cont, arc: q.arc });
  });
  app.get(`${W}/compare`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ ids: z.string().min(1) }), req.query);
    return compareMany(rp, viewerOf(rp, q), csv(q.ids) ?? [], q.cont);
  });
  app.get(`${W}/boards`, async (req) => {
    const rp = await repo(req);
    return rp.listBoards(viewerOf(rp, parse(ModeQ, req.query)));
  });
  app.get(`${W}/boards/:bid`, async (req) => {
    const rp = await repo(req);
    return rp.boardView(await rp.readBoard((req.params as { bid: string }).bid), viewerOf(rp, parse(ModeQ, req.query)));
  });
  app.put(`${W}/boards/:bid`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ, req.query);
    const b = parse(BoardSchema.omit({ createdAt: true, updatedAt: true }), { ...(req.body as object), id: (req.params as { bid: string }).bid });
    const saved = await rp.saveBoard(b, viewerOf(rp, q));
    return rp.boardView(saved, viewerOf(rp, q));
  });
  app.delete(`${W}/boards/:bid`, async (req, reply) => {
    await (await repo(req)).deleteBoard((req.params as { bid: string }).bid);
    reply.status(204);
  });
  // ----- export / import -----
  app.get(`${W}/export/:format`, async (req, reply) => {
    const rp = await repo(req);
    const { format } = req.params as { format: string };
    const q = parse(z.object({ spoilers: z.enum(['0', '1']).default('0'), player: z.enum(['0', '1']).default('0'), type: z.string().optional(), page: z.string().optional() }), req.query);
    const v = exportViewer(rp, { spoilers: q.spoilers === '1', player: q.player === '1' });
    const send = (type: string, name: string, body: string | Uint8Array) => reply.header('Content-Type', type).header('Content-Disposition', `attachment; filename="${name}"`).send(typeof body === 'string' ? body : Buffer.from(body));
    switch (format) {
      case 'json': return send('application/json', `${rp.slug}-backup.json`, JSON.stringify(exportJson(rp, v), null, 2));
      case 'markdown': return send('application/zip', `${rp.slug}-vault.zip`, exportMarkdownZip(rp, v));
      case 'csv': if (!q.type) throw badRequest('type is required'); return send('text/csv; charset=utf-8', `${rp.slug}-${q.type}.csv`, exportCsv(rp, v, q.type));
      case 'html': return send('text/html; charset=utf-8', `${rp.slug}${q.page ? '-' + q.page : ''}.html`, q.page ? exportHtmlPage(rp, v, q.page) : exportHtmlWorld(rp, v));
      case 'site': return send('application/zip', `${rp.slug}-site.zip`, exportSiteZip(rp, v));
      default: throw badRequest('unknown export format');
    }
  });
  const ImportBody = z.object({
    format: z.enum(['markdown', 'csv']), files: z.array(z.object({ path: z.string().max(500), text: z.string().max(5_000_000) })).min(1).max(5000),
    type: z.string().optional(), mode: z.enum(['skip', 'overwrite', 'rename']).default('skip'),
  });
  const planImport = (rp: WorldRepo, b: z.infer<typeof ImportBody>) => {
    const items = b.format === 'csv' ? parseCsvImport(b.files[0]!.text, rp.types, b.type ?? '') : parseMarkdownFiles(b.files, rp.types, b.type);
    return rp.planImport(items, b.mode);
  };
  app.post(`${W}/import/preview`, { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const rp = await repo(req);
    const items = planImport(rp, parse(ImportBody, req.body));
    const count = (a: string) => items.filter((i) => i.action === a).length;
    return { counts: { create: count('create'), overwrite: count('overwrite'), rename: count('rename'), skip: count('skip') }, items: items.slice(0, 500).map((i) => ({ title: i.title, type: i.type, action: i.action, source: i.source, warnings: i.warnings })) };
  });
  app.post(`${W}/import/commit`, { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const rp = await repo(req);
    const b = parse(ImportBody, req.body);
    const items = b.format === 'csv' ? parseCsvImport(b.files[0]!.text, rp.types, b.type ?? '') : parseMarkdownFiles(b.files, rp.types, b.type);
    return rp.commitImport(items, b.mode);
  });
  app.post(`${r}/import/backup`, { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
    const b = parse(z.object({ backup: z.unknown(), name: z.string().optional() }), req.body);
    const created = await manager.importBackup(b.backup, b.name);
    reply.status(201);
    return created.world;
  });
  app.get(`${W}/categories`, async (req) => {
    const rp = await repo(req);
    return rp.categories(viewerOf(rp, parse(ModeQ, req.query)));
  });
  app.get(`${W}/health-report`, async (req) => {
    authorOnly(parse(ModeQ, req.query));
    return (await repo(req)).health();
  });

  // ----- history -----
  app.get(`${W}/history/:ref`, async (req) => {
    const rp = await repo(req);
    authorOnly(parse(ModeQ, req.query));
    return rp.history(rp.raw((req.params as { ref: string }).ref).id);
  });
  app.get(`${W}/history/:ref/diff`, async (req) => {
    const rp = await repo(req);
    const q = parse(ModeQ.extend({ from: z.string(), to: z.string().default('current') }), req.query);
    authorOnly(q);
    return rp.diff(rp.raw((req.params as { ref: string }).ref).id, q.from, q.to);
  });
  app.post(`${W}/history/:ref/restore`, async (req) => {
    const rp = await repo(req);
    return rp.restore(rp.raw((req.params as { ref: string }).ref).id, parse(z.object({ ts: z.string() }), req.body).ts);
  });
  app.post(`${W}/history/:ref/snapshot`, async (req) => {
    const rp = await repo(req);
    await rp.snapshot(rp.raw((req.params as { ref: string }).ref).id, parse(z.object({ name: z.string().min(1) }), req.body).name);
    return { ok: true };
  });

  // ----- assets -----
  app.post(`${W}/assets`, { bodyLimit: MAX_ASSET_BYTES + 1024 }, async (req, reply) => {
    const rp = await repo(req);
    if (!Buffer.isBuffer(req.body)) throw badRequest('send the file as the raw request body with an image content-type');
    const a = await storeAsset(path.join(rp.dir, 'assets'), req.body, req.headers['content-type']);
    reply.status(201);
    return a;
  });
  app.get(`${W}/assets/:name`, async (req, reply) => {
    const rp = await repo(req);
    const a = await readAsset(path.join(rp.dir, 'assets'), (req.params as { name: string }).name);
    reply.header('Content-Type', a.type).header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox").header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(a.data);
  });

  // ----- events (SSE) -----
  app.get(`${r}/events`, (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    reply.raw.write(': ok\n\n');
    const on = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    manager.events.on('event', on);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      manager.events.off('event', on);
    });
  });

  return app;
}
