// Runs the API (fixed dev token/port, ./.dev-data) and Vite together.
import { spawn } from 'node:child_process';
import net from 'node:net';

// Fail early with a clear message if another dev session already owns the API port (a second `npm run dev` otherwise looks like "cannot reach the local API").
await new Promise((resolve) => {
  const probe = net.createServer().once('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.error('\n[worldloom] Port 4777 is already in use: another dev session (or an old preview) is running. Stop it first, then run `npm run dev` again.\n'); process.exit(1); }
    resolve();
  }).once('listening', () => probe.close(resolve)).listen(4777, '127.0.0.1');
});
const env = { ...process.env, WORLDLOOM_DATA_DIR: process.env.WORLDLOOM_DATA_DIR ?? '.dev-data', WORLDLOOM_DEV_TOKEN: 'dev-token', WORLDLOOM_DEV_PORT: '4777' };
const run = (cmd, args, cwd) => spawn(cmd, args, { stdio: 'inherit', env, cwd, shell: process.platform === 'win32' });
const api = run('npx', ['tsx', 'packages/server/src/dev.ts']);
const web = run('npx', ['vite'], 'apps/web');
const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
api.on('exit', stop); web.on('exit', stop);
