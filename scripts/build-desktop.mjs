// Builds the desktop app into apps/desktop/dist: web UI (vite), main + preload (esbuild), starter worlds.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'apps/desktop/dist');
const sh = process.platform === 'win32';
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

execFileSync('npx', ['vite', 'build'], { cwd: path.join(root, 'apps/web'), stdio: 'inherit', shell: sh });
cpSync(path.join(root, 'apps/web/dist'), path.join(dist, 'renderer'), { recursive: true });

const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', external: ['electron'], logLevel: 'info', sourcemap: false, legalComments: 'none' };
await build({
  ...common, entryPoints: [path.join(root, 'apps/desktop/src/desktop.ts')], outfile: path.join(dist, 'desktop.cjs'),
  define: { 'import.meta.url': '__importMetaUrl' }, banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
});
await build({ ...common, entryPoints: [path.join(root, 'apps/desktop/src/preload.ts')], outfile: path.join(dist, 'preload.cjs') });

for (const w of ['the-ashen-ascent', 'gloamreach-campaign']) {
  const src = path.join(root, 'starter-worlds', w);
  if (!existsSync(src)) throw new Error(`missing starter world ${w}; run: npx tsx starter-worlds/src/build.ts`);
  cpSync(src, path.join(dist, 'starter-worlds', w), { recursive: true });
}
console.log('desktop build ready:', dist);
