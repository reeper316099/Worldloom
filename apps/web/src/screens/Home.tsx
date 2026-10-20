import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { go } from '../router';
import { useWorlds } from '../hooks';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../store';

const TEMPLATES = {
  series: {
    label: 'Series lore (manhwa / anime / novel)',
    continuities: [{ id: 'wn', name: 'Web Novel', isPrimary: true }, { id: 'adaptation', name: 'Adaptation' }],
    sources: [
      { id: 'wn', name: 'Web Novel', kind: 'web_novel', continuityId: 'wn', units: { label: 'Chapter' } },
      { id: 'adaptation', name: 'Adaptation', kind: 'anime', continuityId: 'adaptation', units: { label: 'Episode' } },
    ],
  },
  campaign: {
    label: 'TTRPG campaign',
    continuities: [{ id: 'campaign', name: 'Campaign canon', isPrimary: true }],
    sources: [{ id: 'sessions', name: 'Sessions', kind: 'campaign', continuityId: 'campaign', units: { label: 'Session' } }],
  },
  blank: { label: 'Blank', continuities: undefined, sources: undefined },
} as const;

export function Home() {
  const { data, isLoading, error } = useWorlds();
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();
  const starters = useQuery({ queryKey: ['starters'], queryFn: () => api.get<Array<{ id: string; name: string; description: string; accent: string; pages: number }>>('/starter-worlds') });
  const install = async (id: string) => {
    try { const w = await api.post<{ slug: string }>(`/starter-worlds/${id}/install`); await qc.invalidateQueries(); go(`/w/${w.slug}`); }
    catch (e) { useApp.getState().toast((e as Error).message); }
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 24 }}>
        <div className="grow">
          <h1 className="title">Your worlds</h1>
          <div className="muted">One wiki per series or campaign. Everything is stored locally as Markdown and JSON.</div>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>＋ New world</button>
      </div>
      {error && <div className="card">Could not reach the local API: {(error as Error).message}</div>}
      {isLoading && <div className="muted">Loading…</div>}
      {data && data.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <h2 style={{ marginTop: 0 }}>Welcome to Worldloom</h2>
          <p className="muted">Build a spoiler-aware wiki for any fictional world. Open a demo world below, or start your own.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>Create my first world</button>
        </div>
      )}
      {starters.data && starters.data.length > 0 && (
        <>
          <h3 style={{ margin: '32px 0 12px' }}>Demo worlds</h3>
          <div className="grid">
            {starters.data.map((s) => (
              <div key={s.id} className="card">
                <strong>{s.name}</strong> <span className="muted">· {s.pages} pages</span>
                <div className="muted" style={{ margin: '6px 0 12px' }}>{s.description}</div>
                <button className="btn" onClick={() => void install(s.id)}>Open demo world</button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="grid">
        {data?.map((w) => (
          <a key={w.slug} className="card world-card" href={`#/w/${w.slug}`}>
            <div className="cover" style={{ background: `linear-gradient(135deg, ${w.accent}, var(--accent))` }} />
            <div className="body">
              <h3 style={{ margin: '0 0 4px' }}>{w.name}</h3>
              <div className="muted" style={{ minHeight: 40 }}>{w.description || 'No description'}</div>
              <div className="row muted" style={{ fontSize: '.8rem', margin: '10px 0 6px' }}>
                <span>{w.pageCount} pages</span><span className="grow" /><span>{w.completeness}% complete</span>
              </div>
              <div className="bar"><i style={{ width: `${w.completeness}%` }} /></div>
              <div className="muted" style={{ fontSize: '.75rem', marginTop: 8 }}>Edited {new Date(w.lastEdited).toLocaleDateString()}</div>
            </div>
          </a>
        ))}
      </div>
      {creating && <NewWorld close={() => setCreating(false)} />}
    </>
  );
}

function NewWorld({ close }: { close: () => void }) {
  const [name, setName] = useState('');
  const [tpl, setTpl] = useState<keyof typeof TEMPLATES>('series');
  const [accent, setAccent] = useState('#7c5cff');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const create = async () => {
    setBusy(true);
    try {
      const t = TEMPLATES[tpl];
      const w = await api.post<{ slug: string }>('/worlds', { name, accent, pack: tpl === 'campaign' ? 'ttrpg-campaign' : tpl === 'series' ? 'series-lore' : undefined, continuities: t.continuities, sources: t.sources });
      await qc.invalidateQueries();
      close();
      go(`/w/${w.slug}`);
    } catch (e) {
      useApp.getState().toast((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={close}>
      <form className="dialog" role="dialog" aria-label="New world" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
        <h3 style={{ margin: 0 }}>New world</h3>
        <label className="f">Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Series" /></label>
        <label className="f">Template
          <select value={tpl} onChange={(e) => setTpl(e.target.value as keyof typeof TEMPLATES)}>
            {Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="f">Accent color<input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ height: 36, padding: 2 }} /></label>
        <div className="row"><span className="grow" /><button type="button" className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy}>Create</button></div>
      </form>
    </div>
  );
}
