import type { Arc, Progress, Reveal, Source } from './schemas';

export interface RevealContext {
  progress: Progress;
  arcs: Arc[];
  sources: Source[];
  /** id of the primary continuity's sources are treated as primary */
  primarySourceIds?: string[];
}

/**
 * Effective progress per source: own progress, raised by the arc checkpoint's implied floor.
 * Conservative: primary sources floor at range.to; others at range.from (lowest implied).
 */
export function effectiveProgress(ctx: RevealContext): Record<string, number> {
  const out: Record<string, number> = { ...ctx.progress.sources };
  const cp = ctx.progress.arcCheckpoint
    ? ctx.arcs.find((a) => a.id === ctx.progress.arcCheckpoint)
    : undefined;
  if (!cp) return out;
  const primary = new Set(ctx.primarySourceIds ?? []);
  for (const [sid, range] of Object.entries(cp.ranges)) {
    const full = ctx.progress.impliedFloor === 'full' || primary.has(sid);
    const floor = full ? range.to : range.from;
    out[sid] = Math.max(out[sid] ?? -Infinity, floor);
  }
  return out;
}

/** Is a single reveal gate satisfied? Unknown progress => false (hidden). */
export function revealSatisfied(reveal: Reveal, ctx: RevealContext): boolean {
  const eff = effectiveProgress(ctx);
  if ('sourceId' in reveal) {
    const p = eff[reveal.sourceId];
    return p !== undefined && p >= reveal.at;
  }
  const arc = ctx.arcs.find((a) => a.id === reveal.arcId);
  if (!arc) return false;
  const cp = ctx.progress.arcCheckpoint
    ? ctx.arcs.find((a) => a.id === ctx.progress.arcCheckpoint)
    : undefined;
  if (cp && cp.order >= arc.order) return true;
  for (const [sid, range] of Object.entries(arc.ranges)) {
    const p = eff[sid];
    if (p !== undefined && p >= range.from) return true;
  }
  return false;
}

/**
 * An item is visible iff showAll, or it was individually revealed (itemKey), or every reveal
 * on it and its ancestors is satisfied. `reveals` should include ancestor gates (block ⊂ page).
 */
export function isVisible(
  reveals: Array<Reveal | undefined | null>,
  ctx: RevealContext,
  itemKey?: string,
): boolean {
  if (ctx.progress.showAll) return true;
  if (itemKey && ctx.progress.revealed.includes(itemKey)) return true;
  return reveals.every((r) => !r || revealSatisfied(r, ctx));
}
