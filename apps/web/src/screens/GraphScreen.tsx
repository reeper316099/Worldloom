import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { circular } from 'graphology-layout';
import Sigma from 'sigma';
import { EdgeArrowProgram } from 'sigma/rendering';
import { api, q, type Hit } from '../api';
import { useMode, useWorld } from '../hooks';
import { go, wPath } from '../router';
import { PagePicker } from '../components/PagePicker';

interface GNode { id: string; title: string; slug: string; type: string; degree: number }
interface GEdge { id: string; from: string; to: string; kind: string; label?: string }
interface GData { nodes: GNode[]; edges: GEdge[]; kinds: string[] }

export const PALETTE = ['#7c5cff', '#38bdf8', '#3ddc97', '#f5b84a', '#ff6b81', '#f0a5ff', '#f08a4b', '#9aa0b8', '#22d3ee', '#a3e635'];
const KIND_COLORS: Record<string, string> = { family: '#f5b84a', ally: '#3ddc97', enemy: '#ff6b81', master_student: '#38bdf8', romantic: '#f0a5ff', subordinate: '#9aa0b8', rival: '#f08a4b' };
const colorFor = (i: number) => PALETTE[i % PALETTE.length]!;
export const kindColor = (k: string) => KIND_COLORS[k] ?? colorFor([...k].reduce((a, c) => a + c.charCodeAt(0), 0));

