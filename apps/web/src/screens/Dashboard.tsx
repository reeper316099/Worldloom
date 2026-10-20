import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, q, type World } from '../api';
import { go, wPath } from '../router';
import { useList, useMode, useTypes, useWorld } from '../hooks';

export function Dashboard({ w }: { w: string }) {
  const { data: world, error } = useWorld(w);
  const types = useTypes(w);
  const recent = useList(w, { sort: 'updated', order: 'desc', limit: 8 });
  const all = useList(w, { limit: 1000 });
  const { mode } = useMode();
  const health = useQuery({ queryKey: ['health', w], queryFn: () => api.get<{ stubs: unknown[]; redLinks: unknown[]; unsourcedClaims: unknown[]; orphans: unknown[]; completeness: number; total: number }>(`/worlds/${w}/health-report${q({ mode: 'author' })}`) });
  const [text, setText] = useState('');
  if (error) return <div className="card">World not found. <a href="#/">Back to worlds</a></div>;
  if (!world) return <div className="muted">Loading…</div>;
  const random = () => {
    const vis = (all.data?.items ?? []).filter((i) => !i.hidden);
    const p = vis[Math.floor(Math.random() * vis.length)];
    if (p) go(wPath(w, 'p', p.slug));
  };
  const counts = new Map<string, number>();
  for (const i of all.data?.items ?? []) if (i.type) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);

  return (
    <>
      <div className="hero">
        <h1 className="title">{world.name}</h1>
        <div className="muted">{world.description}</div>
        <form className="row" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) go(wPath(w, 'search') + `?q=${encodeURIComponent(text)}`); }}>
          <input aria-label="Search this world" placeholder="Search pages…  (type:character tag:villain)" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn">Search</button>
          <button type="button" className="btn" onClick={random}>🎲 Random</button>
        </form>
      </div>
      <div className="cols">
        <div style={{ display: 'grid', gap: 16 }}>
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Recent edits</h3>
            {recent.data?.items.length === 0 && <div className="muted">No pages yet — create one from the browser below.</div>}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {recent.data?.items.map((p) => (
                <li key={p.id} className="row">
                  <a href={`#/w/${w}/p/${p.slug}`} className={p.hidden ? 'muted' : ''}>{p.title}</a>
                  <span className="grow" /><span className="muted" style={{ fontSize: '.78rem' }}>{p.type}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Browse by type</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(190px,1fr))' }}>
              {types.data?.map((t) => (
                <div key={t.slug} className="card hover">
                  <strong>{t.name}</strong> <span className="muted">· {counts.get(t.slug) ?? 0}</span>
                  <div className="row" style={{ marginTop: 8 }}>
                    <a className="btn" href={`#/w/${w}/search?q=${encodeURIComponent('type:' + t.slug)}`}>Browse</a>
                    <a className="btn" href={`#/w/${w}/new?type=${t.slug}`}>＋ New</a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="rail" style={{ display: 'grid', gap: 16 }}>
          <ProgressWidget w={w} world={world} mode={mode} />
          <section className="card">
            <h4>Wiki health</h4>
            {health.data ? (
              <ul>
                <li>{health.data.total} pages · {health.data.completeness}% complete</li>
                <li>{health.data.stubs.length} stubs</li><li>{health.data.redLinks.length} red links</li>
                <li>{health.data.unsourcedClaims.length} unsourced claims</li><li>{health.data.orphans.length} orphans</li>
              </ul>
            ) : <div className="muted">…</div>}
          </section>
        </aside>
      </div>
    </>
  );
}

function ProgressWidget({ w, world, mode }: { w: string; world: World; mode: string }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (b: object) => api.put(`/worlds/${w}/progress`, b),
    onSuccess: () => qc.invalidateQueries(),
  });
  const p = world.progress;
  return (
    <section className="card">
      <h4>My progress</h4>
      <div className="muted" style={{ fontSize: '.8rem', marginBottom: 8 }}>
        {mode === 'reader' ? 'Reader mode: content beyond this is hidden.' : 'Author mode shows everything; switch to reader mode to apply this.'}
      </div>
      {world.sources.length === 0 && <div className="muted">Add sources to track progress.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {world.sources.map((s) => (
          <label className="f" key={s.id}>{s.name} · {s.units.label}
            <input type="number" min={0} placeholder="not set (everything gated is hidden)" defaultValue={p.sources[s.id] ?? ''}
              onBlur={(e) => e.target.value !== '' && save.mutate({ sources: { [s.id]: Number(e.target.value) } })} />
          </label>
        ))}
        {world.arcs.length > 0 && (
          <label className="f">Finished arc
            <select value={p.arcCheckpoint ?? ''} onChange={(e) => save.mutate({ arcCheckpoint: e.target.value || undefined })}>
              <option value="">—</option>
              {[...world.arcs].sort((a, b) => a.order - b.order).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={p.showAll} onChange={(e) => save.mutate({ showAll: e.target.checked })} /> Show all spoilers</label>
      </div>
    </section>
  );
}
