import type { Reveal, World } from '@worldloom/shared';

export interface PageDef {
  type: string;
  title: string;
  aliases?: string[];
  status?: 'stub' | 'draft' | 'complete';
  tags?: string[];
  fields?: Record<string, unknown>;
  reveal?: Reveal;
  dmOnly?: boolean;
  appliesTo?: 'all' | string[];
  body: string;
}
export interface RelationDef {
  from: string; // page title
  to: string;
  kind: string;
  label?: string;
  reveal?: Reveal;
  continuityIds?: string[];
  timeSpan?: { fromArcId?: string; toArcId?: string };
}
export interface StarterWorld {
  slug: string;
  world: Omit<World, 'createdAt' | 'schemaVersion'>;
  pack: string; // built-in pack id
  pages: PageDef[];
  relations: RelationDef[];
  /** Strings that appear ONLY in spoiler-gated content; used by the leak tests. */
  secrets: string[];
  /** Subset of secrets gated by reading progress (not DM-only); checked in non-player reader mode too. */
  spoilerSecrets: string[];
}
export const wn = (at: number): Reveal => ({ sourceId: 'wn', at });
export const arc = (arcId: string): Reveal => ({ arcId });
/** Field value with a reveal gate and/or per-continuity values. */
export const gated = (value: unknown, reveal?: Reveal, byContinuity?: Record<string, unknown>) => ({ value, ...(reveal ? { reveal } : {}), ...(byContinuity ? { byContinuity } : {}) });
