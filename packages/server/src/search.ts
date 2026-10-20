import MiniSearch from 'minisearch';

export interface SearchDoc {
  id: string;
  title: string;
  aliases: string;
  headings: string;
  body: string;
  tags: string;
  type: string;
  status: string;
  appliesTo: string[] | 'all';
  sources: string;
}

export interface SearchFilters {
  type?: string[];
  tag?: string[];
  cont?: string[];
  status?: string[];
  src?: string[];
}

/** Parse `type:character tag:x some words` into filters + free text. */
export function parseQuery(q: string): { text: string; filters: SearchFilters } {
  const filters: SearchFilters = {};
  const text = q
    .replace(/\b(type|tag|cont|status|src):("[^"]+"|\S+)/gi, (_, k: string, v: string) => {
      const key = k.toLowerCase() as keyof SearchFilters;
      (filters[key] ??= []).push(v.replace(/^"|"$/g, '').toLowerCase());
      return '';
    })
    .trim();
  return { text, filters };
}

export class SearchIndex {
  private ms: MiniSearch<SearchDoc>;
  private docs = new Map<string, SearchDoc>();
  constructor() {
    this.ms = new MiniSearch<SearchDoc>({
      fields: ['title', 'aliases', 'headings', 'body', 'tags'],
      storeFields: [],
      searchOptions: { boost: { title: 10, aliases: 8, headings: 3, tags: 2, body: 1 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
    });
  }
  get size() {
    return this.docs.size;
  }
  upsert(d: SearchDoc) {
    if (this.docs.has(d.id)) this.ms.replace(d);
    else this.ms.add(d);
    this.docs.set(d.id, d);
  }
  remove(id: string) {
    if (!this.docs.has(id)) return;
    this.ms.discard(id);
    this.docs.delete(id);
  }
  clear() {
    this.ms.removeAll();
    this.docs.clear();
  }
  search(q: string, limit = 25): Array<{ id: string; score: number }> {
    const { text, filters } = parseQuery(q);
    const pass = (d: SearchDoc) =>
      (!filters.type || filters.type.includes(d.type)) &&
      (!filters.status || filters.status.includes(d.status)) &&
      (!filters.tag || filters.tag.every((t) => d.tags.toLowerCase().split(/\s+/).includes(t))) &&
      (!filters.cont || filters.cont.some((c) => d.appliesTo === 'all' || d.appliesTo.map((x) => x.toLowerCase()).includes(c))) &&
      (!filters.src || filters.src.every((s) => d.sources.toLowerCase().includes(s)));
    const hits = text
      ? this.ms.search(text, { filter: (r) => pass(this.docs.get(r.id as string)!) })
      : [...this.docs.values()].filter(pass).map((d) => ({ id: d.id, score: 0 }));
    return hits.slice(0, limit).map((h) => ({ id: h.id as string, score: h.score }));
  }
}

/** Snippet around the first matching term; text must already be spoiler-filtered. */
export function snippet(body: string, q: string, len = 140): string {
  const plain = body.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a: string, b?: string) => b ?? a).replace(/[#*_`>{}:[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  const terms = parseQuery(q).text.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = plain.toLowerCase();
  const i = terms.map((t) => lower.indexOf(t)).filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? 0;
  const s = Math.max(0, i - 30);
  return (s > 0 ? '…' : '') + plain.slice(s, s + len) + (s + len < plain.length ? '…' : '');
}
