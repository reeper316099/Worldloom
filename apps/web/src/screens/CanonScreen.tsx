import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type ArcT, type Continuity, type SourceT } from '../api';
import { useApp } from '../store';
import { useWorld } from '../hooks';
import { LorekeeperLink } from '../components/LorekeeperLink';

const KINDS = ['web_novel', 'light_novel', 'manga', 'manhwa', 'manhua', 'anime', 'game', 'campaign', 'video', 'wiki', 'other'];
const UNITS = ['Chapter', 'Episode', 'Volume', 'Session'];
type Arc = ArcT & { ranges: Record<string, { from: number; to: number }>; summary: string };
const idFrom = (name: string, taken: string[]) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  let id = base; for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
};

function useSection<T>(w: string, key: 'continuities' | 'sources' | 'arcs', initial: T[] | undefined) {
  const qc = useQueryClient();
  const [items, setItems] = useState<T[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (initial && !dirty) setItems(structuredClone(initial)); }, [initial, dirty]);
  const change = (fn: (x: T[]) => void) => { setItems((cur) => { const n = structuredClone(cur); fn(n); return n; }); setDirty(true); };
  const save = async () => {
    try {
      await api.put(`/worlds/${w}/${key}`, items);
      setDirty(false);
      await qc.invalidateQueries();
      useApp.getState().toast(`${key[0]!.toUpperCase()}${key.slice(1)} saved`);
    } catch (e) { useApp.getState().toast((e as Error).message); }
  };
  return { items, change, dirty, save };
}

