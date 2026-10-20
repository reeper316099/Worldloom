import { revealSatisfied, type FieldDef, type Page, type TierSystem } from '@worldloom/shared';
import type { WorldRepo } from './repo';
import { pageVisible, revealOk, type Viewer } from './visibility';
import { resolveField } from './infobox';
import { notFound } from './errors';

const brief = (p: Page) => ({ id: p.id, title: p.title, slug: p.slug, type: p.type });
const reached = (repo: WorldRepo, v: Viewer, arcId: string) =>
  v.mode === 'author' || repo.world.progress.showAll || revealSatisfied({ arcId }, { progress: repo.world.progress, arcs: repo.world.arcs, sources: repo.world.sources, primarySourceIds: v.primarySourceIds });

// ---------------- graph ----------------
export interface GraphOpts { cont?: string; types?: string[]; kinds?: string[]; focus?: string; hops?: number; arc?: string }
export function buildGraph(repo: WorldRepo, v: Viewer, o: GraphOpts) {
  const base = repo.relations(v, o.cont);
  const arcOrder = (id?: string) => repo.world.arcs.find((a) => a.id === id)?.order;
  const at = arcOrder(o.arc);
  let edges = base.edges.filter((e) => {
    const ts = e.timeSpan as { fromArcId?: string; toArcId?: string } | undefined;
    if (at === undefined || !ts) return true;
    const from = arcOrder(ts.fromArcId), to = arcOrder(ts.toArcId);
    return (from === undefined || at >= from) && (to === undefined || at <= to);
  });
  if (o.kinds?.length) edges = edges.filter((e) => o.kinds!.includes(e.kind));
  const nodeById = new Map(base.nodes.map((n) => [n.id, n]));
  if (o.types?.length) edges = edges.filter((e) => o.types!.includes(nodeById.get(e.from)!.type) && o.types!.includes(nodeById.get(e.to)!.type));
  if (o.focus) {
    const f = repo.findPage(o.focus);
    if (!f || !pageVisible(v, f)) return { nodes: [], edges: [], kinds: [] as string[] };
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      (adj.get(e.from) ?? adj.set(e.from, new Set()).get(e.from)!).add(e.to);
      (adj.get(e.to) ?? adj.set(e.to, new Set()).get(e.to)!).add(e.from);
    }
    const seen = new Set([f.id]);
    let frontier = [f.id];
    for (let h = 0; h < (o.hops ?? 2); h++) {
      const next: string[] = [];
      for (const id of frontier) for (const n of adj.get(id) ?? []) if (!seen.has(n)) { seen.add(n); next.push(n); }
      frontier = next;
    }
    edges = edges.filter((e) => seen.has(e.from) && seen.has(e.to));
    if (!edges.length) return { nodes: [brief(f)].map((n) => ({ ...n, degree: 0 })), edges: [], kinds: [] as string[] };
  }
  const deg = new Map<string, number>();
  for (const e of edges) for (const id of [e.from, e.to]) deg.set(id, (deg.get(id) ?? 0) + 1);
  const nodes = [...deg.keys()].map((id) => ({ ...nodeById.get(id)!, degree: deg.get(id)! }));
  return { nodes, edges, kinds: [...new Set(edges.map((e) => e.kind))].sort() };
}

