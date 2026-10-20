import { useQuery } from '@tanstack/react-query';
import { api, q, type PageHidden, type PageView } from '../api';
import { go, useRoute, wPath } from '../router';
import { useMode, useWorld } from '../hooks';

export interface Compare { a: PageView | PageHidden; b: PageView | PageHidden; infobox: Array<{ key: string; label: string; a: unknown; b: unknown; differs: boolean }> }
const fmt = (v: unknown) => (v === undefined ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

export function CompareScreen({ w, ref_ }: { w: string; ref_: string }) {
  const { data: world } = useWorld(w);
  const { mode } = useMode();
  const route = useRoute();
  const ids = world?.continuities.map((c) => c.id) ?? [];
  const a = route.query.get('a') ?? ids[0] ?? '';
  const b = route.query.get('b') ?? ids[1] ?? ids[0] ?? '';
  const res = useQuery({ queryKey: ['compare', w, ref_, a, b, mode], enabled: !!a && !!b, queryFn: () => api.get<Compare>(`/worlds/${w}/pages/${encodeURIComponent(ref_)}/compare${q({ mode, a, b })}`) });
  const name = (id: string) => world?.continuities.find((c) => c.id === id)?.name ?? id;
  const set = (k: 'a' | 'b', v: string) => go(`${wPath(w, 'p', ref_, 'compare')}?a=${k === 'a' ? v : a}&b=${k === 'b' ? v : b}`);
  const d = res.data;
  if (!world) return <div className="muted">Loading…</div>;
  if (world.continuities.length < 2) return <div className="card">This world has only one continuity. Add another under <a href={`#/w/${w}/canon`}>Canon</a>.</div>;
  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <a className="btn" href={`#/w/${w}/p/${ref_}`}>← Back</a>
        <h2 style={{ margin: 0 }} className="grow">{d && !d.a.hidden ? d.a.title : ref_} — compare continuities</h2>
      </div>
      {d?.a.hidden && <div className="card">You haven't reached this page yet.</div>}
      {d && !d.a.hidden && !d.b.hidden && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <table className="cmp"><thead><tr><th /><th><Select value={a} onChange={(v) => set('a', v)} world={world} /></th><th><Select value={b} onChange={(v) => set('b', v)} world={world} /></th></tr></thead>
              <tbody>
                {d.infobox.map((r) => <tr key={r.key} className={r.differs ? 'differs' : ''}><td className="muted">{r.label}</td><td>{fmt(r.a)}</td><td>{fmt(r.b)}</td></tr>)}
                {d.infobox.length === 0 && <tr><td colSpan={3} className="muted">No fields</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="compare-cols">
            {[d.a, d.b].map((v, i) => (
              <div className="card" key={i}>
                <h3 style={{ marginTop: 0 }}>{name(i === 0 ? a : b)}</h3>
                {!v.hidden && !v.appliesToSelected && <div className="callout">This page does not apply to this continuity.</div>}
                {!v.hidden && <article className="prose" dangerouslySetInnerHTML={{ __html: v.html }} />}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
function Select({ value, onChange, world }: { value: string; onChange: (v: string) => void; world: { continuities: Array<{ id: string; name: string }> } }) {
  return <select aria-label="Continuity" value={value} onChange={(e) => onChange(e.target.value)}>{world.continuities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
}
