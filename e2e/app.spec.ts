import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'wl-e2e-'));
const W = 'the-ashen-ascent';
let app: ElectronApplication;
let page: Page;

async function launch() {
  app = await electron.launch({
    args: [path.join(root, 'apps/desktop'), ...(process.env.CI ? ['--no-sandbox'] : [])],
    env: { ...process.env, WORLDLOOM_DATA_DIR: dataDir },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
}
const api = (p: string) => page.evaluate(async (path) => {
  const c = (window as unknown as { worldloom: { baseUrl: string; token: string } }).worldloom;
  const r = await fetch(`${c.baseUrl}/api/v1${path}`, { headers: { Authorization: `Bearer ${c.token}` } });
  return { status: r.status, text: await r.text() };
}, p);
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
// Electron pages cannot open extra targets, so run axe in-page (CDP evaluate is not subject to the app's CSP).
const shot = async (name: string) => { if (process.env.SCREENSHOTS) await page.screenshot({ path: path.join(root, 'docs/screenshots', `${name}.png`) }); };
const a11y = async (label: string) => {
  await page.evaluate(axeSource);
  const r = await page.evaluate(async () => {
    const res = await (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ html: string }> }> }> } }).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ html: n.html })) }));
  });
  const bad = r.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.html.slice(0, 160)}`), 'a11y violations').toEqual([]);
};

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => { await app?.close().catch(() => undefined); rmSync(dataDir, { recursive: true, force: true }); });

test('first run: onboarding, demo world, progress, spoiler hiding', async () => {
  const t0 = Date.now();
  await launch();
  await expect(page.getByRole('heading', { name: 'Welcome to Worldloom' })).toBeVisible();
  console.log(`startup to first paint: ${Date.now() - t0} ms`);
  expect(Date.now() - t0).toBeLessThan(8000);
  await a11y('home');

  await page.locator('.card', { hasText: 'The Ashen Ascent' }).getByRole('button', { name: 'Open demo world' }).click();
  await expect(page.getByRole('heading', { name: 'The Ashen Ascent' })).toBeVisible();
  await shot('dashboard');
  await a11y('dashboard');

  // set progress: web novel chapter 60, then switch to reader mode
  await page.getByRole('button', { name: 'Progress' }).click();
  const ch = page.getByRole('dialog', { name: 'My progress' }).getByLabel(/Web Novel · Chapter/);
  await ch.fill('60');
  await ch.press('Tab');
  await page.getByRole('dialog', { name: 'My progress' }).getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /Author mode/ }).click();
  await expect(page.getByRole('button', { name: /Reader mode/ })).toBeVisible();

  // page view: gated block hidden, gated field masked, nothing leaks into the DOM
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/p/kael-marrow`);
  const prose = page.locator('article.prose');
  await expect(prose).toContainText('Spoiler for wn 120');
  expect(await page.content()).not.toContain('splinter of the Cold Furnace');
  await expect(page.locator('.infobox-row.gated')).toBeVisible();
  await shot('page-reader-mode');
  await a11y('page');

  // search + palette must not find gated text
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search' }).fill('splinter');
  await expect(page.getByRole('option', { name: /Kael Marrow/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // graph/timeline APIs (what the canvas renders) contain no gated nodes or events
  const g = await api(`/worlds/${W}/graph?mode=reader`);
  expect(g.status).toBe(200);
  expect(g.text).not.toContain('Sable');
  expect(g.text).not.toContain('Hollow Flame');
  expect((await api(`/worlds/${W}/timeline?mode=reader`)).text).not.toContain('Orrin Vale falls');

  // reveal one block (undoable), then the secret is visible
  await prose.locator('.spoiler-hidden').first().click();
  await expect(prose).toContainText('splinter of the Cold Furnace');
});

test('editing: [[ autocomplete, autosave, rename with link rewrite, continuity switch', async () => {
  await page.getByRole('button', { name: /Reader mode/ }).click(); // back to author
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/p/tamsin-quill/edit`);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n\nShe lives in [[Ashm');
  // wait until the completion list is settled and the right entry is selected (slow CI otherwise turns Enter into a newline)
  await expect(page.locator('.cm-tooltip-autocomplete li[aria-selected="true"]')).toContainText('Ashmere');
  await page.keyboard.press('Enter');
  await expect(editor).toContainText('[[Ashmere]]');
  await expect(page.locator('.prose a.wikilink', { hasText: 'Ashmere' })).toBeVisible(); // live preview
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });
  await a11y('editor');

  // rename "Ember Ledger" -> "Ash Ledger" and rewrite inbound links
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/p/ember-ledger`);
  await page.getByRole('button', { name: 'Rename' }).click();
  const dlg = page.getByRole('dialog', { name: 'Rename page' });
  await dlg.getByRole('textbox').fill('Ash Ledger');
  await dlg.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { name: 'Ash Ledger' })).toBeVisible();
  const raw = await api(`/worlds/${W}/pages/cinder-guild/raw?mode=author`);
  expect(JSON.parse(raw.text).body).toContain('[[Ash Ledger]]');
  expect(JSON.parse(raw.text).body).not.toContain('[[Ember Ledger]]');

  // continuity switch changes content
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/p/kael-marrow`);
  await page.getByLabel('Continuity').selectOption({ label: 'Adaptation' });
  await expect(page.locator('article.prose')).toContainText('still only');
  await page.getByLabel('Continuity').selectOption({ label: 'Web Novel' });
  await expect(page.locator('article.prose')).not.toContainText('still only');
});

test('timeline and graph render; restart persists everything', async () => {
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/timeline`);
  await expect(page.getByRole('group', { name: 'Timeline' })).toBeVisible();
  expect(await page.locator('svg g.ev').count()).toBeGreaterThan(3);
  await shot('timeline');
  await a11y('timeline');
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/graph`);
  await expect(page.locator('.graph-canvas canvas').first()).toBeAttached();
  await expect(page.getByText(/\d+ nodes · \d+ edges/)).toBeVisible();
  await page.waitForTimeout(1500);
  await shot('graph');
  await a11y('graph');
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/tiers`);
  await expect(page.locator('.ladder .tier').first()).toBeVisible();

  await app.close();
  expect(existsSync(path.join(dataDir, 'worlds', W, 'pages', 'item', 'ash-ledger.md'))).toBe(true);
  await launch();
  await expect(page.getByRole('heading', { name: 'Your worlds' })).toBeVisible();
  await page.goto(`${page.url().split('#')[0]}#/w/${W}/p/ash-ledger`);
  await expect(page.getByRole('heading', { name: 'Ash Ledger' })).toBeVisible();
  const prog = JSON.parse((await api(`/worlds/${W}/progress`)).text);
  expect(prog.sources.wn).toBe(60);
  expect(prog.revealed.length).toBe(1);
  // security: the API refuses requests without the per-launch token
  const noAuth = await page.evaluate(async () => (await fetch(`${(window as unknown as { worldloom: { baseUrl: string } }).worldloom.baseUrl}/api/v1/worlds`)).status);
  expect(noAuth).toBe(401);
  // renderer is sandboxed: no Node globals
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require + typeof (window as unknown as { process?: unknown }).process)).toBe('undefinedundefined');
});

