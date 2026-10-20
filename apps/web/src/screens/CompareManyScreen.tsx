import { useQuery } from '@tanstack/react-query';
import { api, q, type Hit } from '../api';
import { go, useRoute, wPath } from '../router';
import { useMode } from '../hooks';
import { PagePicker } from '../components/PagePicker';

interface CM {
  pages: Array<{ id: string; title: string; slug: string; type?: string; hidden: boolean }>;
  rows: Array<{ key: string; label: string; values: Record<string, unknown>; differs: boolean }>;
  sharedNeighbors: Array<{ id: string; title: string; slug: string }>;
  byField: Record<string, { label: string; shared: string[]; unique: Record<string, string[]> }>;
  tiers: Array<{ systemId: string; name: string; placements: Record<string, string> }>;
}
const fmt = (v: unknown) => (v === undefined ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

/** Compare 2–5 pages: aligned fields, tier positions, shared relations and per-field diffs. */
export function CompareManyScreen({ w }: { w: string }) {
  const { mode, continuity } = useMode();
  const route = useRoute();
  const ids = (route.query.get('ids') ?? '').split(',').filter(Boolean);
  const { data } = useQuery({ queryKey: ['cmp', w, ids.join(','), mode, continuity], enabled: ids.length > 0, queryFn: () => api.get<CM>(`/worlds/${w}/compare${q({ mode, cont: continuity, ids: ids.join(',') })}`) });
  const set = (next: string[]) => go(`${wPath(w, 'compare')}?ids=${next.join(',')}`);
  const add = (h: Hit) => ids.length < 5 && !ids.includes(h.id) && set([...ids, h.id]);
  const cols = data?.pages.filter((p) => !p.hidden) ?? [];
  return (
    <>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="title grow" style={{ fontSize: '1.6rem' }}>Compare</h1>
        <div style={{ width: 260 }}>{ids.length < 5 && <PagePicker w={w} placeholder={ids.length ? 'Add another (max 5)…' : 'Pick pages to compare…'} onPick={add} />}</div>
      </div>
      {ids.length < 2 && <div className="card muted">Pick two to five pages. Switch continuity in the top bar to compare canon versions.</div>}
      {data && (
        <>
          <div className="chips" style={{ marginBottom: 12 }}>{data.pages.map((p) => <span key={p.id} className="chip">{p.hidden ? <span className="muted">{p.title} (not reached yet)</span> : <a href={`#/w/${w}/p/${p.slug}`}>{p.title}</a>}<span role="button" aria-label={`Remove ${p.title}`} style={{ marginLeft: 8 }} onClick={() => set(ids.filter((i) => i !== p.id))}>✕</span></span>)}</div>
          {cols.length > 0 && (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="cmp">
                <thead><tr><th />{cols.map((c) => <th key={c.id}>{c.title}</th>)}</tr></thead>
                <tbody>
                  {data.tiers.map((t) => <tr key={t.systemId} className={new Set(Object.values(t.placements)).size > 1 ? 'differs' : ''}><td className="muted">{t.name}</td>{cols.map((c) => <td key={c.id}>{t.placements[c.id] ?? '—'}</td>)}</tr>)}
                  {data.rows.map((r) => <tr key={r.key} className={r.differs ? 'differs' : ''}><td className="muted">{r.label}</td>{cols.map((c) => <td key={c.id}>{fmt(r.values[c.id])}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}
          {cols.length > 1 && (
            <div className="grid" style={{ marginTop: 16 }}>
              <div className="card"><h4 style={{ margin: '0 0 8px' }}>Shared connections</h4>{data.sharedNeighbors.length ? <div className="chips">{data.sharedNeighbors.map((n) => <a key={n.id} className="chip" href={`#/w/${w}/p/${n.slug}`}>{n.title}</a>)}</div> : <span className="muted">None</span>}</div>
              {Object.entries(data.byField).map(([k, f]) => (
                <div className="card" key={k}><h4 style={{ margin: '0 0 8px' }}>{f.label}</h4>
                  {f.shared.length > 0 && <div style={{ marginBottom: 6 }}><b>Shared:</b> {f.shared.join(', ')}</div>}
                  {cols.map((c) => (f.unique[c.id]?.length ? <div key={c.id} className="muted"><b>Only {c.title}:</b> {f.unique[c.id]!.join(', ')}</div> : null))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
