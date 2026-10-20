// Generates the on-disk starter worlds + type packs from the TS definitions: `npx tsx starter-worlds/src/build.ts`
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, WorldSchema, type Page, type Relation } from '@worldloom/shared';
import { stableStringify } from '@worldloom/jsonstore';
import { serializePage } from '../../packages/server/src/pagefile';
import { BUILTIN_PACKS } from '../../packages/server/src/packs';
import { SERIES } from './series';
import { CAMPAIGN } from './campaign';
import type { StarterWorld } from './dsl';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-01-01T00:00:00.000Z';

export function pageId(type: string, title: string) {
  return `st_${type}_${slugify(title)}`;
}

export async function buildWorld(w: StarterWorld, outDir: string) {
  await fs.rm(outDir, { recursive: true, force: true });
  const pack = BUILTIN_PACKS[w.pack]!;
  const world = WorldSchema.parse({ ...w.world, createdAt: NOW });
  await write(path.join(outDir, 'world.json'), stableStringify(world));
  await write(path.join(outDir, 'schema/entity-types.json'), stableStringify({ schemaVersion: 1, types: pack.types }));
  const byTitle = new Map<string, string>();
  for (const p of w.pages) byTitle.set(p.title, pageId(p.type, p.title));
  for (const d of w.pages) {
    const page: Page = {
      id: pageId(d.type, d.title), type: d.type, title: d.title, slug: slugify(d.title), aliases: d.aliases ?? [], status: d.status ?? 'stub',
      tags: d.tags ?? [], categories: [], fields: d.fields ?? {}, appliesTo: d.appliesTo ?? 'all', reveal: d.reveal, dmOnly: d.dmOnly ?? false,
      createdAt: NOW, updatedAt: NOW, body: d.body,
    };
    await write(path.join(outDir, 'pages', d.type, `${page.slug}.md`), serializePage(page));
  }
  const relations: Relation[] = w.relations.map((r, i) => {
    const from = byTitle.get(r.from), to = byTitle.get(r.to);
    if (!from || !to) throw new Error(`relation references unknown page: ${r.from} -> ${r.to}`);
    return { id: `r${i + 1}`, fromId: from, toId: to, kind: r.kind, label: r.label, reveal: r.reveal, timeSpan: r.timeSpan, continuityIds: r.continuityIds };
  });
  await write(path.join(outDir, 'relations.json'), stableStringify({ schemaVersion: 1, relations }));
  const events = (w.timeline ?? []).map((e) => ({
    id: e.id, title: e.title, summary: e.summary ?? '', order: e.order, label: e.label, trackId: e.trackId ?? null, arcId: e.arcId, reveal: e.reveal,
    pageIds: (e.pages ?? []).map((t) => { const id = byTitle.get(t); if (!id) throw new Error(`timeline event "${e.title}" references unknown page ${t}`); return id; }),
  }));
  await write(path.join(outDir, 'timeline.json'), stableStringify({ schemaVersion: 1, events }));
}

async function write(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

if (process.argv[1] && /build\.ts$/.test(process.argv[1])) {
  for (const w of [SERIES, CAMPAIGN]) await buildWorld(w, path.join(root, w.slug));
  for (const [id, pack] of Object.entries(BUILTIN_PACKS)) await write(path.join(root, 'type-packs', `${id}.json`), stableStringify(pack));
  console.log('starter worlds built');
}
