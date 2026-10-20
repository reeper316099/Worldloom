import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, q, type Hit } from '../api';
import { useMode, useWorld } from '../hooks';
import { PagePicker } from '../components/PagePicker';

interface Ev { id: string; title: string; summary: string; order: number; label?: string; trackId: string | null; arcId?: string; pages: Array<{ id: string; title: string; slug: string }> }
interface TL { tracks: Array<{ id: string; name: string; color: string }>; arcs: Array<{ id: string; name: string; from: number; to: number }>; events: Ev[] }
const LANE = 110, TOP = 34, LEFT = 120;

/** Horizontal zoomable/pannable timeline with one lane per continuity (+ a shared lane) and arcs as bands. */
export function TimelineScreen({ w }: { w: string }) {
  const { mode, continuity } = useMode();
  const { data: world } = useWorld(w);
  const [arc, setArc] = useState('');
  const [page, setPage] = useState<Hit | null>(null);
  const [view, setView] = useState({ k: 1, tx: 0 });
  const [selId, setSelId] = useState<string | null>(null);
  const drag = useRef<{ x: number; tx: number } | null>(null);
  const { data } = useQuery({ queryKey: ['timeline', w, mode, continuity, arc, page?.id], queryFn: () => api.get<TL>(`/worlds/${w}/timeline${q({ mode, cont: continuity, arc, page: page?.id })}`) });

  const layout = useMemo(() => {
    if (!data) return null;
    const lanes = [{ id: null as string | null, name: 'Shared', color: '#9aa0b8' }, ...data.tracks];
    const orders = data.events.map((e) => e.order);
    const min = Math.min(0, ...orders), max = Math.max(1, ...orders);
    return { lanes, min, max, width: 1000 };
  }, [data]);
  if (!data || !layout) return <div className="muted">Loading…</div>;
  const px = (order: number) => LEFT + ((order - layout.min) / (layout.max - layout.min || 1)) * layout.width * view.k + view.tx;
  const laneIdx = (e: Ev) => Math.max(0, layout.lanes.findIndex((l) => l.id === e.trackId));
  const height = TOP + layout.lanes.length * LANE + 10;
  const sel = data.events.find((e) => e.id === selId);
  const ticks = Array.from({ length: Math.floor(layout.max - layout.min) + 1 }, (_, i) => layout.min + i).filter((t) => Math.abs(layout.max - layout.min) < 40 * view.k);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const k = Math.min(40, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const worldX = (mx - LEFT - view.tx) / view.k;
    setView({ k, tx: mx - LEFT - worldX * k });
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <h1 className="title grow" style={{ fontSize: '1.6rem' }}>Timeline</h1>
        <div style={{ width: 220 }}><PagePicker w={w} placeholder="Filter by character / faction…" onPick={setPage} /></div>
        {page && <span className="pill" onClick={() => setPage(null)}>✕ {page.title}</span>}
        {world && <select aria-label="Arc" style={{ width: 'auto' }} value={arc} onChange={(e) => setArc(e.target.value)}><option value="">All arcs</option>{[...world.arcs].sort((a, b) => a.order - b.order).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        <button className="btn" onClick={() => setView({ k: 1, tx: 0 })}>Reset view</button>
      </div>
      {data.events.length === 0 && <div className="card muted">No events to show at your current progress and filters.</div>}
      <div className="tl">
        <svg width="100%" height={height} role="group" aria-label="Timeline" onWheel={onWheel}
          onPointerDown={(e) => { drag.current = { x: e.clientX, tx: view.tx }; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => drag.current && setView({ ...view, tx: drag.current.tx + e.clientX - drag.current.x })}
          onPointerUp={() => { drag.current = null; }}>
          {layout.lanes.map((l, i) => (
            <g key={String(l.id)}>
              <rect x={0} y={TOP + i * LANE} width="100%" height={LANE} fill={i % 2 ? 'transparent' : 'rgb(128 128 160 / .06)'} />
              <text x={10} y={TOP + i * LANE + 22} className="lane-label" style={{ fill: l.color }}>{l.name}</text>
              <line x1={LEFT} x2="100%" y1={TOP + i * LANE + LANE / 2} y2={TOP + i * LANE + LANE / 2} stroke="var(--border)" />
            </g>
          ))}
          {data.arcs.map((a) => (
            <g key={a.id}>
              <rect x={px(a.from) - 14} y={TOP - 8} width={Math.max(28, px(a.to) - px(a.from) + 28)} height={height - TOP} fill="var(--primary)" opacity={0.07} rx={8} />
              <text x={px(a.from) - 8} y={TOP - 14} style={{ fill: 'var(--primary)', fontWeight: 600 }}>{a.name}</text>
            </g>
          ))}
          {ticks.map((t) => <text key={t} x={px(t)} y={height - 2} textAnchor="middle" style={{ fill: 'var(--text-muted)', fontSize: 10 }}>{t}</text>)}
          {data.events.map((e, i) => {
            const y = TOP + laneIdx(e) * LANE + LANE / 2;
            const dy = (i % 2 ? 1 : -1) * 22;
            const color = layout.lanes[laneIdx(e)]?.color ?? '#9aa0b8';
            return (
              <g key={e.id} className="ev" tabIndex={0} role="button" aria-label={e.title} onPointerDown={(ev) => ev.stopPropagation()} onClick={() => setSelId(e.id)} onKeyDown={(ev) => ev.key === 'Enter' && setSelId(e.id)}>
                <line x1={px(e.order)} x2={px(e.order)} y1={y} y2={y + dy} stroke={color} opacity={0.5} />
                <circle cx={px(e.order)} cy={y} r={sel?.id === e.id ? 9 : 7} fill={color} />
                <text x={px(e.order)} y={y + dy + (dy < 0 ? -4 : 12)} textAnchor="middle">{e.title.length > 26 ? e.title.slice(0, 25) + '…' : e.title}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {sel && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><h3 style={{ margin: 0 }} className="grow">{sel.title}</h3>{sel.label && <span className="badge">{sel.label}</span>}<button className="btn ghost" onClick={() => setSelId(null)}>✕</button></div>
          <p>{sel.summary}</p>
          <div className="chips">{sel.pages.map((p) => <a key={p.id} className="chip" href={`#/w/${w}/p/${p.slug}`}>{p.title}</a>)}</div>
        </div>
      )}
    </>
  );
}
