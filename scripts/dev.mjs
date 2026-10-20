// Runs the API (fixed dev token/port, ./.dev-data) and Vite together.
import { spawn } from 'node:child_process';
const env = { ...process.env, WORLDLOOM_DATA_DIR: process.env.WORLDLOOM_DATA_DIR ?? '.dev-data', WORLDLOOM_DEV_TOKEN: 'dev-token', WORLDLOOM_DEV_PORT: '4777' };
const run = (cmd, args, cwd) => spawn(cmd, args, { stdio: 'inherit', env, cwd, shell: process.platform === 'win32' });
const api = run('npx', ['tsx', 'packages/server/src/dev.ts']);
const web = run('npx', ['vite'], 'apps/web');
const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
api.on('exit', stop); web.on('exit', stop);
