import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useApp } from '../store';

interface Settings { hideTitles: boolean; blurStrength: number; hideImages: boolean; vimMode: boolean }
declare global { interface Window { worldloomDesktop?: { chooseDataDir(): Promise<string | null>; revealDataDir(): Promise<void>; onMenu?(cb: (action: string) => void): () => void } } }

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
