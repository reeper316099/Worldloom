import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, q, type Hit } from '../api';
import { go, wPath } from '../router';
import { useMode, useWorld } from '../hooks';
import { useApp } from '../store';
import { PagePicker } from '../components/PagePicker';
import { download } from './GraphScreen';

interface Item { title: string; slug: string; type: string }
interface BoardT { id: string; name: string; tiers: Array<{ id: string; label: string; color: string }>; placements: Record<string, string[]>; pool: string[]; context: { arcId?: string; continuityId?: string; note: string }; items: Record<string, Item> }
const DEFAULT_TIERS = [['S', '#ff6b81'], ['A', '#f5b84a'], ['B', '#f0e86a'], ['C', '#3ddc97'], ['D', '#38bdf8'], ['F', '#9aa0b8']].map(([label, color]) => ({ id: label!.toLowerCase(), label: label!, color: color! }));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';

export function BoardsScreen({ w, id }: { w: string; id?: string }) {
  return id ? <BoardEditor w={w} id={id} /> : <BoardList w={w} />;
}

function BoardList({ w }: { w: string }) {
  const { mode } = useMode();
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['boards', w, mode], queryFn: () => api.get<Array<{ id: string; name: string; items: number; updatedAt: string; context: { note?: string } }>>(`/worlds/${w}/boards${q({ mode })}`) });
  const create = async () => {
    let bid = slug(name); const taken = new Set(data?.map((b) => b.id)); for (let i = 2; taken.has(bid); i++) bid = `${slug(name)}-${i}`;
    await api.put(`/worlds/${w}/boards/${bid}${q({ mode })}`, { name, tiers: DEFAULT_TIERS, placements: {}, pool: [], context: { note: '' } });
    await qc.invalidateQueries();
    go(wPath(w, 'boards', bid));
  };
  return (
    <>
      <h1 className="title" style={{ fontSize: '1.6rem' }}>Tier lists</h1>
      <form className="row" style={{ maxWidth: 520, marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
        <input aria-label="New tier list name" placeholder="e.g. Strongest at the end of Arc 3" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" disabled={!name.trim()}>Create</button>
      </form>
      {data?.length === 0 && <div className="card muted">No tier lists yet.</div>}
      <div className="grid">{data?.map((b) => <a key={b.id} className="card" href={`#/w/${w}/boards/${b.id}`}><strong>{b.name}</strong><div className="muted">{b.items} items{b.context.note ? ` · ${b.context.note}` : ''}</div></a>)}</div>
    </>
  );
}

function BoardEditor({ w, id }: { w: string; id: string }) {
  const { mode } = useMode();
  const { data: world } = useWorld(w);
  const qc = useQueryClient();
  const server = useQuery({ queryKey: ['board', w, id, mode], staleTime: Infinity, queryFn: () => api.get<BoardT>(`/worlds/${w}/boards/${id}${q({ mode })}`) });
  const [b, setB] = useState<BoardT | null>(null);
  const dirty = useRef(false);
  useEffect(() => { if (server.data && !dirty.current) setB(structuredClone(server.data)); }, [server.data]);
  useEffect(() => {
    if (!b || !dirty.current) return;
    const t = setTimeout(async () => {
      try { await api.put(`/worlds/${w}/boards/${id}${q({ mode })}`, { name: b.name, tiers: b.tiers, placements: b.placements, pool: b.pool, context: b.context }); dirty.current = false; void qc.invalidateQueries({ queryKey: ['boards'] }); }
      catch (e) { useApp.getState().toast(`Save failed: ${(e as Error).message}`); }
    }, 800);
    return () => clearTimeout(t);
  }, [b, w, id, mode, qc]);
  if (server.error) return <div className="card">Tier list not found. <a href={`#/w/${w}/boards`}>Back</a></div>;
  if (!b) return <div className="muted">Loading…</div>;
  const edit = (fn: (x: BoardT) => void) => { dirty.current = true; setB((cur) => { const n = structuredClone(cur!); fn(n); return n; }); };
  const place = (pid: string, zone: string) => edit((x) => {
    x.pool = x.pool.filter((i) => i !== pid);
    for (const k of Object.keys(x.placements)) x.placements[k] = x.placements[k]!.filter((i) => i !== pid);
    if (zone === 'pool') x.pool.push(pid); else (x.placements[zone] ??= []).push(pid);
  });
  const add = (h: Hit) => edit((x) => { if (!x.items[h.id]) { x.items[h.id] = { title: h.title, slug: h.slug, type: h.type }; x.pool.push(h.id); } });
  const all = [...b.pool, ...Object.values(b.placements).flat()];

  const exportPng = () => {
    const W = 900, rowH = 60, head = 56;
    const c = document.createElement('canvas'); c.width = W * 2; c.height = (head + b.tiers.length * rowH + 10) * 2;
    const g = c.getContext('2d')!; g.scale(2, 2);
    g.fillStyle = '#151722'; g.fillRect(0, 0, W, c.height); g.fillStyle = '#e8e9f2'; g.font = 'bold 22px sans-serif'; g.fillText(b.name, 16, 34);
    b.tiers.forEach((t, i) => {
      const y = head + i * rowH;
      g.fillStyle = t.color; g.fillRect(8, y, 90, rowH - 6); g.fillStyle = '#111'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText(t.label, 53, y + 36); g.textAlign = 'left';
      g.fillStyle = '#1d2030'; g.fillRect(98, y, W - 106, rowH - 6);
      let x = 108; g.font = '14px sans-serif';
      for (const pid of b.placements[t.id] ?? []) { const name = b.items[pid]?.title ?? ''; const tw = g.measureText(name).width + 18; g.fillStyle = '#2a2e44'; g.fillRect(x, y + 12, tw, 28); g.fillStyle = '#e8e9f2'; g.fillText(name, x + 9, y + 31); x += tw + 8; }
    });
    c.toBlob((blob) => blob && download(blob, `${id}.png`));
  };
  const Chip = ({ pid }: { pid: string }) => (
    <span className="entry drag" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', pid)}>
      <a href={`#/w/${w}/p/${b.items[pid]?.slug}`} draggable={false}>{b.items[pid]?.title}</a>
      <span role="button" aria-label={`Remove ${b.items[pid]?.title}`} className="muted" onClick={() => edit((x) => { x.pool = x.pool.filter((i) => i !== pid); for (const k of Object.keys(x.placements)) x.placements[k] = x.placements[k]!.filter((i) => i !== pid); })}>✕</span>
    </span>
  );
  const Zone = ({ zone, children, style }: { zone: string; children: React.ReactNode; style?: React.CSSProperties }) => {
    const [over, setOver] = useState(false);
    return <div className={`dropzone ${over ? 'over' : ''}`} style={style} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const pid = e.dataTransfer.getData('text/plain'); if (pid) place(pid, zone); }}>{children}</div>;
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <a className="btn" href={`#/w/${w}/boards`}>← All</a>
        <input aria-label="Name" style={{ maxWidth: 360, fontWeight: 700 }} value={b.name} onChange={(e) => edit((x) => { x.name = e.target.value; })} />
        {world && world.arcs.length > 0 && <select aria-label="Arc context" style={{ width: 'auto' }} value={b.context.arcId ?? ''} onChange={(e) => edit((x) => { x.context.arcId = e.target.value || undefined; })}><option value="">No arc context</option>{world.arcs.map((a) => <option key={a.id} value={a.id}>As of: {a.name}</option>)}</select>}
        <input aria-label="Note" placeholder="Context note" style={{ width: 220 }} value={b.context.note} onChange={(e) => edit((x) => { x.context.note = e.target.value; })} />
        <span className="grow" />
        <button className="btn" onClick={exportPng}>Export PNG</button>
        <button className="btn danger" onClick={async () => { if (confirm('Delete this tier list?')) { await api.del(`/worlds/${w}/boards/${id}`); await qc.invalidateQueries(); go(wPath(w, 'boards')); } }}>Delete</button>
      </div>
      <div className="ladder">
        {b.tiers.map((t, i) => (
          <div className="tier" key={t.id}>
            <b style={{ background: t.color, flexDirection: 'column', gap: 6 }}>
              <input aria-label="Tier label" value={t.label} style={{ width: 80, textAlign: 'center', fontWeight: 700 }} onChange={(e) => edit((x) => { x.tiers[i]!.label = e.target.value; })} />
              <input aria-label="Tier color" type="color" value={t.color} style={{ width: 40, height: 22, padding: 0 }} onChange={(e) => edit((x) => { x.tiers[i]!.color = e.target.value; })} />
            </b>
            <Zone zone={t.id}>{(b.placements[t.id] ?? []).map((pid) => <Chip key={pid} pid={pid} />)}
              {b.tiers.length > 1 && <button className="btn ghost" aria-label={`Delete tier ${t.label}`} style={{ marginLeft: 'auto' }} onClick={() => edit((x) => { x.pool.push(...(x.placements[t.id] ?? [])); delete x.placements[t.id]; x.tiers.splice(i, 1); })}>✕</button>}
            </Zone>
          </div>
        ))}
        <button className="btn" onClick={() => edit((x) => { x.tiers.push({ id: `t${Date.now().toString(36)}`, label: 'New', color: '#7c5cff' }); })}>＋ Add tier</button>
      </div>
      <h3>Unranked ({all.length ? b.pool.length : 0})</h3>
      <div className="row" style={{ marginBottom: 8 }}><div style={{ width: 280 }}><PagePicker w={w} placeholder="Add a page to rank…" onPick={add} /></div></div>
      <Zone zone="pool" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 56, padding: 8, border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
        {b.pool.map((pid) => <Chip key={pid} pid={pid} />)}{b.pool.length === 0 && <span className="muted">Drag items here or add pages above.</span>}
      </Zone>
    </>
  );
}
