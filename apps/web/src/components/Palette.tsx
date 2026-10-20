import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store';
import { go, wPath } from '../router';
import { useSearch, useTypes } from '../hooks';
import { useQueryClient } from '@tanstack/react-query';

interface Item { key: string; label: string; hint?: string; run: () => void }

export function Palette({ slug }: { slug?: string }) {
  const kind = useApp((s) => s.palette);
  const close = () => useApp.getState().openPalette(null);
  if (!kind) return null;
  return <PaletteInner key={kind} kind={kind} slug={slug} close={close} />;
}

function PaletteInner({ kind, slug, close }: { kind: 'command' | 'open'; slug?: string; close: () => void }) {
  const [text, setText] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const s = useApp();
  const w = slug ?? '';
  const search = useSearch(w, text, kind === 'open' ? 'suggest' : 'search');
  const types = useTypes(w);
  useEffect(() => ref.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const nav = (path: string) => () => { close(); go(path); };
    const pages: Item[] = (search.data ?? []).map((h) => ({
      key: h.id, label: h.title, hint: h.snippet ?? (h.alias ? `alias: ${h.alias}` : h.type), run: nav(wPath(w, 'p', h.slug)),
    }));
    if (kind === 'open') return pages;
    const cmds: Item[] = [
      { key: 'home', label: 'Go to Worlds home', run: nav('/') },
      { key: 'mode', label: `Switch to ${s.mode === 'author' ? 'reader' : 'author'} mode`, hint: 'Ctrl/Cmd+Shift+S', run: () => { close(); s.toggleMode(); void qc.invalidateQueries(); } },
      { key: 'theme', label: 'Cycle theme', run: () => { close(); s.setTheme(s.theme === 'dark' ? 'light' : s.theme === 'light' ? 'system' : 'dark'); } },
      { key: 'density', label: 'Toggle compact density', run: () => { close(); s.setDensity(s.density === 'compact' ? 'comfortable' : 'compact'); } },
      { key: 'help', label: 'Keyboard shortcuts', hint: '?', run: () => { close(); s.setHelp(true); } },
    ];
    if (slug) {
      cmds.unshift({ key: 'dash', label: 'Go to world dashboard', run: nav(wPath(slug)) });
      for (const t of types.data ?? []) cmds.push({ key: 'new-' + t.slug, label: `New ${t.name}…`, run: nav(wPath(slug, 'new') + `?type=${t.slug}`) });
      if (text.trim()) cmds.push({ key: 'full', label: `Search all for “${text}”`, run: nav(wPath(slug, 'search') + `?q=${encodeURIComponent(text)}`) });
    }
    const t = text.toLowerCase();
    out.push(...cmds.filter((c) => !t || c.label.toLowerCase().includes(t)), ...pages);
    return out;
  }, [search.data, types.data, text, kind, slug, w, s, qc, close]);

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label={kind === 'open' ? 'Quick open' : 'Command palette'} onMouseDown={(e) => e.stopPropagation()}>
        <input ref={ref} value={text} placeholder={kind === 'open' ? 'Open page…' : 'Type a command or search… (type:character tag:x cont:wn)'} aria-label="Search"
          onChange={(e) => { setText(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') items[sel]?.run();
          }} />
        <div className="list" role="listbox">
          {items.slice(0, 40).map((it, i) => (
            <div key={it.key} role="option" aria-selected={i === sel} className={`item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={it.run}>
              <strong>{it.label}</strong>
              {it.hint && <span className="snip">{it.hint}</span>}
            </div>
          ))}
          {!items.length && <div className="item muted">No results</div>}
        </div>
      </div>
    </div>
  );
}
