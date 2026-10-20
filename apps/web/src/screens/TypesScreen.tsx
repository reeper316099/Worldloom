import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type EntityType, type FieldDef } from '../api';
import { useApp } from '../store';
import { useTypes } from '../hooks';

const FIELD_TYPES = ['text', 'longtext', 'number', 'select', 'multiselect', 'boolean', 'date', 'inWorldDate', 'relation', 'tier', 'stat', 'image', 'url', 'source', 'arc'];
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'type';

export function TypesScreen({ w }: { w: string }) {
  const server = useTypes(w);
  const qc = useQueryClient();
  const [types, setTypes] = useState<EntityType[]>([]);
  const [sel, setSel] = useState(0);
  const [dirty, setDirty] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'add' | 'overwrite' | 'replace'>('add');

  useEffect(() => { if (server.data && !dirty) setTypes(structuredClone(server.data)); }, [server.data, dirty]);
  const cur = types[sel];
  const edit = (fn: (t: EntityType) => void) => {
    setTypes((all) => { const next = structuredClone(all); fn(next[sel]!); return next; });
    setDirty(true);
  };
  const toast = useApp.getState().toast;
  const save = async () => {
    try {
      await api.put(`/worlds/${w}/entity-types`, types);
      setDirty(false);
      await qc.invalidateQueries();
      toast('Types saved');
    } catch (e) { toast((e as Error).message); }
  };
  const addType = () => {
    let slug = 'new-type'; for (let i = 2; types.some((t) => t.slug === slug); i++) slug = `new-type-${i}`;
    setTypes([...types, { id: slug, slug, name: 'New type', fields: [], bodyTemplate: '{{infobox}}\n\n## Overview\n' }]);
    setSel(types.length); setDirty(true);
  };
  const clone = () => {
    if (!cur) return;
    let slug = `${cur.slug}-copy`; for (let i = 2; types.some((t) => t.slug === slug); i++) slug = `${cur.slug}-copy-${i}`;
    setTypes([...types, { ...structuredClone(cur), id: slug, slug, name: `${cur.name} copy` }]); setSel(types.length); setDirty(true);
  };
  const remove = () => { if (cur && confirm(`Delete type "${cur.name}"? (Blocked by the server if pages use it.)`)) { setTypes(types.filter((_, i) => i !== sel)); setSel(0); setDirty(true); } };
  const exportPack = async () => {
    const pack = await api.get<object>(`/worlds/${w}/type-pack/export`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }));
    a.download = `${w}-types.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const importPack = async (f: File) => {
    try {
      const r = await api.post<{ added: string[]; updated: string[]; skipped: string[] }>(`/worlds/${w}/type-pack/import`, { pack: JSON.parse(await f.text()), mode });
      setDirty(false); await qc.invalidateQueries();
      toast(`Imported: ${r.added.length} added, ${r.updated.length} updated, ${r.skipped.length} skipped`);
    } catch (e) { toast(`Import failed: ${(e as Error).message}`); }
  };
  const moveField = (i: number, d: number) => edit((t) => { const j = i + d; if (j >= 0 && j < t.fields.length) [t.fields[i], t.fields[j]] = [t.fields[j]!, t.fields[i]!]; });

  if (!server.data) return <div className="muted">Loading…</div>;
  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="grow"><h1 className="title">Types & templates</h1><div className="muted">Define page types, their fields and body templates. Share them as type packs.</div></div>
        <select aria-label="Import mode" style={{ width: 'auto' }} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="add">Import: add new only</option><option value="overwrite">Import: overwrite same slug</option><option value="replace">Import: replace all</option>
        </select>
        <button className="btn" onClick={() => file.current?.click()}>Import pack…</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importPack(f); e.target.value = ''; }} />
        <button className="btn" onClick={() => void exportPack()}>Export pack</button>
        <button className="btn primary" disabled={!dirty} onClick={() => void save()}>{dirty ? 'Save changes' : 'Saved'}</button>
      </div>
      <div className="cols" style={{ gridTemplateColumns: '240px minmax(0,1fr)' }}>
        <aside className="card" style={{ display: 'grid', gap: 6 }}>
          {types.map((t, i) => <button key={t.slug + i} className={`btn ${i === sel ? 'primary' : ''}`} style={{ justifyContent: 'flex-start' }} onClick={() => setSel(i)}>{t.name}</button>)}
          <button className="btn ghost" onClick={addType}>＋ New type</button>
        </aside>
        {cur && (
          <section className="card" style={{ display: 'grid', gap: 12 }}>
            <div className="row">
              <label className="f grow">Name<input value={cur.name} onChange={(e) => edit((t) => { t.name = e.target.value; })} /></label>
              <label className="f grow">Slug (folder name)<input value={cur.slug} disabled={!!server.data.find((s) => s.slug === cur.slug)} onChange={(e) => edit((t) => { t.slug = slugify(e.target.value); t.id = t.slug; })} /></label>
              <button className="btn" onClick={clone}>Clone</button><button className="btn danger" onClick={remove}>Delete</button>
            </div>
            <h3 style={{ margin: 0 }}>Fields</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              {cur.fields.map((f, i) => (
                <FieldRow key={i} f={f} types={types} onChange={(fn) => edit((t) => fn(t.fields[i]!))} up={() => moveField(i, -1)} down={() => moveField(i, 1)} del={() => edit((t) => { t.fields.splice(i, 1); })} />
              ))}
              <button className="btn" onClick={() => edit((t) => { t.fields.push({ key: `field${t.fields.length + 1}`, label: 'New field', type: 'text' }); })}>＋ Add field</button>
            </div>
            <label className="f">Body template (used for new pages)
              <textarea rows={10} style={{ fontFamily: 'var(--mono)' }} value={cur.bodyTemplate} onChange={(e) => edit((t) => { t.bodyTemplate = e.target.value; })} />
            </label>
          </section>
        )}
      </div>
    </>
  );
}

function FieldRow({ f, types, onChange, up, down, del }: { f: FieldDef; types: EntityType[]; onChange: (fn: (f: FieldDef) => void) => void; up: () => void; down: () => void; del: () => void }) {
  return (
    <div className="card" style={{ padding: 10, display: 'grid', gap: 8 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="f" style={{ width: 130 }}>Key<input value={f.key} onChange={(e) => onChange((x) => { x.key = e.target.value.replace(/[^a-zA-Z0-9_]/g, ''); })} /></label>
        <label className="f" style={{ width: 160 }}>Label<input value={f.label} onChange={(e) => onChange((x) => { x.label = e.target.value; })} /></label>
        <label className="f" style={{ width: 140 }}>Type<select value={f.type} onChange={(e) => onChange((x) => { x.type = e.target.value; })}>{FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        {(f.type === 'select' || f.type === 'multiselect') && <label className="f grow">Options (comma)<input value={(f.options ?? []).join(', ')} onChange={(e) => onChange((x) => { x.options = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); })} /></label>}
        {f.type === 'relation' && (
          <>
            <label className="f" style={{ width: 150 }}>Target type<select value={f.relationTo ?? ''} onChange={(e) => onChange((x) => { x.relationTo = e.target.value || undefined; })}><option value="">any</option>{types.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}</select></label>
            <label className="f" style={{ width: 130 }}>Relation kind<input value={f.relationKind ?? ''} onChange={(e) => onChange((x) => { x.relationKind = e.target.value || undefined; })} /></label>
          </>
        )}
        <span className="grow" />
        {(f.type === 'relation') && <label className="row muted"><input type="checkbox" style={{ width: 'auto' }} checked={!!f.multiple} onChange={(e) => onChange((x) => { x.multiple = e.target.checked; })} />Multiple</label>}
        <label className="row muted"><input type="checkbox" style={{ width: 'auto' }} checked={!!f.perContinuity} onChange={(e) => onChange((x) => { x.perContinuity = e.target.checked; })} />Per continuity</label>
        <button className="btn ghost" aria-label="Move up" onClick={up}>↑</button><button className="btn ghost" aria-label="Move down" onClick={down}>↓</button><button className="btn ghost danger" aria-label="Delete field" onClick={del}>✕</button>
      </div>
    </div>
  );
}
