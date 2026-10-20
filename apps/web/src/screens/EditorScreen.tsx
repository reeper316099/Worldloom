import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FieldDef, type RawPage } from '../api';
import { go, wPath } from '../router';
import { useTypes, useWorld } from '../hooks';
import { useApp } from '../store';
import { CodeEditor } from '../components/CodeEditor';
import { RenameDialog } from '../components/RenameDialog';

const asText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? JSON.stringify(v) : v === undefined || v === null ? '' : String(v));

export function EditorScreen({ w, ref_ }: { w: string; ref_: string }) {
  const raw = useQuery({ queryKey: ['raw', w, ref_], queryFn: () => api.get<RawPage>(`/worlds/${w}/pages/${encodeURIComponent(ref_)}/raw?mode=author`), staleTime: Infinity });
  if (raw.error) return <div className="card">Page not found. <a href={`#/w/${w}`}>Back</a></div>;
  if (!raw.data) return <div className="muted">Loading…</div>;
  return <Editor w={w} page={raw.data} />;
}

function Editor({ w, page }: { w: string; page: RawPage }) {
  const types = useTypes(w);
  const { data: world } = useWorld(w);
  const qc = useQueryClient();
  const [body, setBody] = useState(page.body);
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(page.fields).map(([k, v]) => [k, asText(v)])));
  const [meta, setMeta] = useState({ status: page.status, aliases: page.aliases.join(', '), tags: page.tags.join(', ') });
  const [html, setHtml] = useState('');
  const [state, setState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [renaming, setRenaming] = useState(false);
  const [vim, setVim] = useState(false);
  const [spell, setSpell] = useState(false);
  const dirty = useRef(false);
  const focus = useApp((s) => s.focus);
  const continuity = useApp((s) => s.continuity);
  const type = types.data?.find((t) => t.slug === page.type);

  // live preview (server-rendered so syntax, links and infobox match the real page)
  useEffect(() => {
    const t = setTimeout(() => {
      api.post<{ html: string }>(`/worlds/${w}/render`, { body, pageId: page.id, continuity }).then((r) => setHtml(r.html)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [body, w, page.id, continuity]);

  // debounced autosave; server keeps revisions
  useEffect(() => {
    if (!dirty.current) return;
    setState('dirty');
    const t = setTimeout(async () => {
      setState('saving');
      try {
        const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
        const f: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          const def = type?.fields.find((d) => d.key === k);
          const orig = page.fields[k];
          if (orig && typeof orig === 'object' && !Array.isArray(orig)) continue; // wrapped values are edited in the file
          if (v !== '') f[k] = def?.type === 'multiselect' || def?.multiple ? split(v) : v;
        }
        await api.patch(`/worlds/${w}/pages/${page.id}`, { body, fields: f, status: meta.status, aliases: split(meta.aliases), tags: split(meta.tags) });
        dirty.current = false;
        setState('saved');
        void qc.invalidateQueries({ queryKey: ['page'] });
      } catch (e) {
        setState('error');
        useApp.getState().toast(`Save failed: ${(e as Error).message}`);
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, fields, meta]);

  const touch = () => { dirty.current = true; };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <a className="btn" href={`#/w/${w}/p/${page.slug}`}>← Done</a>
        <h2 style={{ margin: 0 }}>{page.title}</h2>
        <span className="muted" aria-live="polite">{state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : state === 'error' ? 'Error' : 'Unsaved changes'}</span>
        <span className="grow" />
        <label className="row muted" style={{ fontSize: '.8rem' }}><input type="checkbox" style={{ width: 'auto' }} checked={vim} onChange={(e) => setVim(e.target.checked)} />Vim</label>
        <label className="row muted" style={{ fontSize: '.8rem' }}><input type="checkbox" style={{ width: 'auto' }} checked={spell} onChange={(e) => setSpell(e.target.checked)} />Spellcheck</label>
        <button className="btn ghost" onClick={() => useApp.getState().toggleFocus()}>{focus ? 'Exit focus' : 'Focus'}</button>
        <button className="btn ghost" onClick={() => setRenaming(true)}>Rename</button>
      </div>
      <div className="editor">
        <div className="pane form">
          <label className="f">Status
            <select value={meta.status} onChange={(e) => { touch(); setMeta({ ...meta, status: e.target.value }); }}>
              <option>stub</option><option>draft</option><option>complete</option>
            </select>
          </label>
          <label className="f">Aliases (comma separated)<input value={meta.aliases} onChange={(e) => { touch(); setMeta({ ...meta, aliases: e.target.value }); }} /></label>
          <label className="f">Tags<input value={meta.tags} onChange={(e) => { touch(); setMeta({ ...meta, tags: e.target.value }); }} /></label>
          <hr style={{ width: '100%', border: 0, borderTop: '1px solid var(--border)' }} />
          {type?.fields.map((d) => (
            <FieldInput key={d.key} def={d} value={fields[d.key] ?? ''} locked={!!page.fields[d.key] && typeof page.fields[d.key] === 'object' && !Array.isArray(page.fields[d.key])}
              onChange={(v) => { touch(); setFields({ ...fields, [d.key]: v }); }} />
          ))}
          {!type?.fields.length && <div className="muted">This type has no fields.</div>}
          {world && world.continuities.length > 1 && <div className="muted" style={{ fontSize: '.78rem' }}>Per-continuity values and reveals: edit the frontmatter (see docs/DATA_FORMAT.md). A visual editor arrives in M5/M6.</div>}
        </div>
        <div className="pane"><CodeEditor value={page.body} world={w} vimMode={vim} spell={spell} onChange={(v) => { touch(); setBody(v); }} /></div>
        <div className="pane prev"><article className="prose" dangerouslySetInnerHTML={{ __html: html }} /></div>
      </div>
      {renaming && <RenameDialog w={w} id={page.id} title={page.title} close={() => setRenaming(false)} onDone={(slug) => go(wPath(w, 'p', slug, 'edit'))} />}
    </>
  );
}

function FieldInput({ def, value, onChange, locked }: { def: FieldDef; value: string; onChange: (v: string) => void; locked: boolean }) {
  const common = { id: 'f-' + def.key, disabled: locked, value, title: locked ? 'This value has per-continuity data or a reveal; edit it in the file.' : undefined };
  let input;
  if (def.type === 'select') input = <select {...common} onChange={(e) => onChange(e.target.value)}><option value="" />{def.options?.map((o) => <option key={o}>{o}</option>)}</select>;
  else if (def.type === 'longtext') input = <textarea rows={3} {...common} onChange={(e) => onChange(e.target.value)} />;
  else if (def.type === 'boolean') input = <select {...common} onChange={(e) => onChange(e.target.value)}><option value="" /><option>true</option><option>false</option></select>;
  else input = <input type={def.type === 'number' || def.type === 'stat' ? 'number' : 'text'} {...common} placeholder={def.type === 'relation' ? (def.multiple ? 'Titles, comma separated' : 'Page title') : ''} onChange={(e) => onChange(e.target.value)} />;
  return <label className="f" htmlFor={'f-' + def.key}>{def.label}{input}</label>;
}
