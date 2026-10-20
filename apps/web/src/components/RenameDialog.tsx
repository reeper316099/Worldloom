import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useApp } from '../store';

export function RenameDialog({ w, id, title, close, onDone }: { w: string; id: string; title: string; close: () => void; onDone: (slug: string) => void }) {
  const [value, setValue] = useState(title);
  const [links, setLinks] = useState<'rewrite' | 'redirect' | 'none'>('rewrite');
  const qc = useQueryClient();
  const submit = async () => {
    try {
      const r = await api.post<{ txId?: string; changed: string[] }>(`/worlds/${w}/pages/${id}/rename`, { title: value, links });
      await qc.invalidateQueries();
      const page = await api.get<{ slug: string }>(`/worlds/${w}/pages/${id}?mode=author`);
      close();
      onDone(page.slug);
      if (r.txId) {
        useApp.getState().toast(`Renamed · ${r.changed.length - 1} linking page(s) updated`, {
          label: 'Undo',
          run: async () => { await api.post(`/worlds/${w}/tx/${r.txId}/undo`); await qc.invalidateQueries(); },
        });
      }
    } catch (e) {
      useApp.getState().toast((e as Error).message);
    }
  };
  return (
    <div className="overlay" onMouseDown={close}>
      <form className="dialog" role="dialog" aria-label="Rename page" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h3 style={{ margin: 0 }}>Rename page</h3>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        <label className="f">Inbound links
          <select value={links} onChange={(e) => setLinks(e.target.value as typeof links)}>
            <option value="rewrite">Update all links to the new title</option>
            <option value="redirect">Leave a redirect (keep old title as alias)</option>
            <option value="none">Do nothing (links become red)</option>
          </select>
        </label>
        <div className="row"><span className="grow" /><button type="button" className="btn ghost" onClick={close}>Cancel</button><button className="btn primary">Rename</button></div>
      </form>
    </div>
  );
}
