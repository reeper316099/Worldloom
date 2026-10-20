import { promises as fs } from 'node:fs';
import path from 'node:path';

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Single-instance lock via pid file. Returns release fn, or throws if another live instance holds it. */
export async function acquireInstanceLock(dir: string): Promise<() => Promise<void>> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, '.lock');
  try {
    const pid = Number(await fs.readFile(file, 'utf8'));
    if (pid && pid !== process.pid && alive(pid)) throw new Error(`another instance is running (pid ${pid})`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && !(e as Error).message.startsWith('another')) {
      /* unreadable lock: take over */
    } else if ((e as Error).message?.startsWith('another')) throw e;
  }
  await fs.writeFile(file, String(process.pid));
  return async () => {
    await fs.rm(file, { force: true });
  };
}
