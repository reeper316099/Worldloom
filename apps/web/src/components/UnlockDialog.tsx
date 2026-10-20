import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useApp } from '../store';
import { go } from '../router';

/** Asks for a world's passphrase. Opened by the home screen or whenever any request gets a 423 (locked). */
export function UnlockDialog() {
  const slug = useApp((s) => s.unlock);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    const on = (e: Event) => useApp.getState().setUnlock((e as CustomEvent<string>).detail);
    window.addEventListener('wl-locked', on);
    return () => window.removeEventListener('wl-locked', on);
  }, []);
  useEffect(() => { setPass(''); setErr(''); }, [slug]);
  if (!slug) return null;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api.post(`/worlds/${slug}/unlock`, { passphrase: pass });
      useApp.getState().setUnlock(null);
      await qc.invalidateQueries();
      go(`/w/${slug}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const close = () => useApp.getState().setUnlock(null);
  return (
    <div className="overlay" onMouseDown={close}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label="Unlock world" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h3 style={{ margin: 0 }}>🔒 Unlock world</h3>
        <label className="f">Passphrase<input type="password" autoFocus autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        {err && <div role="alert" className="warn">{err}</div>}
        <div className="row"><span className="grow" /><button type="button" className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={!pass || busy}>{busy ? 'Unlocking…' : 'Unlock'}</button></div>
      </form>
    </div>
  );
}
