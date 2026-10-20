import { isVisible, type Arc, type Page, type Progress, type Reveal, type Source } from '@worldloom/shared';

/** Everything needed to decide what a reader may see. Built per request from the world + query. */
export interface Viewer {
  mode: 'reader' | 'author';
  /** Player view: also hide dm-only content. */
  player: boolean;
  hideTitles: boolean;
  progress: Progress;
  arcs: Arc[];
  sources: Source[];
  primarySourceIds: string[];
}

export const AUTHOR: Pick<Viewer, 'mode'> = { mode: 'author' };

function ctx(v: Viewer) {
  return { progress: v.progress, arcs: v.arcs, sources: v.sources, primarySourceIds: v.primarySourceIds };
}

export function revealOk(v: Viewer, reveal: Reveal | undefined | null, key?: string): boolean {
  if (v.mode === 'author') return true;
  return isVisible([reveal], ctx(v), key);
}

export function pageKey(p: { id: string }) {
  return `page:${p.id}`;
}

/** Can the viewer see this page at all (body, fields, existence in lists)? */
export function pageVisible(v: Viewer, p: Pick<Page, 'id' | 'reveal' | 'dmOnly'>): boolean {
  if (v.mode === 'author') return true;
  if (v.player && p.dmOnly) return false;
  return isVisible([p.reveal], ctx(v), pageKey(p));
}