// ---------------- tree ----------------
export interface TreeNode { id: string; title: string; slug: string; type: string; children: TreeNode[] }
export interface TreeOpts { cont?: string; type?: string; field?: string; kind?: string; parent?: 'from' | 'to'; root?: string }
/** Forest from a parent-pointer relation field (child -> parent) or from relation edges of one kind. */
export function buildTree(repo: WorldRepo, v: Viewer, o: TreeOpts) {
  const parentsOf = new Map<string, Set<string>>();
  const nodes = new Map<string, Page>();
  const ok = (p?: Page): p is Page => !!p && pageVisible(v, p) && (!o.cont || p.appliesTo === 'all' || p.appliesTo.includes(o.cont));
  const link = (child: Page, parent: Page) => {
    if (child.id === parent.id) return;
    nodes.set(child.id, child);
    nodes.set(parent.id, parent);
    (parentsOf.get(child.id) ?? parentsOf.set(child.id, new Set()).get(child.id)!).add(parent.id);
  };
  if (o.field) {
    for (const p of repo.pages.values()) {
      if (!ok(p) || (o.type && p.type !== o.type)) continue;
      const def = repo.typeOf(p)?.fields.find((d) => d.key === o.field);
      if (!def || p.fields[o.field] === undefined) continue;
      const r = resolveField(p.fields[o.field], o.cont, v, `${p.id}.${o.field}`);
      if (r.hidden || r.value === undefined) continue;
      for (const n of Array.isArray(r.value) ? r.value : [r.value]) {
        const par = repo.resolve(String(n), def.relationTo);
        if (ok(par)) link(p, par);
      }
      if (o.type) nodes.set(p.id, p);
    }
  } else if (o.kind) {
    for (const e of repo.relations(v, o.cont).edges.filter((x) => x.kind === o.kind)) {
      const a = repo.pages.get(e.from), b = repo.pages.get(e.to);
      if (!ok(a) || !ok(b)) continue;
      // default: an edge reads "from <kind> to" (Kael master_student Orrin), so `to` is the parent; parent=from flips it
      if (o.parent === 'from') link(b, a);
      else link(a, b);
    }
  }
  const children = new Map<string, string[]>();
  for (const [c, ps] of parentsOf) for (const p of ps) (children.get(p) ?? children.set(p, []).get(p)!).push(c);
  const build = (id: string, path: Set<string>): TreeNode => {
    const p = nodes.get(id)!;
    const kids = (children.get(id) ?? []).filter((k) => !path.has(k)).map((k) => build(k, new Set([...path, id])));
    kids.sort((a, b) => a.title.localeCompare(b.title));
    return { ...brief(p), children: kids };
  };
  let roots: string[];
  if (o.root) {
    const r = repo.findPage(o.root);
    roots = r && nodes.has(r.id) ? [r.id] : [];
  } else roots = [...nodes.keys()].filter((id) => !(parentsOf.get(id)?.size));
  const forest = roots.map((id) => build(id, new Set())).sort((a, b) => a.title.localeCompare(b.title));
  return { roots: forest, count: nodes.size };
}

/** Parent chain via a single-valued relation field whose kind is "parent" (e.g. region). */
export function breadcrumbs(repo: WorldRepo, p: Page, v: Viewer) {
  const out: Array<ReturnType<typeof brief>> = [];
  let cur: Page | undefined = p;
  const seen = new Set([p.id]);
  for (let i = 0; i < 6 && cur; i++) {
    const def: FieldDef | undefined = repo.typeOf(cur)?.fields.find((d) => d.type === 'relation' && d.relationKind === 'parent' && !d.multiple);
    const raw: unknown = def && cur.fields[def.key];
    if (!def || raw === undefined) break;
    const r = resolveField(raw, undefined, v, `${cur.id}.${def.key}`);
    const par: Page | undefined = r.hidden || r.value === undefined ? undefined : repo.resolve(String(Array.isArray(r.value) ? r.value[0] : r.value), def.relationTo);
    if (!par || seen.has(par.id) || !pageVisible(v, par)) break;
    seen.add(par.id);
    out.unshift(brief(par));
    cur = par;
  }
  return out;
}

