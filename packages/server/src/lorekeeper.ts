import { z } from 'zod';
import { ApiError, badRequest } from './errors';

/**
 * Optional, user-enabled bridge to the sibling "Lorekeeper" tracker's local API (read-only).
 * It is the ONLY outbound request this app can make, and it is restricted to loopback addresses.
 */
export interface LorekeeperConfig { enabled: boolean; baseUrl: string; token: string }
export const DEFAULT_LOREKEEPER: LorekeeperConfig = { enabled: false, baseUrl: 'http://127.0.0.1:4317', token: '' };

/** Only plain-http loopback URLs are accepted: no other host, no credentials, no redirects. */
export function assertLoopback(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest('Enter a URL like http://127.0.0.1:4317');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'http:' || u.username || u.password || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw badRequest('Only local addresses are allowed (http://127.0.0.1 or http://localhost). Worldloom makes no other network calls.');
  }
  u.pathname = '';
  u.search = '';
  u.hash = '';
  return u;
}

const Progress = z.object({ raw: z.string().nullable().optional(), number: z.number().nullable().optional(), season: z.number().nullable().optional(), kind: z.string().nullable().optional() }).passthrough();
const EntrySchema = z.object({
  id: z.string(), title: z.string(), library: z.string().optional(), status: z.string().nullable().optional(),
  current: Progress.optional(), consumedUpTo: Progress.optional(), totalUnits: z.number().nullable().optional(),
}).passthrough();
const ListSchema = z.object({ items: z.array(EntrySchema), total: z.number() }).passthrough();
export type LkEntry = z.infer<typeof EntrySchema>;

export class LorekeeperClient {
  constructor(private cfg: LorekeeperConfig, private doFetch: typeof fetch = fetch) {}

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    if (!this.cfg.enabled) throw badRequest('The Lorekeeper integration is turned off.');
    const base = assertLoopback(this.cfg.baseUrl);
    let res: Response;
    try {
      res = await this.doFetch(new URL(`/api/v1${path}`, base), {
        headers: { Authorization: `Bearer ${this.cfg.token}`, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      throw new ApiError(502, 'lorekeeper_unreachable', `Could not reach Lorekeeper at ${base.origin}. Is it running (its API must be reachable on that address)? ${(e as Error).name === 'TimeoutError' ? 'Timed out.' : ''}`.trim());
    }
    if (res.status === 401) throw new ApiError(502, 'lorekeeper_unauthorized', 'Lorekeeper rejected the token.');
    if (res.status === 404) throw new ApiError(404, 'lorekeeper_not_found', 'Not found in Lorekeeper.');
    if (!res.ok) throw new ApiError(502, 'lorekeeper_error', `Lorekeeper answered ${res.status}.`);
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new ApiError(502, 'lorekeeper_incompatible', 'Unexpected response from Lorekeeper (is this the right app/version?).');
    return parsed.data;
  }

  async status() {
    await this.get('/health', z.object({ ok: z.boolean() }).passthrough());
    const meta = await this.get('/meta', z.object({ entries: z.number().optional() }).passthrough()).catch(() => ({ entries: undefined }));
    return { ok: true, entries: meta.entries };
  }
  async search(q: string, limit = 20) {
    const r = await this.get(`/entries?q=${encodeURIComponent(q)}&limit=${limit}`, ListSchema);
    return r.items.map(summarize);
  }
  entry(id: string) {
    return this.get(`/entries/${encodeURIComponent(id)}`, EntrySchema);
  }
}

export const summarize = (e: LkEntry) => ({
  id: e.id, title: e.title, library: e.library, status: e.status ?? null, totalUnits: e.totalUnits ?? null,
  current: e.current?.number ?? null, consumedUpTo: e.consumedUpTo?.number ?? null,
});

/** The position to use for spoiler progress from an entry, or null when Lorekeeper has no usable number. */
export function progressOf(e: LkEntry, field: 'current' | 'consumedUpTo'): number | null {
  const p = e[field];
  if (p?.kind === 'complete' && typeof e.totalUnits === 'number') return e.totalUnits;
  return typeof p?.number === 'number' && p.number >= 0 ? p.number : null;
}
