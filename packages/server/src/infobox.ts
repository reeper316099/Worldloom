import type { EntityType, FieldDef, Page, Reveal } from '@worldloom/shared';
import { escapeHtml } from '@worldloom/wikisyntax';
import { revealOk, type Viewer } from './visibility';

export interface InfoboxRow {
  key: string;
  label: string;
  type: FieldDef['type'];
  value: unknown;
  hidden?: boolean;
}
export interface Infobox {
  title: string;
  type: string;
  image?: string;
  rows: InfoboxRow[];
}

interface Wrapped {
  value?: unknown;
  reveal?: Reveal;
  cite?: string;
  byContinuity?: Record<string, unknown>;
}
const isWrapped = (v: unknown): v is Wrapped =>
  !!v && typeof v === 'object' && !Array.isArray(v) && ('value' in v || 'byContinuity' in v);

/** Resolve a stored field value for a continuity, honouring per-field reveal. */
export function resolveField(raw: unknown, continuity: string | undefined, v: Viewer, key: string) {
  let value = raw;
  let reveal: Reveal | undefined;
  if (isWrapped(raw)) {
    reveal = raw.reveal;
    value = raw.value;
    if (raw.byContinuity) {
      const pick = continuity !== undefined && continuity in raw.byContinuity ? raw.byContinuity[continuity] : raw.value;
      if (isWrapped(pick)) {
        reveal = pick.reveal ?? reveal;
        value = pick.value;
      } else value = pick;
    }
  }
  const ok = revealOk(v, reveal, `field:${key}`);
  return { value: ok ? value : undefined, hidden: !ok };
}

export function buildInfobox(page: Page, type: EntityType | undefined, v: Viewer, continuity?: string): Infobox {
  const defs: FieldDef[] = type?.fields ?? [];
  const known = new Set(defs.map((d) => d.key));
  const extra: FieldDef[] = Object.keys(page.fields)
    .filter((k) => !known.has(k))
    .map((k) => ({ key: k, label: k, type: 'text', perContinuity: false }));
  const rows: InfoboxRow[] = [];
  for (const d of [...defs, ...extra]) {
    const raw = page.fields[d.key];
    if (raw === undefined || raw === null || raw === '') continue;
    const r = resolveField(raw, continuity, v, `${page.id}.${d.key}`);
    if (r.hidden) rows.push({ key: d.key, label: d.label, type: d.type, value: '???', hidden: true });
    else if (r.value !== undefined && r.value !== null && r.value !== '') rows.push({ key: d.key, label: d.label, type: d.type, value: r.value });
  }
  const img = typeof page.fields.image === 'string' ? page.fields.image : undefined;
  return { title: page.title, type: page.type, image: img, rows };
}

const fmt = (x: unknown): string => (Array.isArray(x) ? x.map(fmt).join(', ') : typeof x === 'object' && x ? JSON.stringify(x) : String(x));

/** Trusted HTML for an infobox. `link` turns a relation value into an <a> (or plain text). */
export function infoboxHtml(box: Infobox, link: (title: string) => string | undefined): string {
  const cell = (r: InfoboxRow) => {
    if (r.type === 'relation' && !r.hidden) {
      const vals = Array.isArray(r.value) ? r.value : [r.value];
      return vals.map((x) => link(String(x)) ?? escapeHtml(String(x))).join(', ');
    }
    return escapeHtml(fmt(r.value));
  };
  return (
    `<aside class="infobox"><div class="infobox-title">${escapeHtml(box.title)}</div>` +
    box.rows.map((r) => `<div class="infobox-row${r.hidden ? ' gated' : ''}"><span class="k">${escapeHtml(r.label)}</span><span class="v">${cell(r)}</span></div>`).join('') +
    `</aside>`
  );
}
