import { useEffect, useState } from 'react';

export interface Route { path: string[]; query: URLSearchParams }
function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [p = '', qs = ''] = h.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}
export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => { const f = () => setR(parse()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return r;
}
export const go = (path: string) => { location.hash = path.startsWith('#') ? path : '#' + path; };
export const wPath = (w: string, ...rest: string[]) => `/w/${w}${rest.length ? '/' + rest.join('/') : ''}`;
