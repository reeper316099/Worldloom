import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, q, type InfoRow } from '../api';
import { useApp } from '../store';

interface Card { hidden: boolean; id: string; title: string; slug?: string; typeName?: string; status?: string; rows?: InfoRow[]; excerpt?: string }

/** Event handlers for a container with rendered wiki HTML; shows a spoiler-filtered (server-side) preview on link hover. */
export function useHoverCards(w: string) {
  const qc = useQueryClient();
  const [card, setCard] = useState<{ c: Card; x: number; y: number } | null>(null);
  const timer = useRef<number>();
  const mode = useApp((s) => s.mode);
  const continuity = useApp((s) => s.continuity);
  const onOver = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a.wikilink[data-target]') as HTMLAnchorElement | null;
    window.clearTimeout(timer.current);
    if (!a || !a.dataset.target || a.classList.contains('redlink')) return;
    const r = a.getBoundingClientRect();
    timer.current = window.setTimeout(async () => {
      try {
        const c = await qc.fetchQuery({ queryKey: ['card', w, a.dataset.target, mode, continuity], staleTime: 10_000, queryFn: () => api.get<Card>(`/worlds/${w}/card/${encodeURIComponent(a.dataset.target!)}${q({ mode, cont: continuity })}`) });
        if (!c.hidden) setCard({ c, x: Math.min(r.left, window.innerWidth - 340), y: r.bottom + 6 });
      } catch { /* no card */ }
    }, 280);
  };
  const onOut = () => { window.clearTimeout(timer.current); setCard(null); };
  const node = card && (
    <div className="hovercard" role="tooltip" style={{ left: card.x, top: card.y }}>
      <div className="row"><strong>{card.c.title}</strong><span className="grow" /><span className="badge">{card.c.typeName}</span></div>
      {card.c.rows?.slice(0, 3).map((r) => <div key={r.key} className="muted" style={{ fontSize: '.8rem' }}>{r.label}: {Array.isArray(r.value) ? r.value.join(', ') : String(r.value)}</div>)}
      {card.c.excerpt && <p style={{ margin: '6px 0 0', fontSize: '.88rem' }}>{card.c.excerpt}</p>}
    </div>
  );
  return { handlers: { onMouseOver: onOver, onMouseOut: onOut }, node };
}
