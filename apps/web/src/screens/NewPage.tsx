import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { go, useRoute, wPath } from '../router';
import { useTypes } from '../hooks';
import { useApp } from '../store';

export function NewPage({ w, title: initial }: { w: string; title: string }) {
  const types = useTypes(w);
  const route = useRoute();
  const [title, setTitle] = useState(initial);
  const [type, setType] = useState(route.query.get('type') ?? '');
  const qc = useQueryClient();
  const chosen = type || types.data?.[0]?.slug || '';
  const create = async () => {
    try {
      const p = await api.post<{ slug: string }>(`/worlds/${w}/pages?template=1`, { type: chosen, title: title.trim() });
      await qc.invalidateQueries();
      go(wPath(w, 'p', p.slug, 'edit'));
    } catch (e) {
      useApp.getState().toast((e as Error).message);
    }
  };
  return (
    <form className="card" style={{ maxWidth: 480, display: 'grid', gap: 12 }} onSubmit={(e) => { e.preventDefault(); if (title.trim()) void create(); }}>
      <h2 style={{ margin: 0 }}>New page</h2>
      <label className="f">Title<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="f">Type<select value={chosen} onChange={(e) => setType(e.target.value)}>{types.data?.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select></label>
      <div className="row"><button className="btn primary" disabled={!title.trim()}>Create from template</button></div>
    </form>
  );
}