export function GraphScreen({ w }: { w: string }) {
  const { mode, continuity } = useMode();
  const { data: world } = useWorld(w);
  const [focus, setFocus] = useState<Hit | null>(null);
  const [hops, setHops] = useState(2);
  const [arc, setArc] = useState('');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma>();
  const graphRef = useRef<Graph>();
  const { data, isLoading } = useQuery({
    queryKey: ['graph', w, mode, continuity, focus?.id, hops, arc],
    queryFn: () => api.get<GData>(`/worlds/${w}/graph${q({ mode, cont: continuity, focus: focus?.id, hops: focus ? hops : undefined, arc })}`),
  });
  const types = useMemo(() => [...new Set(data?.nodes.map((n) => n.type))].sort(), [data]);
  const stateRef = useRef({ hiddenTypes, hiddenKinds, search, sel });
  stateRef.current = { hiddenTypes, hiddenKinds, search, sel };

  useEffect(() => {
    if (!data || !host.current) return;
    const g = new Graph({ multi: true, type: 'directed' });
    for (const n of data.nodes) g.addNode(n.id, { label: n.title, size: 4 + Math.min(14, Math.sqrt(n.degree) * 3), color: colorFor(types.indexOf(n.type)), etype: n.type, x: 0, y: 0 });
    for (const e of data.edges) if (g.hasNode(e.from) && g.hasNode(e.to)) g.addEdgeWithKey(e.id, e.from, e.to, { label: e.label ?? e.kind, kind: e.kind, color: kindColor(e.kind), size: 1.5, type: 'arrow' });
    if (g.order > 1) {
      circular.assign(g);
      forceAtlas2.assign(g, { iterations: g.order > 400 ? 80 : 250, settings: { ...forceAtlas2.inferSettings(g), slowDown: 4, barnesHutOptimize: g.order > 200 } });
    }
    graphRef.current = g;
    const s = new Sigma(g, host.current, {
      renderEdgeLabels: g.size < 50, defaultEdgeType: 'arrow', edgeProgramClasses: { arrow: EdgeArrowProgram },
      labelColor: { color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#ddd' },
      edgeLabelColor: { color: '#9094ad' }, labelDensity: 0.6, labelRenderedSizeThreshold: g.order > 300 ? 8 : 3,
      nodeReducer: (id, a) => {
        const st = stateRef.current;
        const res = { ...a };
        if (st.hiddenTypes.has(a.etype as string)) res.hidden = true;
        const term = st.search.trim().toLowerCase();
        if (term) { if (String(a.label).toLowerCase().includes(term)) { res.highlighted = true; res.forceLabel = true; } else res.color = '#444a60'; }
        if (st.sel === id) { res.highlighted = true; res.forceLabel = true; }
        return res;
      },
      edgeReducer: (_e, a) => (stateRef.current.hiddenKinds.has(a.kind as string) ? { ...a, hidden: true } : a),
    });
    s.on('clickNode', ({ node }) => setSel(node));
    s.on('clickStage', () => setSel(null));
    s.on('doubleClickNode', ({ node, preventSigmaDefault }) => { preventSigmaDefault(); setFocus({ id: node, title: g.getNodeAttribute(node, 'label'), slug: '', type: '' }); });
    sigmaRef.current = s;
    return () => { s.kill(); sigmaRef.current = undefined; };
  }, [data, types]);
  useEffect(() => { sigmaRef.current?.refresh(); }, [hiddenTypes, hiddenKinds, search, sel]);

  const toggle = (set: Set<string>, k: string, f: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); f(n); };
  const node = data?.nodes.find((n) => n.id === sel);

  const exportPng = () => {
    const s = sigmaRef.current; if (!s) return;
    const layers = s.getCanvases();
    const c = document.createElement('canvas');
    const { width, height } = s.getDimensions();
    c.width = width * 2; c.height = height * 2;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#151722';
    ctx.fillRect(0, 0, c.width, c.height);
    for (const k of ['edges', 'edgeLabels', 'nodes', 'labels'] as const) if (layers[k]) ctx.drawImage(layers[k], 0, 0, c.width, c.height);
    c.toBlob((b) => b && download(b, `${w}-graph.png`));
  };
  const exportSvg = () => {
    const s = sigmaRef.current, g = graphRef.current; if (!s || !g) return;
    const { width, height } = s.getDimensions();
    const P = (id: string) => s.graphToViewport({ x: g.getNodeAttribute(id, 'x'), y: g.getNodeAttribute(id, 'y') });
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const lines = g.edges().filter((e) => !hiddenKinds.has(g.getEdgeAttribute(e, 'kind'))).map((e) => { const a = P(g.source(e)), b = P(g.target(e)); return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${g.getEdgeAttribute(e, 'color')}" stroke-width="1.2"/>`; });
    const dots = g.nodes().filter((n) => !hiddenTypes.has(g.getNodeAttribute(n, 'etype'))).map((n) => { const p = P(n); return `<circle cx="${p.x}" cy="${p.y}" r="${g.getNodeAttribute(n, 'size')}" fill="${g.getNodeAttribute(n, 'color')}"/><text x="${p.x + 8}" y="${p.y + 4}" font-size="11" font-family="sans-serif" fill="#ddd">${esc(g.getNodeAttribute(n, 'label'))}</text>`; });
    download(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#151722"/>${lines.join('')}${dots.join('')}</svg>`], { type: 'image/svg+xml' }), `${w}-graph.svg`);
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <h1 className="title grow" style={{ fontSize: '1.6rem' }}>Relationship graph</h1>
        <div style={{ width: 220 }}><PagePicker w={w} placeholder="Focus on a page…" onPick={(h) => setFocus(h)} /></div>
        {focus && <><span className="pill" onClick={() => setFocus(null)}>✕ {focus.title}</span><select aria-label="Hops" style={{ width: 'auto' }} value={hops} onChange={(e) => setHops(Number(e.target.value))}>{[1, 2, 3, 4].map((h) => <option key={h} value={h}>{h} hop{h > 1 ? 's' : ''}</option>)}</select></>}
        {world && world.arcs.length > 0 && <select aria-label="As of arc" style={{ width: 'auto' }} value={arc} onChange={(e) => setArc(e.target.value)}><option value="">All time</option>{[...world.arcs].sort((a, b) => a.order - b.order).map((a) => <option key={a.id} value={a.id}>As of: {a.name}</option>)}</select>}
        <input aria-label="Search in graph" placeholder="Search in graph…" style={{ width: 170 }} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn" onClick={exportPng}>PNG</button><button className="btn" onClick={exportSvg}>SVG</button>
      </div>
      <div className="row" style={{ marginBottom: 10, alignItems: 'flex-start', gap: 24 }}>
        <div className="chips" aria-label="Types">{types.map((t, i) => <span key={t} role="button" tabIndex={0} className={`chip ${hiddenTypes.has(t) ? 'off' : ''}`} onClick={() => toggle(hiddenTypes, t, setHiddenTypes)}><i style={{ background: colorFor(i) }} />{t}</span>)}</div>
        <div className="chips" aria-label="Relation kinds">{data?.kinds.map((k) => <span key={k} role="button" tabIndex={0} className={`chip ${hiddenKinds.has(k) ? 'off' : ''}`} onClick={() => toggle(hiddenKinds, k, setHiddenKinds)}><i style={{ background: kindColor(k) }} />{k}</span>)}</div>
      </div>
      <div className="graph-wrap">
        <div className="graph-canvas" ref={host} role="img" aria-label="Relationship graph" />
        <aside className="card" style={{ overflow: 'auto' }}>
          <div className="muted" style={{ fontSize: '.8rem' }}>{isLoading ? 'Loading…' : `${data?.nodes.length ?? 0} nodes · ${data?.edges.length ?? 0} edges`}</div>
          {data && data.nodes.length === 0 && <p className="muted">Nothing to show at your current progress.</p>}
          {node ? (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: '0 0 4px' }}>{node.title}</h3><span className="badge">{node.type}</span>
              <ul style={{ paddingLeft: 18 }}>{data!.edges.filter((e) => e.from === node.id || e.to === node.id).map((e) => { const other = data!.nodes.find((n) => n.id === (e.from === node.id ? e.to : e.from))!; return <li key={e.id}><span style={{ color: kindColor(e.kind) }}>{e.label ?? e.kind}</span> {e.from === node.id ? '→' : '←'} <a href={`#/w/${w}/p/${other.slug}`}>{other.title}</a></li>; })}</ul>
              <div className="row"><button className="btn" onClick={() => go(wPath(w, 'p', node.slug))}>Open page</button><button className="btn" onClick={() => setFocus({ id: node.id, title: node.title, slug: node.slug, type: node.type })}>Focus here</button></div>
            </div>
          ) : <p className="muted">Click a node for details; double-click to focus its neighbourhood. Scroll to zoom, drag to pan.</p>}
        </aside>
      </div>
    </>
  );
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
