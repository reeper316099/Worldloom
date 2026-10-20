import { Component, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApp } from './store';
import { go, useRoute } from './router';
import { useLiveEvents, useWorld } from './hooks';
import { Home } from './screens/Home';
import { Dashboard } from './screens/Dashboard';
import { PageScreen } from './screens/PageScreen';
import { EditorScreen } from './screens/EditorScreen';
import { NewPage } from './screens/NewPage';
import { SearchScreen } from './screens/SearchScreen';
import { TypesScreen } from './screens/TypesScreen';
import { CanonScreen } from './screens/CanonScreen';
import { CompareScreen } from './screens/CompareScreen';
import { GraphScreen } from './screens/GraphScreen';
import { TreeScreen } from './screens/TreeScreen';
import { TimelineScreen } from './screens/TimelineScreen';
import { TiersScreen } from './screens/TiersScreen';
import { CompareManyScreen } from './screens/CompareManyScreen';
import { BoardsScreen } from './screens/BoardsScreen';
import { WorldNav } from './components/WorldNav';
import { DataScreen } from './screens/DataScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Palette } from './components/Palette';
import { Toasts, Help } from './components/Overlays';
import { ProgressPanel } from './components/ProgressPanel';
import { UnlockDialog } from './components/UnlockDialog';

function useTheme() {
  const theme = useApp((s) => s.theme);
  const density = useApp((s) => s.density);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (document.documentElement.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { document.documentElement.dataset.density = density; }, [density]);
}

/** Per-world theming: accent overrides --primary and reading font. */
function useWorldTheme(slug?: string) {
  const { data } = useWorld(slug ?? '');
  useEffect(() => {
    const st = document.documentElement.style;
    if (slug && data) {
      st.setProperty('--primary', data.accent);
      document.documentElement.dataset.read = data.theme.readingFont;
    } else {
      st.removeProperty('--primary');
      delete document.documentElement.dataset.read;
    }
  }, [slug, data]);
}

function useHotkeys(slug?: string) {
  const s = useApp();
  const qc = useQueryClient();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const t = e.target as HTMLElement;
      const typing = t.matches('input, textarea, select') || t.closest('.cm-editor');
      const k = e.key.toLowerCase();
      if (mod && k === 'k') { e.preventDefault(); s.openPalette('command'); }
      else if (mod && k === 'p' && slug) { e.preventDefault(); s.openPalette('open'); }
      else if (mod && e.shiftKey && k === 's') { e.preventDefault(); s.toggleMode(); void qc.invalidateQueries(); }
      else if (mod && k === 'e' && slug) {
        e.preventDefault();
        const h = location.hash;
        if (/\/edit$/.test(h)) go(h.replace(/\/edit$/, ''));
        else if (/\/p\/[^/]+$/.test(h)) go(h + '/edit');
      } else if (!typing && e.key === '?') s.setHelp(true);
      else if (!typing && slug && !mod && k === 'g') go(`/w/${slug}/graph`);
      else if (!typing && slug && !mod && k === 't') go(`/w/${slug}/timeline`);
      else if (!typing && e.key === '[') history.back();
      else if (!typing && e.key === ']') history.forward();
      else if (e.key === 'Escape') { s.openPalette(null); s.setHelp(false); s.setProgress(false); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [s, qc, slug]);
}

