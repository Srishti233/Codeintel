'use client';
import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Source, streamChat } from '@/lib/api';

interface Msg { role: 'user' | 'assistant'; content: string; sources?: Source[]; error?: boolean }

// [path:10-20] → markdown link that the custom <a> renderer turns into an "open in explorer" action
const linkCitations = (s: string) =>
  s.replace(/\[([\w./@()\[\]-]+):(\d+)(?:-(\d+))?\]/g, (_m, p, a, b) => `[${p}:${a}${b ? '-' + b : ''}](cite://${p}#${a})`);

function Code({ children, className }: { children?: React.ReactNode; className?: string }) {
  const text = String(children ?? '');
  if (!className && !text.includes('\n')) return <code>{children}</code>;
  return (
    <div className="relative group">
      <button onClick={() => navigator.clipboard.writeText(text)} className="absolute right-2 top-2 text-xs bg-line px-2 rounded opacity-0 group-hover:opacity-100">copy</button>
      <pre className="bg-bg border border-line rounded p-3 overflow-auto text-sm"><code>{text}</code></pre>
    </div>
  );
}

export default function Chat({ repoId, ready, onOpen }: { repoId: string; ready: boolean; onOpen: (path: string, line: number) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const conv = useRef<string | undefined>();
  const ac = useRef<AbortController | null>(null);

  async function send() {
    const q = input.trim(); if (!q || busy) return;
    setInput(''); setBusy(true);
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    const patch = (f: (m: Msg) => Msg) => setMsgs((all) => all.map((m, i) => (i === all.length - 1 ? f(m) : m)));
    ac.current = new AbortController();
    try {
      await streamChat(repoId, q, conv.current, (ev, d) => {
        if (ev === 'conversation') conv.current = d.id;
        if (ev === 'sources') patch((m) => ({ ...m, sources: d }));
        if (ev === 'token') patch((m) => ({ ...m, content: m.content + d }));
        if (ev === 'error') patch((m) => ({ ...m, content: m.content + `\n\n**Error:** ${d.message}`, error: true }));
      }, ac.current.signal);
    } catch (e) { if ((e as Error).name !== 'AbortError') patch((m) => ({ ...m, content: `**Error:** ${(e as Error).message}`, error: true })); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {msgs.length === 0 && <p className="text-slate-400 text-sm">Ask about architecture, a function, a bug, or “plan: add JWT auth”. Answers cite file and line ranges from the retrieved code.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'bg-panel border border-line rounded p-3' : ''}>
            {m.role === 'user' ? m.content : (
              <>
                <div className="md text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={(u) => u}
                    components={{
                      code: Code as never,
                      pre: ({ children }) => <>{children}</>,
                      a: ({ href, children }) => href?.startsWith('cite://')
                        ? <button className="text-accent underline" onClick={() => { const [p, l] = href.slice(7).split('#'); onOpen(decodeURIComponent(p), Number(l)); }}>{children}</button>
                        : <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">{children}</a>,
                    }}>{linkCitations(m.content) || (busy && i === msgs.length - 1 ? '…' : '')}</ReactMarkdown>
                </div>
                {m.sources && m.sources.length > 0 && (
                  <details className="mt-2 text-xs text-slate-400">
                    <summary className="cursor-pointer">{m.sources.length} sources retrieved</summary>
                    <ul className="mt-1 space-y-1">
                      {m.sources.map((s, k) => (
                        <li key={k}>
                          <button className="text-accent" onClick={() => onOpen(s.path, s.startLine)}>{s.path}:{s.startLine}-{s.endLine}</button>
                          <span className="ml-2">{s.kind} {s.symbol} · via {s.via.join('+')}</span>
                          <pre className="bg-bg border border-line rounded p-2 mt-1 overflow-auto max-h-32">{s.snippet}</pre>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-line flex gap-2">
        <textarea value={input} disabled={!ready} rows={2} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={ready ? 'Ask about this codebase…  (Enter to send)' : 'Waiting for indexing to finish…'}
          className="flex-1 bg-panel border border-line rounded px-3 py-2 text-sm resize-none" />
        {busy ? <button onClick={() => ac.current?.abort()} className="bg-line rounded px-4">Stop</button>
              : <button onClick={send} disabled={!ready} className="bg-accent rounded px-4 disabled:opacity-40">Send</button>}
      </div>
    </div>
  );
}
