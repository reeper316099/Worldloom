import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useApp } from '../store';
import { download } from '../screens/GraphScreen';

interface PlanItem { id: string; title: string; type: string; action: string; note?: string }
interface Plan { counts: Record<string, number>; items: PlanItem[]; extras?: { relations: number; events: number; types: number; configAdded: string[]; configDiffers: string[] }; includesSpoilers?: boolean; origin?: { worldName: string; deviceId: string; exportedAt: string } }
type Resolution = 'newer' | 'local' | 'remote' | 'both';
const cfg = () => window.worldloom ?? { baseUrl: '', token: 'dev-token' };

function PlanView({ plan }: { plan: Plan }) {
  const rows = plan.items.filter((i) => i.action !== 'unchanged');
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {plan.origin && <div className="muted" style={{ fontSize: '.85rem' }}>From “{plan.origin.worldName}” · {new Date(plan.origin.exportedAt).toLocaleString()}{plan.includesSpoilers === false ? ' · spoilers removed (existing pages are never overwritten)' : ''}</div>}
      <div className="chips">{Object.entries(plan.counts).map(([k, n]) => <span key={k} className="chip">{k}: {n}</span>)}
        {plan.extras && (plan.extras.relations || plan.extras.events || plan.extras.types) ? <span className="chip">+{plan.extras.relations} relations, {plan.extras.events} events, {plan.extras.types} types</span> : null}</div>
      <div style={{ maxHeight: 240, overflow: 'auto' }}>
        {rows.length === 0 && <div className="muted">Nothing to merge — already in sync.</div>}
        {rows.map((i) => <div key={i.id} style={{ fontSize: '.85rem' }}><b className={i.action === 'conflict' ? 'warn' : ''}>{i.action}</b> · {i.title} <span className="muted">({i.type}){i.note ? ` — ${i.note}` : ''}</span></div>)}
      </div>
    </div>
  );
}

/** Share a world as a bundle file, merge a bundle from someone else (or another machine), or keep a shared folder in sync. */
export function SyncCard({ w }: { w: string }) {
  const qc = useQueryClient();
  const toast = useApp.getState().toast;
  const [spoilers, setSpoilers] = useState(false);
  const [pass, setPass] = useState('');
  const [res, setRes] = useState<Resolution>('newer');
  const [bundle, setBundle] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [folder, setFolder] = useState('');
  const [folderPlan, setFolderPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const guard = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };

  const exportBundle = () => guard(async () => {
    const r = await fetch(`${cfg().baseUrl}/api/v1/worlds/${w}/sync/export`, { method: 'POST', headers: { Authorization: `Bearer ${cfg().token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ spoilers, passphrase: pass || undefined }) });
    if (!r.ok) throw new Error((await r.json()).error.message);
    download(await r.blob(), /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? `${w}.worldloom-bundle`);
  });
  const body = () => ({ bundle, passphrase: pass || undefined, resolution: res });
  const preview = () => guard(async () => { setPlan(await api.post<Plan>(`/worlds/${w}/sync/preview`, body())); });
  const apply = () => guard(async () => {
    const r = await api.post<{ txId: string; plan: Plan }>(`/worlds/${w}/sync/apply`, body());
    await qc.invalidateQueries(); setPlan(null); setBundle(null);
    toast('Merged', { label: 'Undo', run: async () => { await api.post(`/worlds/${w}/tx/${r.txId}/undo`); await qc.invalidateQueries(); toast('Merge undone'); } });
  });
  const folderBody = (apply: boolean) => ({ path: folder, passphrase: pass || undefined, resolution: res, apply });
  const folderCheck = () => guard(async () => { const r = await api.post<{ plan?: Plan }>(`/worlds/${w}/sync/folder`, folderBody(false)); setFolderPlan(r.plan ?? { counts: {}, items: [] }); });
  const folderSync = () => guard(async () => {
    const r = await api.post<{ plan?: Plan; txId?: string }>(`/worlds/${w}/sync/folder`, folderBody(true));
    await qc.invalidateQueries(); setFolderPlan(r.plan ?? null);
    toast(r.txId ? 'Synced with the shared folder' : 'Shared folder updated', r.txId ? { label: 'Undo merge', run: async () => { await api.post(`/worlds/${w}/tx/${r.txId}/undo`); await qc.invalidateQueries(); toast('Merge undone (run sync again to push)'); } } : undefined);
  });
  const choose = async () => { const p = await window.worldloomDesktop?.chooseFolder?.(); if (p) setFolder(p); };

  return (
    <section className="card" style={{ marginBottom: 16, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Share & sync</h3>
      <div className="muted" style={{ fontSize: '.85rem' }}>No cloud: bundles are plain files you hand over yourself, and folder sync just reads and writes one file in a folder you pick (Dropbox, iCloud, a USB stick…). Your reading progress is never included. Edits to the same page on both sides are never lost: the other version is saved as a “sync-conflict” page.</div>
      <label className="f">Passphrase for bundles / sync file (optional; required for encrypted worlds)
        <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
      </label>
      <label className="f" style={{ maxWidth: 360 }}>When both sides edited the same page
        <select value={res} onChange={(e) => setRes(e.target.value as Resolution)}>
          <option value="newer">Keep the newer one, save the other as a conflict page</option><option value="both">Keep mine, save theirs as a conflict page</option><option value="local">Keep mine only</option><option value="remote">Take theirs only</option>
        </select>
      </label>

      <div style={{ display: 'grid', gap: 8 }}>
        <h4 style={{ margin: 0 }}>Share a bundle</h4>
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} />Include spoilers (everything — for syncing your own machines)</label>
        <div className="muted" style={{ fontSize: '.8rem' }}>{spoilers ? 'Everything, including gated content, goes into the file.' : 'Safe to share with someone further behind: only what you can see at your progress is included.'}</div>
        <div><button className="btn" disabled={busy} onClick={() => void exportBundle()}>Create bundle file…</button></div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <h4 style={{ margin: 0 }}>Merge a bundle into this world</h4>
        <div className="row"><button className="btn" onClick={() => file.current?.click()}>Choose bundle…</button><span className="muted">{bundle ? 'bundle loaded' : ''}</span>
          <input ref={file} type="file" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setBundle(await f.text()); setPlan(null); } e.target.value = ''; }} /></div>
        <div className="row"><button className="btn" disabled={!bundle || busy} onClick={() => void preview()}>Preview</button><button className="btn primary" disabled={!plan || busy} onClick={() => void apply()}>Merge</button></div>
        {plan && <PlanView plan={plan} />}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <h4 style={{ margin: 0 }}>Shared-folder sync</h4>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input aria-label="Sync folder" placeholder="/path/to/shared/folder" style={{ maxWidth: 420 }} value={folder} onChange={(e) => setFolder(e.target.value)} />
          {window.worldloomDesktop?.chooseFolder && <button className="btn" onClick={() => void choose()}>Choose…</button>}
        </div>
        <div className="row"><button className="btn" disabled={!folder || busy} onClick={() => void folderCheck()}>Check</button><button className="btn primary" disabled={!folder || busy} onClick={() => void folderSync()}>Sync now</button></div>
        <div className="muted" style={{ fontSize: '.8rem' }}>The sync file contains your whole world including spoilers. On another machine use “Join synced world…” on the home screen.</div>
        {folderPlan && <PlanView plan={folderPlan} />}
      </div>
    </section>
  );
}
