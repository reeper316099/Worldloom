import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, q, type PageView, type PageHidden } from '../api';
import { go, wPath } from '../router';
import { useMode, useWorld } from '../hooks';
import { useApp } from '../store';
import { RenameDialog } from '../components/RenameDialog';

export function PageScreen({ w, ref_ }: { w: string; ref_: string }) {
  const { mode, continuity } = useMode();
  const qc = useQueryClient();
  const { data: world } = useWorld(w);
  const [renaming, setRenaming] = useState(false);
  const page = useQuery({
    queryKey: ['page', w, ref_, mode, continuity],
    queryFn: () => api.get<PageView | PageHidden>(`/worlds/${w}/pages/${encodeURIComponent(ref_)}${q({ mode, cont: continuity })}`),
  });
  const id = page.data?.id;
  const back = useQuery({ queryKey: ['back', w, id, mode], enabled: !!id && !page.data?.hidden, queryFn: () => api.get<Array<{ id: string; title: string; slug: string; type: string }>>(`/worlds/${w}/backlinks/${id}${q({ mode })}`) });
  const hist = useQuery({ queryKey: ['hist', w, id], enabled: !!id && mode === 'author' && !page.data?.hidden, queryFn: () => api.get<Array<{ ts: string; summary: string; name?: string }>>(`/worlds/${w}/history/${id}?mode=author`) });
  const reveal = useMutation({
    mutationFn: (key: string) => api.post(`/worlds/${w}/progress/reveal`, { key }),
    onSuccess: (_d, key) => {
      void qc.invalidateQueries();
      useApp.getState().toast('Revealed', { label: 'Undo', run: () => api.post(`/worlds/${w}/progress/reveal`, { key, undo: true }).then(() => qc.invalidateQueries()) });
    },
  });

  if (page.error) {
    return (
      <div className="card"><h3>Page not found</h3>
        <a className="btn primary" href={`#/w/${w}/new?title=${encodeURIComponent(ref_)}`}>Create “{ref_}”</a></div>
    );
  }
  const d = page.data;
  if (!d) return <div className="muted">Loading…</div>;
  if (d.hidden) {
    return (
      <div className="hero" style={{ textAlign: 'center' }}>
        <h1 className="title muted">{d.title}</h1>
        <p>{d.message}</p>
        {mode === 'reader' && <button className="btn" onClick={() => reveal.mutate(`page:${d.id}`)}>Reveal this page anyway</button>}
      </div>
    );
  }
  const onProseClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.spoiler-hidden') as HTMLElement | null;
    if (el?.dataset.key) reveal.mutate(`${d.id}:${el.dataset.key}`);
  };
  return (
    <>
      <div className="hero">
        <div className="row">
          <span className="badge">{d.typeName}</span><span className={`badge ${d.status}`}>{d.status}</span>
          {d.dmOnly && <span className="badge">DM only</span>}
          <span className="grow" />
          {mode === 'author' && <button className="btn ghost" onClick={() => setRenaming(true)}>Rename</button>}
          {world && world.continuities.length > 1 && <a className="btn ghost" href={`#/w/${w}/p/${d.slug}/compare`}>⇄ Compare continuities</a>}
          <a className="btn" href={`#/w/${w}/p/${d.slug}/edit`}>✎ Edit</a>
        </div>
        <h1 className="title">{d.title}</h1>
        {d.aliases.length > 0 && <div className="muted">Also known as {d.aliases.join(', ')}</div>}
        {world && continuityLabel(world, continuity)}
        {!d.appliesToSelected && <div className="callout warn" style={{ marginTop: 10 }}>This page is not part of the selected continuity; showing it for reference.</div>}
      </div>
      <div className="cols">
        <article className="prose" onClick={onProseClick} dangerouslySetInnerHTML={{ __html: d.html }} />
        <aside className="rail">
          <div className="sticky">
            <Infobox rows={d.infobox.rows} title={d.title} />
            <div className="card"><h4>What links here</h4>
              {back.data?.length ? <ul>{back.data.map((b) => <li key={b.id}><a href={`#/w/${w}/p/${b.slug}`}>{b.title}</a></li>)}</ul> : <div className="muted">Nothing yet</div>}
            </div>
            {d.claims.length > 0 && (
              <div className="card claims"><h4>Claims</h4>
                <ul>{d.claims.map((c, i) => <li key={i}><span className={`claim-dot ${c.kind}`} /><span><b>{c.kind}</b> {c.cited ? '' : <span className="warn" title="No citation inside this claim">unsourced · </span>}{c.text.slice(0, 80)}</span></li>)}</ul>
              </div>
            )}
            <div className="card"><h4>Categories & tags</h4>
              <div className="row" style={{ flexWrap: 'wrap' }}>{[...d.categories, ...d.tags.map((t) => '#' + t)].map((c) => <span className="pill" key={c}>{c}</span>)}</div>
            </div>
            {mode === 'author' && (
              <div className="card"><h4>History</h4>
                {hist.data?.slice(0, 5).map((h) => <div key={h.ts} className="muted" style={{ fontSize: '.8rem' }}>{new Date(h.ts).toLocaleString()} — {h.name ?? h.summary}</div>)}
              </div>
            )}
          </div>
        </aside>
      </div>
      {renaming && <RenameDialog w={w} id={d.id} title={d.title} close={() => setRenaming(false)} onDone={(slug) => go(wPath(w, 'p', slug))} />}
    </>
  );
}

function continuityLabel(world: { continuities: Array<{ id: string; name: string }> }, c?: string) {
  const name = world.continuities.find((x) => x.id === c)?.name;
  return name ? <div className="pill" style={{ display: 'inline-block', marginTop: 8 }}>Viewing: {name}</div> : null;
}

function Infobox({ rows, title }: { rows: PageView['infobox']['rows']; title: string }) {
  return (
    <div className="infobox" style={{ marginBottom: 16 }}>
      <div className="infobox-title">{title}</div>
      {rows.length === 0 && <div className="infobox-row muted">No fields yet</div>}
      {rows.map((r) => (
        <div className={`infobox-row ${r.hidden ? 'gated' : ''}`} key={r.key}>
          <span className="k">{r.label}</span><span className="v">{Array.isArray(r.value) ? r.value.join(', ') : String(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
