import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, q } from '../api';
import { useTypes } from '../hooks';
import { useApp } from '../store';
import { download } from './GraphScreen';

const cfg = () => window.worldloom ?? { baseUrl: '', token: 'dev-token' };
async function fetchBlob(path: string) {
  const res = await fetch(`${cfg().baseUrl}/api/v1${path}`, { headers: { Authorization: `Bearer ${cfg().token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: { message: res.statusText } }))).error.message);
  const cd = res.headers.get('Content-Disposition') ?? '';
  return { blob: await res.blob(), name: /filename="([^"]+)"/.exec(cd)?.[1] ?? 'export' };
}
interface Preview { counts: Record<string, number>; items: Array<{ title: string; type: string; action: string; source: string; warnings: string[] }> }
const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); });

export function DataScreen({ w }: { w: string }) {
  const types = useTypes(w);
  const qc = useQueryClient();
  const toast = useApp.getState().toast;
  const [spoilers, setSpoilers] = useState(false);
  const [player, setPlayer] = useState(false);
  const [csvType, setCsvType] = useState('');
  const [fmt, setFmt] = useState<'markdown' | 'csv'>('markdown');
  const [mode, setMode] = useState<'skip' | 'overwrite' | 'rename'>('skip');
  const [defType, setDefType] = useState('');
  const [files, setFiles] = useState<Array<{ path: string; text: string }>>([]);
  const [prev, setPrev] = useState<Preview | null>(null);
  const folder = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const opts = q({ spoilers: spoilers ? 1 : 0, player: player ? 1 : 0 });
  const exp = async (format: string, extra = '') => {
    try { const { blob, name } = await fetchBlob(`/worlds/${w}/export/${format}${opts}${extra}`); download(blob, name); }
    catch (e) { toast((e as Error).message); }
  };
  const body = () => ({ format: fmt, files, type: defType || csvType || undefined, mode });
  const pick = async (list: FileList | null) => {
    if (!list) return;
    const out: Array<{ path: string; text: string }> = [];
    for (const f of Array.from(list)) if (/\.(md|csv)$/i.test(f.name)) out.push({ path: ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, text: await readFile(f) });
    setFiles(out); setPrev(null);
  };
  const doPreview = async () => { try { setPrev(await api.post<Preview>(`/worlds/${w}/import/preview`, body())); } catch (e) { toast((e as Error).message); } };
  const doCommit = async () => {
    try {
      const r = await api.post<{ created: number; updated: number; skipped: number; errors: string[]; txId: string }>(`/worlds/${w}/import/commit`, body());
      await qc.invalidateQueries(); setPrev(null); setFiles([]);
      toast(`Imported: ${r.created} created, ${r.updated} updated, ${r.skipped} skipped${r.errors.length ? `, ${r.errors.length} errors` : ''}`, { label: 'Undo', run: async () => { await api.post(`/worlds/${w}/tx/${r.txId}/undo`); await qc.invalidateQueries(); toast('Import undone'); } });
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <>
      <h1 className="title" style={{ fontSize: '1.6rem' }}>Import & export</h1>
      <section className="card" style={{ marginBottom: 16, display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Export</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} />Include spoilers</label>
          <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={player} onChange={(e) => setPlayer(e.target.checked)} />Player view (hide DM-only)</label>
        </div>
        <div className="muted" style={{ fontSize: '.85rem' }}>{spoilers ? 'Everything, including gated content, is exported.' : 'Only what you can see at your current progress is exported; gated titles are masked.'}</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void exp('json')}>JSON backup</button>
          <button className="btn" onClick={() => void exp('markdown')}>Markdown vault (.zip)</button>
          <button className="btn" onClick={() => void exp('html')}>Single HTML file</button>
          <button className="btn" onClick={() => void exp('site')}>Static site (.zip)</button>
          <select aria-label="CSV type" style={{ width: 'auto' }} value={csvType} onChange={(e) => setCsvType(e.target.value)}><option value="">CSV for type…</option>{types.data?.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select>
          <button className="btn" disabled={!csvType} onClick={() => void exp('csv', `&type=${csvType}`)}>Export CSV</button>
        </div>
      </section>
      <section className="card" style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Import into this world</h3>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select aria-label="Import format" style={{ width: 'auto' }} value={fmt} onChange={(e) => { setFmt(e.target.value as typeof fmt); setFiles([]); setPrev(null); }}><option value="markdown">Markdown folder / Obsidian vault</option><option value="csv">CSV file</option></select>
          <select aria-label="Default type" style={{ width: 'auto' }} value={defType} onChange={(e) => setDefType(e.target.value)}><option value="">{fmt === 'csv' ? 'Type for CSV…' : 'Default type (optional)…'}</option>{types.data?.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select>
          <select aria-label="On title clash" style={{ width: 'auto' }} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="skip">If a page exists: skip</option><option value="overwrite">If a page exists: overwrite</option><option value="rename">If a page exists: keep both</option></select>
          {fmt === 'markdown'
            ? <><button className="btn" onClick={() => folder.current?.click()}>Choose folder…</button><input ref={folder} type="file" hidden multiple {...({ webkitdirectory: '' } as object)} onChange={(e) => void pick(e.target.files)} /></>
            : <><button className="btn" onClick={() => file.current?.click()}>Choose CSV…</button><input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void pick(e.target.files)} /></>}
          <span className="muted">{files.length ? `${files.length} file(s) selected` : ''}</span>
        </div>
        <div className="row"><button className="btn" disabled={!files.length} onClick={() => void doPreview()}>Preview</button><button className="btn primary" disabled={!prev} onClick={() => void doCommit()}>Import</button></div>
        {prev && (
          <div>
            <div className="chips" style={{ marginBottom: 8 }}>{Object.entries(prev.counts).map(([k, n]) => <span className="chip" key={k}>{k}: {n}</span>)}</div>
            <div style={{ maxHeight: 260, overflow: 'auto' }}>{prev.items.map((i, k) => <div key={k} className="muted" style={{ fontSize: '.85rem' }}><b>{i.action}</b> · {i.title || '(untitled)'} <span>({i.type || 'no type'})</span>{i.warnings.map((x, j) => <span key={j} className="warn"> · {x}</span>)}</div>)}</div>
          </div>
        )}
        <div className="muted" style={{ fontSize: '.8rem' }}>A zip backup is taken automatically before every import, and the whole import can be undone from the toast.</div>
      </section>
    </>
  );
}
