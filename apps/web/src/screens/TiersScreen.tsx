import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, q } from '../api';
import { useMode, useWorld } from '../hooks';

interface Ladder { system: { id: string; name: string }; tiers: Array<{ id: string; name: string; order: number; color?: string; description: string; entries: Array<{ id: string; title: string; slug: string; type: string }> }> }

export function TiersScreen({ w }: { w: string }) {
  const { mode, continuity } = useMode();
  const { data: world } = useWorld(w);
  const systems = useQuery({ queryKey: ['tiers', w, mode], queryFn: () => api.get<Array<{ id: string; name: string }>>(`/worlds/${w}/tiers${q({ mode })}`) });
  const [sys, setSys] = useState('');
  const [arc, setArc] = useState('');
  const id = sys || systems.data?.[0]?.id;
  const ladder = useQuery({ queryKey: ['ladder', w, id, mode, continuity, arc], enabled: !!id, queryFn: () => api.get<Ladder>(`/worlds/${w}/tiers/${id}/ladder${q({ mode, cont: continuity, arc })}`) });
  return (
    <>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="title grow" style={{ fontSize: '1.6rem' }}>Power tiers</h1>
        {systems.data && systems.data.length > 1 && <select aria-label="Tier system" style={{ width: 'auto' }} value={id} onChange={(e) => setSys(e.target.value)}>{systems.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {world && world.arcs.length > 0 && <select aria-label="As of arc" style={{ width: 'auto' }} value={arc} onChange={(e) => setArc(e.target.value)}><option value="">Current</option>{[...world.arcs].sort((a, b) => a.order - b.order).map((a) => <option key={a.id} value={a.id}>As of: {a.name}</option>)}</select>}
      </div>
      {systems.data?.length === 0 && <div className="card muted">This world has no tier systems yet (or none you've reached).</div>}
      <div className="ladder">
        {[...(ladder.data?.tiers ?? [])].reverse().map((t) => (
          <div className="tier" key={t.id}>
            <b style={{ background: t.color ?? '#9aa0b8' }} title={t.description}>{t.name}</b>
            <div>{t.entries.length === 0 && <span className="muted" style={{ fontSize: '.8rem' }}>—</span>}{t.entries.map((e) => <a key={e.id} className="entry" href={`#/w/${w}/p/${e.slug}`}>{e.title}<span className="muted" style={{ fontSize: '.7rem' }}>{e.type}</span></a>)}</div>
          </div>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '.8rem' }}>Placements come from each page's tier field (per continuity, with optional reveal gates and arc history). Choose an arc to see where everyone stood then.</p>
    </>
  );
}
