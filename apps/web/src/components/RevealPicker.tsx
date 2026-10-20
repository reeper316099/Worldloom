import type { World } from '../api';

export type Reveal = { sourceId: string; at: number } | { arcId: string };

/** Pick a spoiler gate: none, "source + chapter/episode", or "arc". */
export function RevealPicker({ world, value, onChange, label = 'Gate' }: { world: World; value?: Reveal; onChange: (r?: Reveal) => void; label?: string }) {
  const kind = !value ? 'none' : 'arcId' in value ? 'arc' : 'source';
  const set = (k: string) => {
    if (k === 'none') onChange(undefined);
    else if (k === 'arc') onChange(world.arcs[0] ? { arcId: world.arcs[0].id } : undefined);
    else if (world.sources[0]) onChange({ sourceId: world.sources[0].id, at: 1 });
  };
  const unit = value && 'sourceId' in value ? world.sources.find((s) => s.id === value.sourceId)?.units.label : undefined;
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
      <select aria-label={`${label} type`} style={{ width: 'auto' }} value={kind} onChange={(e) => set(e.target.value)}>
        <option value="none">No gate</option><option value="source">Source + position</option><option value="arc">Arc</option>
      </select>
      {value && 'sourceId' in value && (
        <>
          <select aria-label={`${label} source`} style={{ width: 'auto' }} value={value.sourceId} onChange={(e) => onChange({ ...value, sourceId: e.target.value })}>
            {world.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input aria-label={`${label} ${unit ?? 'position'}`} type="number" min={0} style={{ width: 80 }} value={value.at} onChange={(e) => onChange({ ...value, at: Number(e.target.value) })} />
          <span className="muted">{unit?.toLowerCase()}</span>
        </>
      )}
      {value && 'arcId' in value && (
        <select aria-label={`${label} arc`} style={{ width: 'auto' }} value={value.arcId} onChange={(e) => onChange({ arcId: e.target.value })}>
          {[...world.arcs].sort((a, b) => a.order - b.order).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      )}
    </div>
  );
}
