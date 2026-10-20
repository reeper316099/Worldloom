import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, q, type LkLink } from '../api';

interface LkEntry { id: string; title: string; library?: string; current: number | null; consumedUpTo: number | null; totalUnits: number | null }
export const useLorekeeper = () => useQuery({ queryKey: ['lk-config'], queryFn: () => api.get<{ enabled: boolean; baseUrl: string; hasToken: boolean }>('/integrations/lorekeeper') });

/** Link a source to a Lorekeeper entry so its reading/watching progress can feed spoiler progress. */
export function LorekeeperLink({ link, onChange }: { link?: LkLink; onChange: (l?: LkLink) => void }) {
  const cfg = useLorekeeper();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const res = useQuery({ queryKey: ['lk-search', text], enabled: open && text.trim().length > 1, retry: false, queryFn: () => api.get<LkEntry[]>(`/integrations/lorekeeper/search${q({ q: text })}`) });
  if (!cfg.data?.enabled && !link) return null;
  if (link) {
    return (
      <div className="row muted" style={{ fontSize: '.85rem', flexWrap: 'wrap', marginTop: 6 }}>
        <span>🔗 Lorekeeper: <b>{link.title ?? link.entryId}</b></span>
        <select aria-label="Progress field" style={{ width: 'auto' }} value={link.field} onChange={(e) => onChange({ ...link, field: e.target.value as LkLink['field'] })}>
          <option value="current">where I am (current)</option><option value="consumedUpTo">how far my recap goes</option>
        </select>
        <button className="btn ghost" onClick={() => onChange(undefined)}>Unlink</button>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      {!open ? <button className="btn ghost" onClick={() => setOpen(true)}>🔗 Link to Lorekeeper entry…</button> : (
        <div style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
          <input aria-label="Search Lorekeeper" autoFocus placeholder="Search your Lorekeeper library…" value={text} onChange={(e) => setText(e.target.value)} />
          {res.error && <div className="warn" role="alert">{(res.error as Error).message}</div>}
          {res.data?.map((e) => (
            <button key={e.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => { onChange({ app: 'lorekeeper', entryId: e.id, title: e.title, field: 'current' }); setOpen(false); setText(''); }}>
              {e.title} <span className="muted">· {e.library ?? ''} · at {e.current ?? '—'}{e.totalUnits ? ` / ${e.totalUnits}` : ''}</span>
            </button>
          ))}
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
