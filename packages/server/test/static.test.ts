import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorldManager, buildApp, APP_CSP } from '../src';

describe('static UI serving', () => {
  it('serves the shell with a strict CSP, blocks traversal, and keeps the API token-protected', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wl-static-'));
    await fs.mkdir(path.join(dir, 'ui/assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'ui/index.html'), '<!doctype html><title>x</title>');
    await fs.writeFile(path.join(dir, 'ui/assets/a.js'), 'console.log(1)');
    await fs.writeFile(path.join(dir, 'secret.txt'), 'top secret');
    const manager = await new WorldManager(path.join(dir, 'data')).init();
    const app = await buildApp({ token: 't', manager, staticDir: path.join(dir, 'ui') });
    const root = await app.inject({ url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-security-policy']).toBe(APP_CSP);
    expect(APP_CSP).toContain("script-src 'self'");
    expect(APP_CSP).not.toContain('unsafe-eval');
    expect(APP_CSP).toContain("object-src 'none'");
    const js = await app.inject({ url: '/assets/a.js' });
    expect(js.headers['content-type']).toContain('javascript');
    for (const evil of ['/..%2Fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2F..%2Fsecret.txt']) {
      const r = await app.inject({ url: evil });
      expect(r.body, evil).not.toContain('top secret');
    }
    expect((await app.inject({ url: '/api/v1/worlds' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/worlds', headers: { authorization: 'Bearer t' } })).statusCode).toBe(200);
    await app.close();
    await manager.close();
  });
});