test('encrypted world: encrypt, lock, unlock (UI), files unreadable on disk', async () => {
  const base = page.url().split('#')[0];
  await page.goto(`${base}#/w/${W}/data`);
  await expect(page.getByRole('heading', { name: /Encryption/ })).toBeVisible();
  await a11y('data');
  await page.getByLabel('Passphrase', { exact: true }).fill('e2e passphrase 123');
  await page.getByLabel('Repeat passphrase').fill('e2e passphrase 123');
  await page.getByLabel('Name shown while locked').fill('My private lore');
  await page.getByRole('button', { name: 'Encrypt this world' }).click();
  await expect(page.getByRole('heading', { name: /Encryption 🔒 on/ })).toBeVisible({ timeout: 20_000 });
  const pagesDir = path.join(dataDir, 'worlds', W, 'pages', 'character');
  const { readdirSync, readFileSync } = await import('node:fs');
  expect(readdirSync(pagesDir).every((f) => /^p_|^st_/.test(f))).toBe(true);
  expect(readFileSync(path.join(pagesDir, readdirSync(pagesDir)[0]!)).includes(Buffer.from('Kael'))).toBe(false);

  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'Your worlds' })).toBeVisible();
  const card = page.locator('.card', { hasText: 'My private lore' });
  await expect(card).toContainText('Locked');
  await card.click();
  const dlg = page.getByRole('dialog', { name: 'Unlock world' });
  await expect(dlg).toBeVisible();
  await a11y('unlock');
  await dlg.getByLabel('Passphrase').fill('wrong wrong wrong');
  await dlg.getByRole('button', { name: 'Unlock' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Wrong passphrase');
  await page.waitForTimeout(1200); // throttle window
  await dlg.getByLabel('Passphrase').fill('e2e passphrase 123');
  await dlg.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('heading', { name: 'The Ashen Ascent' })).toBeVisible();
  await page.goto(`${base}#/w/${W}/p/kael-marrow`);
  await expect(page.getByRole('heading', { name: 'Kael Marrow' })).toBeVisible();
});
