import { startServer } from './main';

const s = await startServer({ token: process.env.WORLDLOOM_DEV_TOKEN ?? 'dev-token', port: Number(process.env.WORLDLOOM_DEV_PORT ?? 4777) });
console.log(`API on http://127.0.0.1:${s.port}`);
