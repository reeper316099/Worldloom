import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldSchema } from '@worldloom/shared';
import { atomicWrite } from '@worldloom/jsonstore';
import { notFound } from './errors';

export function defaultStarterDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'starter-worlds');
}

async function countPages(dir: string): Promise<number> {
  let n = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) n += await countPages(path.join(dir, e.name));
    else if (e.name.endsWith('.md')) n++;
  }
  return n;
}

export async function listStarters(starterDir: string) {
  const out = [];
  for (const e of await fs.readdir(starterDir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name === 'src' || e.name === 'type-packs') continue;
    try {
      const w = WorldSchema.parse(JSON.parse(await fs.readFile(path.join(starterDir, e.name, 'world.json'), 'utf8')));
      out.push({ id: e.name, name: w.name, description: w.description, accent: w.accent, pages: await countPages(path.join(starterDir, e.name, 'pages')) });
    } catch {
      /* not a starter */
    }
  }
  return out;
}

/** Copy a starter world into the user's worlds dir under a unique slug. Returns the new slug. */
export async function installStarter(starterDir: string, id: string, worldsDir: string, taken: Set<string>): Promise<string> {
  if (!/^[a-z0-9-]+$/.test(id)) throw notFound('starter world');
  const src = path.join(starterDir, id);
  try {
    await fs.access(path.join(src, 'world.json'));
  } catch {
    throw notFound('starter world');
  }
  let slug = id;
  for (let i = 2; taken.has(slug); i++) slug = `${id}-${i}`;
  const dest = path.join(worldsDir, slug);
  await fs.cp(src, dest, { recursive: true });
  const wf = path.join(dest, 'world.json');
  const w = JSON.parse(await fs.readFile(wf, 'utf8'));
  w.slug = slug;
  w.createdAt = new Date().toISOString();
  await atomicWrite(wf, JSON.stringify(w, null, 2) + '\n');
  return slug;
}
