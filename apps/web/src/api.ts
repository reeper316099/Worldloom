export interface Cfg { baseUrl: string; token: string }
declare global { interface Window { worldloom?: Cfg } }
const cfg: Cfg = window.worldloom ?? { baseUrl: '', token: 'dev-token' };

export class ApiErr extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Network-level failures (connection reset/refused, e.g. the API restarting) are retried for idempotent requests. */
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const idempotent = method === 'GET' || method === 'PUT' || method === 'DELETE';
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${cfg.baseUrl}/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${cfg.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      // a dev proxy answers 502/503/504 (or 500 with no JSON body) while the API is briefly unreachable
      if (idempotent && attempt < 3 && res.status >= 500) {
        const peek = await res.clone().text();
        let ours = false;
        try { ours = !!JSON.parse(peek)?.error; } catch { /* not our JSON error shape: the proxy answered */ }
        if (!ours) { await sleep(250 * 2 ** attempt); continue; }
      }
      break;
    } catch (e) {
      if (!idempotent || attempt >= 3) throw new ApiErr(0, `Failed to fetch (${method} ${path.split('?')[0]}). The local API is not answering.`, e);
      await sleep(250 * 2 ** attempt);
    }
  }
  const text = await res.text();
  let data: { error?: { message?: string; details?: unknown } } | undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { /* non-JSON body from a proxy */ }
  if (!res.ok) throw new ApiErr(res.status, data?.error?.message ?? (res.status >= 500 ? `The local API returned ${res.status}` : res.statusText), data?.error?.details);
  return data as T;
}
export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, b?: unknown) => req<T>('POST', p, b ?? {}),
  put: <T>(p: string, b: unknown) => req<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown) => req<T>('PATCH', p, b),
  del: <T>(p: string) => req<T>('DELETE', p),
};
export const q = (o: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return s ? '?' + s : '';
};

export interface WorldSummary { slug: string; name: string; description: string; accent: string; pageCount: number; completeness: number; lastEdited: string }
export interface Continuity { id: string; name: string; color: string; isPrimary: boolean }
export interface SourceT { id: string; name: string; kind: string; continuityId: string; units: { label: string; count?: number } }
export interface ArcT { id: string; name: string; order: number }
export interface Progress { sources: Record<string, number>; arcCheckpoint?: string; showAll: boolean; revealed: string[] }
export interface World { slug: string; name: string; description: string; accent: string; theme: { readingFont: 'serif' | 'sans' }; continuities: Continuity[]; sources: SourceT[]; arcs: ArcT[]; progress: Progress }
export interface FieldDef { key: string; label: string; type: string; options?: string[]; multiple?: boolean; relationTo?: string; relationKind?: string; perContinuity?: boolean }
export interface EntityType { id: string; name: string; slug: string; fields: FieldDef[]; bodyTemplate: string }
export interface ListItem { id: string; title: string; slug: string; type?: string; status?: string; hidden: boolean; updatedAt?: string; aliases?: string[] }
export interface InfoRow { key: string; label: string; type: string; value: unknown; hidden?: boolean; revealKey?: string }
export interface PageView {
  hidden: false; id: string; title: string; slug: string; type: string; typeName: string; status: string; aliases: string[]; tags: string[];
  categories: string[]; breadcrumbs: Array<{ id: string; title: string; slug: string }>; appliesToSelected: boolean; html: string; headings: Array<{ depth: number; text: string; id: string }>; infobox: { rows: InfoRow[] };
  claims: Array<{ kind: string; text: string; cited: boolean }>; updatedAt: string; dmOnly: boolean;
}
export interface PageHidden { hidden: true; id: string; title: string; message: string }
export interface RawPage { id: string; type: string; title: string; slug: string; aliases: string[]; status: string; tags: string[]; fields: Record<string, unknown>; appliesTo: 'all' | string[]; reveal?: { sourceId: string; at: number } | { arcId: string }; dmOnly?: boolean; body: string }
export interface Hit { id: string; title: string; slug: string; type: string; snippet?: string; alias?: string }
