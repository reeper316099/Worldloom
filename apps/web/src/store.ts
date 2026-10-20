import { create } from 'zustand';

type ThemePref = 'dark' | 'light' | 'system';
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
interface S {
  theme: ThemePref; density: 'comfortable' | 'compact'; mode: 'author' | 'reader'; continuity?: string; focus: boolean;
  palette: null | 'command' | 'open'; help: boolean; progress: boolean; setProgress(b: boolean): void; toasts: Toast[];
  setTheme(t: ThemePref): void; setDensity(d: 'comfortable' | 'compact'): void; toggleMode(): void; setContinuity(c?: string): void;
  openPalette(p: S['palette']): void; setHelp(b: boolean): void; toggleFocus(): void; toast(text: string, action?: Toast['action']): void;
}
let n = 0;
export const useApp = create<S>((set, get) => ({
  theme: load('wl.theme', 'dark'), density: load('wl.density', 'comfortable'), mode: load('wl.mode', 'author'), continuity: undefined, focus: false,
  palette: null, help: false, progress: false, setProgress: (progress) => set({ progress }), toasts: [],
  setTheme: (theme) => { save('wl.theme', theme); set({ theme }); },
  setDensity: (density) => { save('wl.density', density); set({ density }); },
  toggleMode: () => { const mode = get().mode === 'author' ? 'reader' : 'author'; save('wl.mode', mode); set({ mode }); },
  setContinuity: (continuity) => set({ continuity }),
  openPalette: (palette) => set({ palette }), setHelp: (help) => set({ help }), toggleFocus: () => set((s) => ({ focus: !s.focus })),
  toast: (text, action) => {
    const id = ++n;
    set((s) => ({ toasts: [...s.toasts, { id, text, action }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 8000);
  },
}));
