import { useState } from 'react';
import { useSearch } from '../hooks';
import type { Hit } from '../api';

/** Type-ahead picker for pages (spoiler-filtered by the server via /suggest). */
export function PagePicker({ w, onPick, placeholder = 'Add a page…' }: { w: string; onPick: (h: Hit) => void; placeholder?: string }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useSearch(w, text, 'suggest');
  return (
    <div style={{ position: 'relative' }}>
      <input aria-label={placeholder} placeholder={placeholder} value={text} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setText(e.target.value); setOpen(true); }} />
      {open && text.trim() && (
        <div className="card" style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', padding: 4, maxHeight: 260, overflow: 'auto' }}>
          {data?.map((h) => (
            <div key={h.id} className="item" style={{ padding: '6px 10px', cursor: 'pointer' }} onMouseDown={() => { onPick(h); setText(''); }}>
              {h.title} <span className="muted">· {h.type}{h.alias ? ` · ${h.alias}` : ''}</span>
            </div>
          ))}
          {!data?.length && <div className="muted" style={{ padding: 8 }}>No matches</div>}
        </div>
      )}
    </div>
  );
}
