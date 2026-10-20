import { useRoute } from '../router';

const ITEMS: Array<[string, string]> = [['', 'Overview'], ['graph', 'Graph'], ['tree', 'Trees'], ['timeline', 'Timeline'], ['tiers', 'Tiers'], ['compare', 'Compare'], ['boards', 'Tier lists'], ['canon', 'Canon'], ['types', 'Types']];

export function WorldNav({ slug }: { slug: string }) {
  const { path } = useRoute();
  const cur = path[2] && path[2] !== 'p' ? path[2] : path[2] === 'p' ? '__page' : '';
  return (
    <nav className="subnav" aria-label="World sections">
      {ITEMS.map(([k, label]) => <a key={k} href={`#/w/${slug}${k ? '/' + k : ''}`} className={cur === k ? 'on' : ''} aria-current={cur === k ? 'page' : undefined}>{label}</a>)}
    </nav>
  );
}
