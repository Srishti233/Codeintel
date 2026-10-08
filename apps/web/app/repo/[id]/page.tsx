'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import Chat from '@/components/Chat';
import Explorer from '@/components/Explorer';
import { Dependencies, Overview, Security } from '@/components/Insights';

interface Repo { id: string; full_name: string; status: string; commit_sha: string | null; job: { status: string; progress: number; message: string; error: string | null } | null }
const TABS = ['Chat', 'Explorer', 'Overview', 'Security', 'Dependencies'] as const;

export default function RepoPage() {
  const { id } = useParams<{ id: string }>();
  const [repo, setRepo] = useState<Repo | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Chat');
  const [target, setTarget] = useState<{ path: string; line: number } | null>(null);

  useEffect(() => {
    const load = () => api<Repo>(`/repos/${id}`).then(setRepo).catch(() => {});
    load(); const t = setInterval(load, 1500); return () => clearInterval(t);
  }, [id]);

  const open = (path: string, line: number) => { setTarget({ path, line }); setTab('Explorer'); };
  const ready = repo?.status === 'ready';

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-4 px-4 h-11 border-b border-line bg-panel shrink-0">
        <Link href="/" className="text-slate-400 text-sm">← repos</Link>
        <span className="font-semibold">{repo?.full_name}</span>
        {repo?.commit_sha && <span className="text-xs text-slate-500">@{repo.commit_sha.slice(0, 8)}</span>}
        <nav className="flex gap-1 ml-6">{TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 text-sm rounded ${tab === t ? 'bg-bg text-accent' : 'text-slate-400 hover:text-slate-200'}`}>{t}</button>))}</nav>
        <button disabled={!repo || repo.status === 'indexing' || repo.status === 'queued'} onClick={() => api(`/repos/${id}/reindex`, { method: 'POST' })} className="ml-auto text-xs text-slate-400 hover:text-accent disabled:opacity-40">re-index</button>
      </header>
      {repo && !ready && (
        <div className="px-4 py-3 bg-panel border-b border-line text-sm">
          {repo.status === 'failed' ? <span className="text-red-400">Indexing failed: {repo.job?.error}</span> : (
            <><div className="mb-1">{repo.job?.message || 'Queued…'} ({repo.job?.progress ?? 0}%)</div>
              <div className="h-1.5 bg-bg rounded"><div className="h-1.5 bg-accent rounded transition-all" style={{ width: `${repo.job?.progress ?? 0}%` }} /></div></>)}
        </div>
      )}
      <main className="flex-1 min-h-0">
        {tab === 'Chat' && <Chat repoId={id} ready={!!ready} onOpen={open} />}
        {ready && tab === 'Explorer' && <Explorer repoId={id} target={target} />}
        {ready && tab === 'Overview' && <Overview repoId={id} />}
        {ready && tab === 'Security' && <Security repoId={id} onOpen={open} />}
        {ready && tab === 'Dependencies' && <Dependencies repoId={id} />}
        {!ready && tab !== 'Chat' && <p className="p-6 text-slate-400 text-sm">Available once indexing completes.</p>}
      </main>
    </div>
  );
}
