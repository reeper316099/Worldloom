import { useSearch } from '../hooks';

export function SearchScreen({ w, text }: { w: string; text: string }) {
  const { data, isFetching } = useSearch(w, text);
  return (
    <>
      <h1 className="title">Search</h1>
      <div className="muted" style={{ marginBottom: 16 }}>{isFetching ? 'Searching…' : `${data?.length ?? 0} result(s) for “${text}”`}</div>
      <div style={{ display: 'grid', gap: 10 }}>
        {data?.map((h) => (
          <a key={h.id} className="card" href={`#/w/${w}/p/${h.slug}`}>
            <strong>{h.title}</strong> <span className="badge">{h.type}</span>
            <div className="muted">{h.snippet}</div>
          </a>
        ))}
      </div>
    </>
  );
}