// ---------------- timeline ----------------
export interface TimelineQuery { cont?: string; arc?: string; page?: string }
export function buildTimeline(repo: WorldRepo, v: Viewer, q: TimelineQuery) {
  const w = repo.world;
  const focus = q.page ? repo.findPage(q.page) : undefined;
  const events = [];
  for (const e of repo.timelineFile.get()?.events ?? []) {
    if (!revealOk(v, e.reveal, `event:${e.id}`)) continue;
    if (e.arcId && !reached(repo, v, e.arcId)) continue;
    if (q.cont && e.trackId && e.trackId !== q.cont) continue;
    if (q.arc && e.arcId !== q.arc) continue;
    const pages = e.pageIds.map((id) => repo.pages.get(id)).filter((p): p is Page => !!p);
    if (pages.some((p) => !pageVisible(v, p))) continue; // an event is only shown if everything it mentions is visible
    if (focus && !pages.some((p) => p.id === focus.id)) continue;
    events.push({ id: e.id, title: e.title, summary: e.summary, order: e.order, label: e.label, trackId: e.trackId, arcId: e.arcId, pages: pages.map(brief) });
  }
  events.sort((a, b) => a.order - b.order);
  const tracks = w.continuities.filter((c) => !q.cont || c.id === q.cont).map((c) => ({ id: c.id, name: c.name, color: c.color }));
  const arcs = [];
  for (const a of w.arcs) {
    if (!reached(repo, v, a.id)) continue;
    const es = events.filter((e) => e.arcId === a.id);
    if (es.length) arcs.push({ id: a.id, name: a.name, order: a.order, from: Math.min(...es.map((e) => e.order)), to: Math.max(...es.map((e) => e.order)) });
  }
  return { tracks, arcs, events };
}

// ---------------- tiers ----------------
function systemVisible(repo: WorldRepo, v: Viewer, s: TierSystem) {
  return revealOk(v, s.reveal, `tiers:${s.id}`);
}
export function listTierSystems(repo: WorldRepo, v: Viewer) {
  return repo.world.tierSystems.filter((s) => systemVisible(repo, v, s)).map((s) => ({ id: s.id, name: s.name, scale: s.scale }));
}

interface TierRaw { value?: unknown; history?: Array<{ arcId: string; value: string }> }
export function buildLadder(repo: WorldRepo, v: Viewer, systemId: string, o: { cont?: string; arc?: string }) {
  const sys = repo.world.tierSystems.find((s) => s.id === systemId);
  if (!sys || !systemVisible(repo, v, sys)) throw notFound('tier system');
  const tiers = sys.tiers.filter((t) => revealOk(v, t.reveal, `tier:${sys.id}.${t.id}`)).sort((a, b) => a.order - b.order);
  const byKey = new Map<string, (typeof tiers)[number]>();
  for (const t of tiers) { byKey.set(t.id.toLowerCase(), t); byKey.set(t.name.toLowerCase(), t); }
  const atOrder = repo.world.arcs.find((a) => a.id === o.arc)?.order;
  const entries = new Map<string, Array<ReturnType<typeof brief> & { tier: string }>>(tiers.map((t) => [t.id, []]));
  for (const p of repo.pages.values()) {
    if (!pageVisible(v, p) || (o.cont && p.appliesTo !== 'all' && !p.appliesTo.includes(o.cont))) continue;
    for (const d of repo.typeOf(p)?.fields ?? []) {
      if (d.type !== 'tier' || (d.tierSystemId && d.tierSystemId !== sys.id) || p.fields[d.key] === undefined) continue;
      const r = resolveField(p.fields[d.key], o.cont, v, `${p.id}.${d.key}`);
      if (r.hidden || r.value === undefined) continue;
      let name = String(r.value);
      const hist = (p.fields[d.key] as TierRaw | undefined)?.history;
      if (atOrder !== undefined && Array.isArray(hist)) {
        const h = hist.filter((x) => (repo.world.arcs.find((a) => a.id === x.arcId)?.order ?? Infinity) <= atOrder).sort((a, b) => (repo.world.arcs.find((x) => x.id === a.arcId)?.order ?? 0) - (repo.world.arcs.find((x) => x.id === b.arcId)?.order ?? 0)).at(-1);
        if (h) name = h.value;
        else if (hist.length) continue; // had no tier yet at that arc
      }
      const t = byKey.get(name.toLowerCase());
      if (t) entries.get(t.id)!.push({ ...brief(p), tier: t.name });
    }
  }
  return {
    system: { id: sys.id, name: sys.name, scale: sys.scale },
    tiers: tiers.map((t) => ({ id: t.id, name: t.name, order: t.order, color: t.color, description: t.description, entries: entries.get(t.id)!.sort((a, b) => a.title.localeCompare(b.title)) })),
  };
}

