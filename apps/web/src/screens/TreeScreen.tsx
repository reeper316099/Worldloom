import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, q } from '../api';
import { useMode, useTypes } from '../hooks';

interface TNode { id: string; title: string; slug: string; type: string; children: TNode[] }

/** Hierarchies: location trees, org charts and family/mentor trees from relation fields or relation kinds. */
export function TreeScreen({ w }: { w: string }) {
  const { mode, continuity } = useMode();
  const types = useTypes(w);
  const sources = (types.data ?? []).flatMap((t) => t.fields.filter((f) => f.type === 'relation').map((f) => ({ key: `field:${t.slug}:${f.key}`, label: `${t.name} → ${f.label}`, type: t.slug, field: f.key })));
  const kinds = [...new Set((types.data ?? []).flatMap((t) => t.fields.filter((f) => f.type === 'relation' && f.relationKind).map((f) => f.relationKind!)))];
  const [choice, setChoice] = useState('');
  const sel = choice || sources.find((s) => s.type === 'location' && s.field === 'region')?.key || sources[0]?.key || '';
  const [kind, field] = sel.startsWith('kind:') ? [sel.slice(5), ''] : ['', sources.find((s) => s.key === sel)?.field ?? ''];
  const type = sources.find((s) => s.key === sel)?.type;
  const { data } = useQuery({
    queryKey: ['tree', w, mode, continuity, sel], enabled: !!sel,
    queryFn: () => api.get<{ roots: TNode[]; count: number }>(`/worlds/${w}/tree${q({ mode, cont: continuity, field: field || undefined, type: field ? type : undefined, kind: kind || undefined })}`),
  });
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 className="title grow" style={{ fontSize: '1.6rem' }}>Trees & hierarchies</h1>
        <select aria-label="Tree source" style={{ width: 'auto' }} value={sel} onChange={(e) => setChoice(e.target.value)}>
          <optgroup label="Parent pointer (child → parent)">{sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
          <optgroup label="Relation kind (A kind B: B is the parent)">{kinds.map((k) => <option key={k} value={`kind:${k}`}>{k}</option>)}</optgroup>
        </select>
      </div>
      <div className="card tree">
        {data && data.roots.length === 0 && <div className="muted">No hierarchy found at your current progress.</div>}
        <ul>{data?.roots.map((n) => <Branch key={n.id} n={n} w={w} depth={0} />)}</ul>
      </div>
    </>
  );
}
function Branch({ n, w, depth }: { n: TNode; w: string; depth: number }) {
  const [open, setOpen] = useState(depth < 3);
  return (
    <li>
      <span className="twisty" role="button" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>{n.children.length ? (open ? '▾' : '▸') : ''}</span>
      <a href={`#/w/${w}/p/${n.slug}`}>{n.title}</a> <span className="muted" style={{ fontSize: '.78rem' }}>{n.type}{n.children.length ? ` · ${n.children.length}` : ''}</span>
      {open && n.children.length > 0 && <ul>{n.children.map((c) => <Branch key={c.id} n={c} w={w} depth={depth + 1} />)}</ul>}
    </li>
  );
}