export function CanonScreen({ w }: { w: string }) {
  const { data: world } = useWorld(w);
  const conts = useSection<Continuity>(w, 'continuities', world?.continuities);
  const sources = useSection<SourceT & { url?: string; notes?: string }>(w, 'sources', world?.sources);
  const arcs = useSection<Arc>(w, 'arcs', world?.arcs as Arc[] | undefined);
  if (!world) return <div className="muted">Loading…</div>;
  const move = <T,>(list: T[], i: number, d: number) => { const j = i + d; if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j]!, list[i]!]; };
  const SaveBtn = ({ s }: { s: { dirty: boolean; save: () => Promise<void> } }) => <button className="btn primary" disabled={!s.dirty} onClick={() => void s.save()}>{s.dirty ? 'Save' : 'Saved'}</button>;

  return (
    <>
      <h1 className="title">Continuities, sources & arcs</h1>
      <div className="muted" style={{ marginBottom: 20 }}>Continuities are canon branches. Sources are where information comes from. Arcs are shared checkpoints that map to each source's chapter/episode range, so progress in one source can imply progress in another.</div>

      <section className="card" style={{ marginBottom: 20, display: 'grid', gap: 10 }}>
        <div className="row"><h3 style={{ margin: 0 }} className="grow">Continuities</h3><SaveBtn s={conts} /></div>
        {conts.items.map((c, i) => (
          <div className="row" key={c.id} style={{ flexWrap: 'wrap' }}>
            <input aria-label="Color" type="color" style={{ width: 44, padding: 2 }} value={c.color} onChange={(e) => conts.change((l) => { l[i]!.color = e.target.value; })} />
            <input aria-label="Name" style={{ width: 220 }} value={c.name} onChange={(e) => conts.change((l) => { l[i]!.name = e.target.value; })} />
            <code className="muted">{c.id}</code>
            <label className="row muted"><input type="radio" style={{ width: 'auto' }} name="primary" checked={c.isPrimary} onChange={() => conts.change((l) => l.forEach((x, j) => { x.isPrimary = i === j; }))} />Primary</label>
            <span className="grow" />
            <button className="btn ghost" aria-label="Move up" onClick={() => conts.change((l) => move(l, i, -1))}>↑</button>
            <button className="btn ghost" aria-label="Move down" onClick={() => conts.change((l) => move(l, i, 1))}>↓</button>
            <button className="btn ghost danger" aria-label="Remove continuity" onClick={() => conts.change((l) => { l.splice(i, 1); })}>✕</button>
          </div>
        ))}
        <button className="btn" onClick={() => conts.change((l) => { l.push({ id: idFrom('Continuity', l.map((x) => x.id)), name: 'New continuity', color: '#888888', isPrimary: false } as Continuity); })}>＋ Add continuity</button>
      </section>

      <section className="card" style={{ marginBottom: 20, display: 'grid', gap: 10 }}>
        <div className="row"><h3 style={{ margin: 0 }} className="grow">Sources</h3><SaveBtn s={sources} /></div>
        <div className="muted" style={{ fontSize: '.8rem' }}>Save continuities first if a source needs a new one.</div>
        {sources.items.map((s, i) => (
          <div className="card" style={{ padding: 10 }} key={s.id}>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <label className="f" style={{ width: 200 }}>Name<input value={s.name} onChange={(e) => sources.change((l) => { l[i]!.name = e.target.value; })} /></label>
              <label className="f" style={{ width: 140 }}>Kind<select value={s.kind} onChange={(e) => sources.change((l) => { l[i]!.kind = e.target.value; })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
              <label className="f" style={{ width: 170 }}>Continuity<select value={s.continuityId} onChange={(e) => sources.change((l) => { l[i]!.continuityId = e.target.value; })}>{world.continuities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="f" style={{ width: 110 }}>Unit<select value={s.units.label} onChange={(e) => sources.change((l) => { l[i]!.units.label = e.target.value; })}>{UNITS.map((k) => <option key={k}>{k}</option>)}</select></label>
              <label className="f" style={{ width: 90 }}>Count<input type="number" min={1} value={s.units.count ?? ''} onChange={(e) => sources.change((l) => { l[i]!.units.count = e.target.value ? Number(e.target.value) : undefined; })} /></label>
              <span className="grow" /><code className="muted">{s.id}</code>
              <button className="btn ghost danger" aria-label="Remove source" onClick={() => sources.change((l) => { l.splice(i, 1); })}>✕</button>
            </div>
            <label className="f" style={{ marginTop: 6 }}>Notes<input value={s.notes ?? ''} onChange={(e) => sources.change((l) => { l[i]!.notes = e.target.value; })} /></label>
            <LorekeeperLink link={s.link} onChange={(link) => sources.change((l) => { l[i]!.link = link; })} />
          </div>
        ))}
        <button className="btn" onClick={() => sources.change((l) => { l.push({ id: idFrom('Source', l.map((x) => x.id)), name: 'New source', kind: 'other', continuityId: world.continuities[0]!.id, units: { label: 'Chapter' }, notes: '' } as SourceT); })}>＋ Add source</button>
      </section>

      <section className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="row"><h3 style={{ margin: 0 }} className="grow">Arcs ↔ source ranges</h3><SaveBtn s={arcs} /></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>Arc</th>{world.sources.map((s) => <th key={s.id} style={{ textAlign: 'left' }}>{s.name} ({s.units.label.toLowerCase()}s)</th>)}<th /></tr></thead>
            <tbody>
              {arcs.items.map((a, i) => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 6, minWidth: 200 }}>
                    <input aria-label="Arc name" value={a.name} onChange={(e) => arcs.change((l) => { l[i]!.name = e.target.value; })} />
                    <input aria-label="Arc summary" placeholder="Summary" style={{ marginTop: 4 }} value={a.summary ?? ''} onChange={(e) => arcs.change((l) => { l[i]!.summary = e.target.value; })} />
                  </td>
                  {world.sources.map((s) => {
                    const r = a.ranges[s.id];
                    const set = (k: 'from' | 'to', v: string) => arcs.change((l) => {
                      const cur = l[i]!.ranges[s.id] ?? { from: 0, to: 0 };
                      if (v === '') { delete l[i]!.ranges[s.id]; return; }
                      l[i]!.ranges[s.id] = { ...cur, [k]: Number(v) };
                      if (k === 'from' && !r) l[i]!.ranges[s.id]!.to = Number(v);
                    });
                    return (
                      <td key={s.id} style={{ padding: 6 }}>
                        <div className="row"><input aria-label={`${a.name} ${s.name} from`} type="number" style={{ width: 80 }} value={r?.from ?? ''} onChange={(e) => set('from', e.target.value)} />–<input aria-label={`${a.name} ${s.name} to`} type="number" style={{ width: 80 }} value={r?.to ?? ''} onChange={(e) => set('to', e.target.value)} /></div>
                      </td>
                    );
                  })}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost" aria-label="Move arc up" onClick={() => arcs.change((l) => { move(l, i, -1); l.forEach((x, j) => { x.order = j + 1; }); })}>↑</button>
                    <button className="btn ghost" aria-label="Move arc down" onClick={() => arcs.change((l) => { move(l, i, 1); l.forEach((x, j) => { x.order = j + 1; }); })}>↓</button>
                    <button className="btn ghost danger" aria-label="Remove arc" onClick={() => arcs.change((l) => { l.splice(i, 1); })}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn" onClick={() => arcs.change((l) => { l.push({ id: idFrom('Arc', l.map((x) => x.id)), name: 'New arc', order: l.length + 1, ranges: {}, summary: '' } as Arc); })}>＋ Add arc</button>
      </section>
    </>
  );
}
