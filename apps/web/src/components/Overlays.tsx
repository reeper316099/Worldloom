import { useApp } from '../store';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && <button className="btn" onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

export function Help() {
  const { help, setHelp } = useApp();
  if (!help) return null;
  const rows: Array<[string, string]> = [
    ['Ctrl/Cmd+K', 'Command palette & search'], ['Ctrl/Cmd+P', 'Quick open page'], ['Ctrl/Cmd+E', 'Edit / preview'],
    ['Ctrl/Cmd+Shift+S', 'Author / reader (spoiler) mode'], ['G / T', 'Graph / timeline'], ['[  ]', 'Back / forward'], ['?', 'This help'],
  ];
  return (
    <div className="overlay" onClick={() => setHelp(false)}>
      <div className="dialog help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0 }}>Keyboard shortcuts</h3>
        <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt> <dd>{v}</dd></div>)}</dl>
      </div>
    </div>
  );
}
