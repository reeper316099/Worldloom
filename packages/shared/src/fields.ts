import type { FieldDef } from './schemas';

export class FieldError extends Error {}

const wrapped = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && ('value' in v || 'byContinuity' in v);

/** Coerce a raw value to the field's type. Wrapped values ({value, reveal, byContinuity}) pass through with inner coercion. */
export function coerceField(def: FieldDef, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  if (wrapped(value)) {
    const w = value as { value?: unknown; byContinuity?: Record<string, unknown> };
    const out: Record<string, unknown> = { ...w };
    if ('value' in w) out.value = coerceField(def, w.value);
    if (w.byContinuity) out.byContinuity = Object.fromEntries(Object.entries(w.byContinuity).map(([k, x]) => [k, coerceField(def, x)]));
    return out;
  }
  const many = def.type === 'multiselect' || (def.type === 'relation' && def.multiple);
  if (many) {
    const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [value];
    const items = arr.map((x) => String(x).trim()).filter(Boolean);
    if (def.type === 'multiselect' && def.options) for (const i of items) if (!def.options.includes(i)) throw new FieldError(`${def.key}: "${i}" is not an allowed option`);
    return items;
  }
  switch (def.type) {
    case 'number':
    case 'stat': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) throw new FieldError(`${def.key}: expected a number`);
      if (def.max !== undefined && n > def.max) throw new FieldError(`${def.key}: exceeds max ${def.max}`);
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (/^(true|yes|1)$/i.test(String(value))) return true;
      if (/^(false|no|0)$/i.test(String(value))) return false;
      throw new FieldError(`${def.key}: expected a boolean`);
    case 'select': {
      const s = String(value);
      if (def.options && !def.options.includes(s)) throw new FieldError(`${def.key}: "${s}" is not an allowed option`);
      return s;
    }
    default:
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === 'object') return value;
      return String(value);
  }
}

export function coerceFields(defs: FieldDef[], fields: Record<string, unknown>): Record<string, unknown> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const def = byKey.get(k);
    const c = def ? coerceField(def, v) : v;
    if (c !== undefined) out[k] = c;
  }
  return out;
}
