import crypto from 'node:crypto';
import { acquireInstanceLock } from '@worldloom/jsonstore';
import { buildApp } from './app';
import { WorldManager, defaultDataDir } from './manager';

/** Starts the API on an ephemeral loopback port. Prints {port, token} as JSON for the desktop shell. */
export async function startServer(o: { dataDir?: string; token?: string; port?: number; watch?: boolean } = {}) {
  const dataDir = o.dataDir ?? defaultDataDir();
  const release = await acquireInstanceLock(dataDir);
  const manager = await new WorldManager(dataDir, { watch: o.watch ?? true }).init({ launchBackup: true });
  const token = o.token ?? crypto.randomBytes(24).toString('hex');
  const app = await buildApp({ token, manager, log: (l) => process.env.WORLDLOOM_LOG && process.stderr.write(JSON.stringify(l) + '\n') });
  await app.listen({ host: '127.0.0.1', port: o.port ?? 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port, token, app, manager,
    close: async () => {
      await app.close();
      await manager.close();
      await release();
    },
  };
}

if (process.argv[1] && /main\.[tj]s$/.test(process.argv[1])) {
  startServer().then((s) => console.log(JSON.stringify({ port: s.port, token: s.token })));
}
