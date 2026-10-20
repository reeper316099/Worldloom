import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

export interface WatchEvent {
  kind: 'add' | 'change' | 'unlink';
  file: string;
}

/** Watch a directory for external edits. Ignores our own tmp files and quarantine/backup files. */
export function watchDir(dir: string, onEvent: (e: WatchEvent) => void): FSWatcher {
  const w = chokidar.watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    ignored: (p: string) => /(^|[\\/])\.[^\\/]*\.tmp$|\.corrupt-\d+$|\.bak$/.test(p),
  });
  for (const kind of ['add', 'change', 'unlink'] as const) w.on(kind, (f: string) => onEvent({ kind, file: path.resolve(f) }));
  return w;
}