function ProgressDialog({ slug }: { slug?: string }) {
  const open = useApp((s) => s.progress);
  const { data: world } = useWorld(slug ?? '');
  if (!open || !slug || !world) return null;
  return (
    <div className="overlay" onMouseDown={() => useApp.getState().setProgress(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="My progress" onMouseDown={(e) => e.stopPropagation()}>
        <ProgressPanel w={slug} world={world} />
        <div className="row"><span className="grow" /><button className="btn" onClick={() => useApp.getState().setProgress(false)}>Done</button></div>
      </div>
    </div>
  );
}

/** A crashing screen should never blank the whole app. */
class Boundary extends Component<{ children: ReactNode; resetKey: string }, { err?: Error; key: string }> {
  state: { err?: Error; key: string } = { key: this.props.resetKey };
  static getDerivedStateFromError(err: Error) { return { err }; }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { key: string }) { return p.resetKey !== s.key ? { err: undefined, key: p.resetKey } : null; }
  render() {
    return this.state.err ? <div className="card" role="alert"><h3>Something went wrong on this screen</h3><pre className="muted" style={{ whiteSpace: 'pre-wrap' }}>{this.state.err.message}</pre><a className="btn" href="#/">Back to worlds</a></div> : this.props.children;
  }
}

export function App() {
  const route = useRoute();
  const { mode, toggleMode, setTheme, theme, focus, continuity } = useApp();
  const qc = useQueryClient();
  const slug = route.path[0] === 'w' ? route.path[1] : undefined;
  useTheme();
  useWorldTheme(slug);
  useHotkeys(slug);
  useLiveEvents();
  // native menu actions from the Electron shell
  useEffect(() => window.worldloomDesktop?.onMenu?.((a) => {
    const st = useApp.getState();
    if (a === 'home') go('/'); else if (a === 'settings') go('/settings'); else if (a === 'palette') st.openPalette('command'); else if (a === 'help') st.setHelp(true);
    else if (a === 'toggle-spoiler') { st.toggleMode(); void qc.invalidateQueries(); }
  }), [qc]);
  useEffect(() => { useApp.getState().setContinuity(undefined); }, [slug]);
  const { data: world } = useWorld(slug ?? '');

  let screen;
  const [, , kind, ref, extra] = route.path;
  if (route.path[0] === 'settings') screen = <SettingsScreen />;
  else if (!slug) screen = <Home />;
  else if (kind === 'p' && ref && extra === 'compare') screen = <CompareScreen w={slug} ref_={ref} />;
  else if (kind === 'p' && ref && extra === 'edit') screen = <EditorScreen w={slug} ref_={ref} />;
  else if (kind === 'p' && ref) screen = <PageScreen w={slug} ref_={ref} />;
  else if (kind === 'new') screen = <NewPage w={slug} title={route.query.get('title') ?? ''} />;
  else if (kind === 'graph') screen = <GraphScreen w={slug} />;
  else if (kind === 'tree') screen = <TreeScreen w={slug} />;
  else if (kind === 'timeline') screen = <TimelineScreen w={slug} />;
  else if (kind === 'tiers') screen = <TiersScreen w={slug} />;
  else if (kind === 'compare') screen = <CompareManyScreen w={slug} />;
  else if (kind === 'boards') screen = <BoardsScreen w={slug} id={ref} />;
  else if (kind === 'data') screen = <DataScreen w={slug} />;
  else if (kind === 'canon') screen = <CanonScreen w={slug} />;
  else if (kind === 'types') screen = <TypesScreen w={slug} />;
  else if (kind === 'search') screen = <SearchScreen w={slug} text={route.query.get('q') ?? ''} />;
  else screen = <Dashboard w={slug} />;

  return (
    <div className={`shell ${focus ? 'focus' : ''}`}>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <header className="topbar">
        <a className="brand" href="#/">Worldloom</a>
        {slug && (
          <nav className="crumbs">
            <span>/</span>
            <a href={`#/w/${slug}`}>{world?.name ?? slug}</a>
          </nav>
        )}
        <span className="grow" />
        {slug && world && world.continuities.length > 1 && (
          <select aria-label="Continuity" style={{ width: 'auto' }} value={continuity ?? ''} onChange={(e) => useApp.getState().setContinuity(e.target.value || undefined)}>
            <option value="">All continuities</option>
            {world.continuities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {slug && <button className="btn ghost" onClick={() => useApp.getState().setProgress(true)}>Progress</button>}
        <a className="btn ghost" href="#/settings" aria-label="Settings">⚙</a>
        <button className="btn ghost" onClick={() => useApp.getState().openPalette('command')} aria-label="Open command palette">⌘K</button>
        <button className={`pill ${mode}`} title="Toggle spoiler mode (Ctrl/Cmd+Shift+S)" onClick={() => { toggleMode(); void qc.invalidateQueries(); }}>
          {mode === 'author' ? '✎ Author mode' : '👁 Reader mode'}
        </button>
        <button className="btn ghost" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}>
          {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥'}
        </button>
      </header>
      {slug ? <WorldNav slug={slug} /> : <div />}
      <main className="main" id="main" tabIndex={-1}><div className="wrap"><Boundary resetKey={location.hash}>{screen}</Boundary></div></main>
      <Palette slug={slug} />
      <Help />
      <ProgressDialog slug={slug} />
      <UnlockDialog />
      <Toasts />
    </div>
  );
}
