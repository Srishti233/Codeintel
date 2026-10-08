'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';

const Monaco = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <p className="p-4 text-sm text-slate-400">Loading editor…</p> });

interface TreeFile { path: string; language: string; loc: number }
interface FileData { path: string; language: string; content: string; symbols: { name: string; kind: string; parent: string | null; start_line: number }[]; importedBy: string[] }
interface Hit { path: string; startLine: number; endLine: number; symbolName: string; symbolKind: string; via: string[] }

const MONACO_LANG: Record<string, string> = { typescript: 'typescript', tsx: 'typescript', javascript: 'javascript', python: 'python', go: 'go', java: 'java', rust: 'rust', json: 'json', markdown: 'markdown', yaml: 'yaml', sql: 'sql', shell: 'shell', html: 'html', css: 'css', dockerfile: 'dockerfile' };

export default function Explorer({ repoId, target }: { repoId: string; target: { path: string; line: number } | null }) {
  const [files, setFiles] = useState<TreeFile[]>([]);
  const [filter, setFilter] = useState('');
  const [file, setFile] = useState<FileData | null>(null);
  const [impact, setImpact] = useState<{ path: string; depth: number }[] | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [mode, setMode] = useState('hybrid');
  const editor = useRef<any>(null);
  const pendingLine = useRef<number | null>(null);

  useEffect(() => { api<TreeFile[]>(`/repos/${repoId}/tree`).then(setFiles); }, [repoId]);

  async function open(path: string, line?: number) {
    setImpact(null);
    pendingLine.current = line ?? null;
    const f = await api<FileData>(`/repos/${repoId}/file?path=${encodeURIComponent(path)}`);
    setFile(f);
    if (line && editor.current) { editor.current.revealLineInCenter(line); editor.current.setPosition({ lineNumber: line, column: 1 }); }
  }
  useEffect(() => { if (target) open(target.path, target.line).catch(() => {}); }, [target]);

  async function runSearch(q: string) {
    if (q.length < 2) { setHits(null); return; }
    setHits(await api<Hit[]>(`/repos/${repoId}/search?q=${encodeURIComponent(q)}&mode=${mode}`));
  }

  const visible = useMemo(() => files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 400), [files, filter]);

  return (
    <div className="flex h-full">
      <aside className="w-72 border-r border-line flex flex-col shrink-0">
        <div className="p-2 space-y-2 border-b border-line">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files…" className="w-full bg-panel border border-line rounded px-2 py-1 text-sm" />
          <div className="flex gap-1">
            <input onKeyDown={(e) => e.key === 'Enter' && runSearch(e.currentTarget.value)} placeholder="Code search ⏎" className="flex-1 bg-panel border border-line rounded px-2 py-1 text-sm" />
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="bg-panel border border-line rounded text-xs">
              <option value="hybrid">hybrid</option><option value="semantic">semantic</option><option value="keyword">keyword</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-auto text-sm">
          {hits ? (
            <ul>{hits.length === 0 && <li className="p-3 text-slate-400">No results</li>}
              {hits.map((h, i) => (
                <li key={i}><button onClick={() => open(h.path, h.startLine)} className="block w-full text-left px-3 py-1 hover:bg-panel">
                  <div className="truncate">{h.symbolName}</div><div className="text-xs text-slate-500 truncate">{h.path}:{h.startLine} · {h.via.join('+')}</div></button></li>))}
              <li><button className="p-3 text-xs text-accent" onClick={() => setHits(null)}>← back to files</button></li></ul>
          ) : (
            <ul>{visible.map((f) => (
              <li key={f.path}><button onClick={() => open(f.path)} title={f.path}
                className={`block w-full text-left px-3 py-0.5 truncate hover:bg-panel ${file?.path === f.path ? 'bg-panel text-accent' : ''}`}>{f.path}</button></li>))}</ul>
          )}
        </div>
      </aside>
      <section className="flex-1 flex flex-col min-w-0">
        {!file ? <p className="p-6 text-slate-400 text-sm">Select a file, or click a citation in chat.</p> : (
          <>
            <div className="px-3 py-1 border-b border-line text-sm flex justify-between">
              <span>{file.path}</span>
              <button className="text-accent text-xs" onClick={async () => setImpact((await api<{ dependents: { path: string; depth: number }[] }>(`/repos/${repoId}/impact?path=${encodeURIComponent(file.path)}`)).dependents)}>impact analysis</button>
            </div>
            <div className="flex-1 min-h-0">
              <Monaco theme="vs-dark" path={file.path} language={MONACO_LANG[file.language] ?? 'plaintext'} value={file.content}
                options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
                onMount={(ed) => { editor.current = ed; if (pendingLine.current) ed.revealLineInCenter(pendingLine.current); }} />
            </div>
          </>
        )}
      </section>
      {file && (
        <aside className="w-64 border-l border-line overflow-auto text-sm shrink-0 p-2">
          {impact && (<div className="mb-4"><h4 className="font-semibold mb-1">Impact ({impact.length})</h4>
            {impact.length === 0 ? <p className="text-slate-400 text-xs">Nothing in the repo imports this file.</p> :
              impact.map((d) => <button key={d.path} onClick={() => open(d.path)} className="block text-left text-xs truncate w-full hover:text-accent" style={{ paddingLeft: d.depth * 8 }}>{d.path}</button>)}</div>)}
          <h4 className="font-semibold mb-1">Symbols</h4>
          {file.symbols.length === 0 && <p className="text-slate-500 text-xs">none</p>}
          {file.symbols.map((s, i) => (
            <button key={i} onClick={() => editor.current?.revealLineInCenter(s.start_line)} className="block w-full text-left text-xs truncate hover:text-accent">
              <span className="text-slate-500">{s.kind}</span> {s.parent ? s.parent + '.' : ''}{s.name}</button>))}
          <h4 className="font-semibold mt-4 mb-1">Imported by ({file.importedBy.length})</h4>
          {file.importedBy.map((p) => <button key={p} onClick={() => open(p)} className="block text-left text-xs truncate w-full hover:text-accent">{p}</button>)}
        </aside>
      )}
    </div>
  );
}
