import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { autocompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { vim } from '@replit/codemirror-vim';
import { api, q, type Hit } from '../api';

const SNIPPETS: Completion[] = [
  { label: '/infobox', detail: 'Insert infobox', apply: '{{infobox}}\n' },
  { label: '/toc', detail: 'Table of contents', apply: '{{toc}}\n' },
  { label: '/embed', detail: 'Embed a page section', apply: '{{embed: Page#Section}}\n' },
  { label: '/cite', detail: 'Citation chip', apply: '{{src: Source ch 1}}' },
  { label: '/claim', detail: 'Claim marker', apply: '{{claim: confirmed}}text{{/claim}}' },
  { label: '/continuity', detail: 'Continuity block', apply: ':::continuity{ids="wn"}\ntext\n:::\n' },
  { label: '/diff', detail: 'Continuity diff block', apply: ':::diff\n:::continuity{ids="wn"}\nIn the web novel…\n:::\n:::continuity{ids="adaptation"}\nIn the adaptation…\n:::\n:::\n' },
  { label: '/spoiler', detail: 'Spoiler block', apply: ':::spoiler{src="wn" at=1}\nhidden text\n:::\n' },
  { label: '/callout', detail: 'Callout', apply: ':::callout{type="note"}\ntext\n:::\n' },
];

export function CodeEditor(props: { value: string; world: string; onChange: (v: string) => void; vimMode: boolean; spell: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const cb = useRef(props.onChange);
  cb.current = props.onChange;
  const vimC = useRef(new Compartment());
  const spellC = useRef(new Compartment());

  useEffect(() => {
    const links = async (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^\]\n]*$/);
      if (!m) return null;
      const text = m.text.slice(2);
      const hits = await api.get<Hit[]>(`/worlds/${props.world}/suggest${q({ mode: 'author', q: text })}`).catch(() => [] as Hit[]);
      return {
        from: m.from + 2, filter: false,
        options: hits.map((h): Completion => ({ label: h.title, detail: h.alias ? `alias “${h.alias}”` : h.type, apply: (v, _c, from, to) => {
          const after = v.state.sliceDoc(to, to + 2) === ']]' ? 2 : 0;
          v.dispatch({ changes: { from, to: to + after, insert: `${h.title}]]` }, selection: { anchor: from + h.title.length + 2 } });
        } })),
      };
    };
    const slash = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/(?:^|\s)\/\w*$/);
      if (!m) return null;
      const from = m.from + (m.text.startsWith('/') ? 0 : 1);
      return { from, options: SNIPPETS };
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          vimC.current.of(props.vimMode ? vim() : []),
          spellC.current.of(EditorView.contentAttributes.of({ spellcheck: String(props.spell) })),
          lineNumbers(), history(), markdown(), EditorView.lineWrapping, placeholder('Write in Markdown. Type [[ to link, / for blocks.'),
          autocompletion({ override: [links, slash] }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current(u.state.doc.toString()); }),
          EditorView.theme({ '&': { color: 'var(--text)', fontSize: '14px' }, '.cm-gutters': { background: 'transparent', color: 'var(--text-muted)', border: 0 }, '.cm-cursor': { borderLeftColor: 'var(--text)' }, '.cm-activeLine': { background: 'transparent' }, '.cm-tooltip': { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }, '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--primary)', color: '#fff' } }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.world]);

  useEffect(() => { view.current?.dispatch({ effects: vimC.current.reconfigure(props.vimMode ? vim() : []) }); }, [props.vimMode]);
  useEffect(() => { view.current?.dispatch({ effects: spellC.current.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(props.spell) })) }); }, [props.spell]);
  return <div ref={host} style={{ height: '100%' }} />;
}