// ---------------- multi compare ----------------
export function compareMany(repo: WorldRepo, v: Viewer, refs: string[], cont?: string) {
  const found = refs.map((r) => repo.findPage(r)).filter((p): p is Page => !!p).slice(0, 5);
  const stubs = found.filter((p) => !pageVisible(v, p)).map((p) => ({ id: p.id, hidden: true as const, title: v.hideTitles ? '???' : p.title }));
  const pages = found.filter((p) => pageVisible(v, p));
  const views = pages.map((p) => ({ p, view: repo.view(p.id, v, cont) })).filter((x) => !x.view.hidden) as Array<{ p: Page; view: Extract<ReturnType<WorldRepo['view']>, { hidden: false }> }>;
  const keys = [...new Set(views.flatMap((x) => x.view.infobox.rows.map((r) => r.key)))];
  const rows = keys.map((key) => {
    const values: Record<string, unknown> = {};
    let label = key;
    for (const x of views) {
      const row = x.view.infobox.rows.find((r) => r.key === key);
      if (row) label = row.label;
      values[x.p.id] = row?.value;
    }
    const uniq = new Set(Object.values(values).map((x) => JSON.stringify(x)));
    return { key, label, values, differs: uniq.size > 1 };
  });
  const rel = repo.relations(v, cont);
  const nb = new Map<string, Set<string>>(views.map((x) => [x.p.id, new Set<string>()]));
  for (const e of rel.edges) { nb.get(e.from)?.add(e.to); nb.get(e.to)?.add(e.from); }
  const sets = [...nb.values()];
  const sharedIds = sets.length > 1 ? [...sets[0]!].filter((id) => sets.every((s) => s.has(id)) && !nb.has(id)) : [];
  const byField: Record<string, { label: string; shared: string[]; unique: Record<string, string[]> }> = {};
  const relKeys = new Set(views.flatMap((x) => (repo.typeOf(x.p)?.fields ?? []).filter((d) => d.type === 'relation').map((d) => d.key)));
  for (const key of relKeys) {
    const per = new Map<string, Set<string>>();
    let label = key;
    for (const x of views) {
      const d = repo.typeOf(x.p)?.fields.find((f) => f.key === key);
      if (!d) continue;
      label = d.label;
      const row = x.view.infobox.rows.find((r) => r.key === key);
      per.set(x.p.id, new Set(row && !row.hidden ? (Array.isArray(row.value) ? row.value : [row.value]).map(String) : []));
    }
    if (per.size < 2) continue;
    const all = [...per.values()];
    const shared = [...all[0]!].filter((n) => all.every((s) => s.has(n)));
    const unique = Object.fromEntries([...per].map(([id, s]) => [id, [...s].filter((n) => !shared.includes(n))]));
    if (shared.length || Object.values(unique).some((u) => u.length)) byField[key] = { label, shared, unique };
  }
  const tiers = [];
  for (const sys of repo.world.tierSystems.filter((s) => systemVisible(repo, v, s))) {
    const lad = buildLadder(repo, v, sys.id, { cont });
    const placements: Record<string, string> = {};
    for (const t of lad.tiers) for (const e of t.entries) if (views.some((x) => x.p.id === e.id)) placements[e.id] = t.name;
    if (Object.keys(placements).length) tiers.push({ systemId: sys.id, name: sys.name, placements, order: Object.fromEntries(lad.tiers.map((t) => [t.name, t.order])) });
  }
  return {
    pages: [...views.map((x) => ({ ...brief(x.p), hidden: false as const })), ...stubs],
    rows, sharedNeighbors: sharedIds.map((id) => brief(repo.pages.get(id)!)), byField, tiers,
  };
}
