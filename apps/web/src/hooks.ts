import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, q, type EntityType, type ListItem, type World, type WorldSummary, type Hit } from './api';
import { useApp } from './store';

export const useWorlds = () => useQuery({ queryKey: ['worlds'], queryFn: () => api.get<WorldSummary[]>('/worlds') });
export const useWorld = (w: string) => useQuery({ queryKey: ['world', w], queryFn: () => api.get<World>(`/worlds/${w}`) });
export const useTypes = (w: string) => useQuery({ queryKey: ['types', w], queryFn: () => api.get<EntityType[]>(`/worlds/${w}/entity-types`) });

/** Everything that depends on spoiler mode is keyed by it, so toggling refetches. */
export function useMode() {
  const mode = useApp((s) => s.mode);
  const continuity = useApp((s) => s.continuity);
  return { mode, continuity };
}
export const useList = (w: string, params: Record<string, string | number | undefined> = {}) => {
  const { mode } = useMode();
  return useQuery({ queryKey: ['list', w, mode, params], queryFn: () => api.get<{ total: number; items: ListItem[] }>(`/worlds/${w}/pages${q({ mode, ...params })}`) });
};
export const useSearch = (w: string, text: string, kind: 'search' | 'suggest' = 'search') => {
  const { mode } = useMode();
  return useQuery({
    queryKey: [kind, w, mode, text], enabled: kind === 'search' ? text.trim().length > 0 : true,
    queryFn: () => api.get<Hit[]>(`/worlds/${w}/${kind}${q({ mode, q: text })}`), placeholderData: (p) => p,
  });
};

/** Live-refresh queries when files change on disk or in another window (SSE). */
export function useLiveEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const cfg = window.worldloom ?? { baseUrl: '', token: 'dev-token' };
    const es = new EventSource(`${cfg.baseUrl}/api/v1/events?access_token=${cfg.token}`);
    es.onmessage = () => { void qc.invalidateQueries(); };
    return () => es.close();
  }, [qc]);
}
