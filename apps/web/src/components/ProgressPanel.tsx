import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLorekeeper } from './LorekeeperLink';
import { api, type World } from '../api';
import { useApp } from '../store';

/** "My progress": per-source position, arc checkpoint (with implied floors), show-all, per-item overrides. */
export function ProgressPanel({ w, world }: { w: string; world: World }) {
  const qc = useQueryClient();
  const mode = useApp((s) => s.mode);
  const save = useMutation({ mutationFn: (b: object) => api.put(`/worlds/${w}/progress`, b), onSuccess: () => qc.invalidateQueries() });
  const clear = useMutation({ mutationFn: () => api.post(`/worlds/${w}/progress/reveal`, { clear: true }), onSuccess: () => qc.invalidateQueries() });
  const lk = useLorekeeper();
  const linked = world.sources.filter((s) => s.link);
  const [syncMode, setSyncMode] = useState<'max' | 'follow'>('max');
  const sync = async (quiet = false) => {
    try {
      const r = await api.post<{ report: Array<{ name: string; action: string; to?: number; message?: string }> }>(`/worlds/${w}/integrations/lorekeeper/sync`, { mode: syncMode });
      await qc.invalidateQueries();
      const changed = r.report.filter((x) => x.action === 'raised' || x.action === 'lowered');
      const errs = r.report.filter((x) => x.action === 'error');
      if (!quiet || changed.length || errs.length) useApp.getState().toast(changed.length ? `Synced from Lorekeeper: ${changed.map((c) => `${c.name} → ${c.to}`).join(', ')}` : errs.length ? `Lorekeeper: ${errs[0]!.message}` : 'Lorekeeper progress is already up to date');
    } catch (e) { if (!quiet) useApp.getState().toast((e as Error).message); }
  };
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && lk.data?.enabled && linked.length) { auto.current = true; void sync(true); } }, [lk.data?.enabled, linked.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = world.progress;
  const unset = world.sources.filter((s) => p.sources[s.id] === undefined);
  const primary = new Set(world.sources.filter((s) => world.continuities.find((c) => c.id === s.continuityId)?.isPrimary).map((s) => s.id));
  const cp = world.arcs.find((a) => a.id === p.arcCheckpoint) as (World['arcs'][number] & { ranges?: Record<string, { from: number; to: number }> }) | undefined;
  const implied = cp?.ranges ? Object.entries(cp.ranges).map(([sid, r]) => {
    const s = world.sources.find((x) => x.id === sid);
    return s ? `${s.name} ${s.units.label.toLowerCase()} ${primary.has(sid) ? r.to : r.from}` : '';
  }).filter(Boolean) : [];
  return (
    <section className="card" aria-label="My progress">
      <h4>My progress</h4>
      <div className="muted" style={{ fontSize: '.8rem', marginBottom: 8 }}>
        {mode === 'reader' ? 'Reader mode: anything beyond this is hidden.' : 'Author mode shows everything; switch to reader mode to apply this.'}
      </div>
      {unset.length > 0 && <div className="callout warn" style={{ marginBottom: 8, fontSize: '.82rem' }}>Not set: {unset.map((s) => s.name).join(', ')}. Gated content for these is hidden.</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {world.sources.map((s) => (
          <label className="f" key={s.id}>{s.name} · {s.units.label}{s.units.count ? ` (of ${s.units.count})` : ''}
            <input type="number" min={0} max={s.units.count} placeholder="not set" defaultValue={p.sources[s.id] ?? ''} key={`${s.id}:${p.sources[s.id] ?? ''}`}
              onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== p.sources[s.id] && save.mutate({ sources: { [s.id]: Number(e.target.value) } })} />
          </label>
        ))}
        {world.arcs.length > 0 && (
          <label className="f">I've finished arc
            <select value={p.arcCheckpoint ?? ''} onChange={(e) => save.mutate({ arcCheckpoint: e.target.value || undefined })}>
              <option value="">—</option>
              {[...world.arcs].sort((a, b) => a.order - b.order).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        {implied.length > 0 && <div className="muted" style={{ fontSize: '.78rem' }}>Implies at least: {implied.join(' · ')} (lowest for non-primary sources)</div>}
        {lk.data?.enabled && linked.length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => void sync()}>🔗 Sync from Lorekeeper</button>
            <select aria-label="Sync mode" style={{ width: 'auto' }} value={syncMode} onChange={(e) => setSyncMode(e.target.value as typeof syncMode)}><option value="max">only move forward</option><option value="follow">mirror exactly</option></select>
          </div>
        )}
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={p.showAll} onChange={(e) => save.mutate({ showAll: e.target.checked })} /> Show all spoilers</label>
        {p.revealed.length > 0 && (
          <div className="row muted" style={{ fontSize: '.8rem' }}>
            <span className="grow">{p.revealed.length} item(s) revealed individually</span>
            <button className="btn" onClick={() => clear.mutate()}>Re-hide all</button>
          </div>
        )}
      </div>
    </section>
  );
}
