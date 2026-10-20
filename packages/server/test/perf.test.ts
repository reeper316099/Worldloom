/** Performance budget: 5,000 pages / 20,000 edges. Search <50 ms, page open <150 ms, startup <3 s. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugify, WorldSchema } from '@worldloom/shared';
import { stableStringify } from '@worldloom/jsonstore';
import { WorldRepo } from '../src/repo';
import { serializePage } from '../src/pagefile';
import { defaultEntityTypes } from '../src/seed';
import { buildGraph } from '../src/visual';

const N = 5000, EDGES_PER = 4;
let dir: string;
let repo: WorldRepo;
let startup = 0;
const WORDS = ['ember', 'cinder', 'ledger', 'furnace', 'lantern', 'warden', 'oath', 'quench', 'forge', 'ashen', 'marrow', 'crown', 'vale', 'keld', 'thorne', 'valdrin'];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-perf-'));
  const w = path.join(dir, 'worlds', 'big');
  const world = WorldSchema.parse({ name: 'Big', slug: 'big', createdAt: new Date().toISOString(), continuities: [{ id: 'c', name: 'C', isPrimary: true }], sources: [{ id: 's', name: 'S', kind: 'other', continuityId: 'c', units: { label: 'Chapter' } }] });
  await fs.mkdir(path.join(w, 'pages', 'character'), { recursive: true });
  await fs.writeFile(path.join(w, 'world.json'), stableStringify(world));
  await fs.mkdir(path.join(w, 'schema'), { recursive: true });
  await fs.writeFile(path.join(w, 'schema', 'entity-types.json'), stableStringify({ schemaVersion: 1, types: defaultEntityTypes() }));
  const now = new Date().toISOString();
  const title = (i: number) => `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} ${i}`;
  const writes: Promise<void>[] = [];
  for (let i = 0; i < N; i++) {
    const allies = Array.from({ length: EDGES_PER }, (_, k) => title((i * 31 + k * 977 + 1) % N));
    const body = `${WORDS[i % 16]} text about ${title((i + 1) % N).split(' ').slice(0, 2).join(' ')}. See [[${title((i + 5) % N)}]] and [[${title((i + 11) % N)}]].\n\n## History\n\n${'Lorem ipsum dolor sit amet '.repeat(30)}\n\n:::spoiler{src="s" at=${i % 50}}\nhidden ${i}\n:::\n`;
    writes.push(fs.writeFile(path.join(w, 'pages', 'character', `${slugify(title(i))}.md`), serializePage({
      id: `p_${i}`, type: 'character', title: title(i), slug: slugify(title(i)), aliases: i % 10 === 0 ? [`alias ${i}`] : [], status: 'draft', tags: [], categories: [],
      fields: { species: 'human', allies }, appliesTo: 'all', dmOnly: false, createdAt: now, updatedAt: now, body,
    })));
  }
  await Promise.all(writes);
  const t = performance.now();
  repo = await new WorldRepo(w, { revisionDebounceMs: 0 }).open();
  startup = performance.now() - t;
}, 120_000);
afterAll(async () => { await repo.close(); });

describe('performance budget (5,000 pages, 20,000+ edges)', () => {
  it('loads the world quickly', () => {
    expect(repo.pages.size).toBe(N);
    console.log(`open ${N} pages: ${startup.toFixed(0)} ms`);
    expect(startup).toBeLessThan(3000);
  });
  it('search < 50 ms (author and reader)', () => {
    const v = (mode: string) => repo.viewer({ mode });
    repo.searchPages('ember', v('reader')); // build reader index (first use)
    for (const mode of ['author', 'reader']) {
      const times: number[] = [];
      for (const q of ['ember', 'cinder warden', 'forge 42', 'lantern', 'type:character vale', 'alias 100']) {
        const t = performance.now();
        repo.searchPages(q, v(mode));
        times.push(performance.now() - t);
      }
      console.log(`search ${mode} median ${median(times).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`);
      expect(median(times)).toBeLessThan(50);
      expect(Math.max(...times)).toBeLessThan(120);
    }
  });
  it('page open < 150 ms (render, infobox, links)', () => {
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      repo.view(`p_${i * 97}`, repo.viewer({ mode: 'reader' }));
      times.push(performance.now() - t);
    }
    console.log(`page view median ${median(times).toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`);
    expect(median(times)).toBeLessThan(150);
  });
  it('backlinks, relations and a 5k-node graph respond in reasonable time', () => {
    let t = performance.now();
    const v = repo.viewer({ mode: 'author' });
    repo.backlinks('p_100', v);
    const bl = performance.now() - t;
    t = performance.now();
    const g = buildGraph(repo, v, {});
    const gt = performance.now() - t;
    console.log(`backlinks ${bl.toFixed(0)} ms; graph ${g.nodes.length} nodes / ${g.edges.length} edges in ${gt.toFixed(0)} ms`);
    expect(g.edges.length).toBeGreaterThan(15000);
    expect(gt).toBeLessThan(1500);
  });
  it('health report and a save stay responsive', async () => {
    let t = performance.now();
    repo.health();
    const h = performance.now() - t;
    t = performance.now();
    await repo.patch('p_7', { tags: ['x'] });
    const s = performance.now() - t;
    console.log(`health ${h.toFixed(0)} ms; patch ${s.toFixed(0)} ms`);
    expect(s).toBeLessThan(300);
  });
});
