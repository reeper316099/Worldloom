import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useApp } from '../store';

interface Settings { autoLockMinutes: number; hideTitles: boolean; blurStrength: number; hideImages: boolean; vimMode: boolean }
declare global { interface Window { worldloomDesktop?: { chooseFolder?(): Promise<string | null>; chooseDataDir(): Promise<string | null>; revealDataDir(): Promise<void>; onMenu?(cb: (action: string) => void): () => void } } }

function LorekeeperCard() {
  const cfg = useQuery({ queryKey: ['lk-config'], queryFn: () => api.get<{ enabled: boolean; baseUrl: string; hasToken: boolean }>('/integrations/lorekeeper') });
  const qc = useQueryClient();
  const toast = useApp.getState().toast;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const on = enabled ?? cfg.data?.enabled ?? false;
  const base = url ?? cfg.data?.baseUrl ?? 'http://127.0.0.1:4317';
  const save = async () => {
    try { await api.put('/integrations/lorekeeper', { enabled: on, baseUrl: base, token: token || undefined }); setToken(''); await qc.invalidateQueries(); toast('Lorekeeper settings saved'); } catch (e) { toast((e as Error).message); }
  };
  const test = async () => { try { const r = await api.post<{ entries?: number }>('/integrations/lorekeeper/test', {}); toast(`Connected to Lorekeeper${r.entries !== undefined ? ` (${r.entries} entries)` : ''}`); } catch (e) { toast((e as Error).message); } };
  return (
    <section className="card" style={{ display: 'grid', gap: 8 }}>
      <h3 style={{ margin: 0 }}>Lorekeeper link</h3>
      <div className="muted" style={{ fontSize: '.85rem' }}>Optional. Reads your reading/watching progress from your Lorekeeper app's local API to move your spoiler progress forward. Off by default; only local addresses are ever contacted (nothing leaves your computer).</div>
      <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={on} onChange={(e) => setEnabled(e.target.checked)} />Enable</label>
      <label className="f">Lorekeeper API address<input value={base} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:4317" /></label>
      <label className="f">API token {cfg.data?.hasToken && <span className="muted">(saved — leave blank to keep)</span>}<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label>
      <div className="row"><button className="btn primary" onClick={() => void save()}>Save</button><button className="btn" onClick={() => void test()}>Test connection</button></div>
      <div className="muted" style={{ fontSize: '.8rem' }}>Lorekeeper's dev server listens on port 4317 with token <code>dev-token</code> by default. The packaged Lorekeeper app picks a random port and token on each launch, so use its dev mode (or a fixed PORT/LOREKEEPER_TOKEN) for this link.</div>
    </section>
  );
}

export function SettingsScreen() {
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const info = useQuery({ queryKey: ['info'], queryFn: () => api.get<{ dataDir: string; defaultDataDir: string }>('/info') });
  const qc = useQueryClient();
  const app = useApp();
  const set = async (patch: Partial<Settings>) => { await api.put('/settings', patch); await qc.invalidateQueries(); };
  const desktop = window.worldloomDesktop;
  return (
    <>
      <h1 className="title" style={{ fontSize: '1.6rem' }}>Settings</h1>
      <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
        <section className="card" style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Appearance</h3>
          <label className="f">Theme<select value={app.theme} onChange={(e) => app.setTheme(e.target.value as 'dark' | 'light' | 'system')}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
          <label className="f">Density<select value={app.density} onChange={(e) => app.setDensity(e.target.value as 'comfortable' | 'compact')}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
        </section>
        <section className="card" style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Spoilers</h3>
          <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={!!s.data?.hideTitles} onChange={(e) => void set({ hideTitles: e.target.checked })} />Hide titles of gated pages (otherwise shown greyed out)</label>
          <div className="muted" style={{ fontSize: '.85rem' }}>Exports always mask gated titles.</div>
        </section>
        <section className="card" style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Security</h3>
          <label className="f">Auto-lock encrypted worlds after
            <select value={s.data?.autoLockMinutes ?? 0} onChange={(e) => void set({ autoLockMinutes: Number(e.target.value) })}>
              <option value={0}>Never</option><option value={5}>5 minutes idle</option><option value={15}>15 minutes idle</option><option value={60}>1 hour idle</option>
            </select>
          </label>
        </section>
        <LorekeeperCard />
        <section className="card" style={{ display: 'grid', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Data</h3>
          <div><span className="muted">Data folder:</span> <code>{info.data?.dataDir}</code></div>
          {desktop ? <div className="row"><button className="btn" onClick={() => void desktop.revealDataDir()}>Show in file manager</button><button className="btn" onClick={() => void desktop.chooseDataDir()}>Change folder…</button></div>
            : <div className="muted" style={{ fontSize: '.85rem' }}>Set WORLDLOOM_DATA_DIR before launching to use another folder.</div>}
          <div className="muted" style={{ fontSize: '.85rem' }}>Worlds are plain Markdown and JSON files; rolling zip backups live in <code>backups/</code>.</div>
        </section>
      </div>
    </>
  );
}
