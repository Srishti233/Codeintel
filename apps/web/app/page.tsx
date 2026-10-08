'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

interface Repo { id: string; full_name: string; status: string; file_count: number; chunk_count: number }
interface GhRepo { fullName: string; private: boolean; description: string | null }

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [gh, setGh] = useState<GhRepo[]>([]);
  const [manual, setManual] = useState('');

  const load = () => api<Repo[]>('/repos').then(setRepos).catch((e) => setErr(e.message));
  useEffect(() => { if (getToken()) { setAuthed(true); load(); api<GhRepo[]>('/github/repos').then(setGh).catch(() => {}); } }, []);
  useEffect(() => { const t = setInterval(() => authed && load(), 3000); return () => clearInterval(t); }, [authed]);

  async function login() {
    setErr('');
    try { const r = await api<{ jwt: string }>('/auth/token', { method: 'POST', body: JSON.stringify({ token }) }); localStorage.setItem('jwt', r.jwt); location.reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function add(fullName: string) {
    setErr('');
    try { await api('/repos', { method: 'POST', body: JSON.stringify({ fullName }) }); load(); } catch (e) { setErr((e as Error).message); }
  }

  if (!authed) return (
    <main className="max-w-md mx-auto mt-32 p-6 bg-panel border border-line rounded-lg">
      <h1 className="text-xl font-semibold mb-1">CodeIntel</h1>
      <p className="text-sm text-slate-400 mb-4">Sign in with a GitHub personal access token (read-only <code>repo</code> / Contents scope). Stored encrypted, only used to clone your repos.</p>
      <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…" className="w-full bg-bg border border-line rounded px-3 py-2 mb-3" />
      <button onClick={login} className="w-full bg-accent rounded py-2 font-medium">Sign in</button>
      {err && <p className="text-red-400 text-sm mt-3">{err}</p>}
    </main>
  );

  return (
    <main className="max-w-5xl mx-auto p-6 grid md:grid-cols-2 gap-6">
      <section>
        <h2 className="font-semibold mb-3">Indexed repositories</h2>
        {repos.length === 0 && <p className="text-slate-400 text-sm">Nothing here yet — import a repository →</p>}
        <ul className="space-y-2">
          {repos.map((r) => (
            <li key={r.id}><Link href={`/repo/${r.id}`} className="flex justify-between bg-panel border border-line rounded px-3 py-2 hover:border-accent">
              <span>{r.full_name}</span>
              <span className={`text-xs ${r.status === 'ready' ? 'text-green-400' : r.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}`}>{r.status}{r.status === 'ready' && ` · ${r.file_count} files`}</span>
            </Link></li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-semibold mb-3">Import from GitHub</h2>
        <div className="flex gap-2 mb-3">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="owner/name" className="flex-1 bg-panel border border-line rounded px-3 py-2" />
          <button onClick={() => manual && add(manual)} className="bg-accent rounded px-4">Import</button>
        </div>
        <ul className="space-y-1 max-h-96 overflow-auto">
          {gh.map((g) => (
            <li key={g.fullName} className="flex justify-between items-center text-sm px-2 py-1 hover:bg-panel rounded">
              <span>{g.fullName} {g.private && <span className="text-xs text-slate-500">private</span>}</span>
              <button onClick={() => add(g.fullName)} className="text-accent text-xs">index</button>
            </li>
          ))}
        </ul>
        {err && <p className="text-red-400 text-sm mt-3">{err}</p>}
      </section>
    </main>
  );
}
