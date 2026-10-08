'use client';
import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';

const SEV = ['critical', 'high', 'medium', 'low', 'info'];
const sevColor: Record<string, string> = { critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-sky-400', info: 'text-slate-400' };

export function Overview({ repoId }: { repoId: string }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => { api(`/repos/${repoId}/stats`).then(setS); }, [repoId]);
  if (!s) return <p className="p-6 text-slate-400 text-sm">Loading…</p>;
  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="grid grid-cols-3 gap-4 max-w-2xl">
        {[['Files', s.files], ['Lines of code', s.totalLoc], ['Chunks', s.chunks]].map(([k, v]) => (
          <div key={k as string} className="bg-panel border border-line rounded p-4"><div className="text-2xl font-semibold">{v}</div><div className="text-xs text-slate-400">{k}</div></div>))}
      </div>
      <div className="h-64 max-w-2xl"><h3 className="text-sm font-semibold mb-2">Lines of code by language</h3>
        <ResponsiveContainer><BarChart data={s.languages}><XAxis dataKey="language" stroke="#8b949e" fontSize={11} /><YAxis stroke="#8b949e" fontSize={11} />
          <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d' }} /><Bar dataKey="loc" fill="#2f81f7" /></BarChart></ResponsiveContainer></div>
      <div className="max-w-2xl"><h3 className="text-sm font-semibold mb-2">Most depended-upon files</h3>
        {s.mostImported.length === 0 && <p className="text-xs text-slate-400">No resolved internal imports.</p>}
        {s.mostImported.map((m: any) => <div key={m.path} className="text-sm flex justify-between"><span className="truncate">{m.path}</span><span className="text-slate-400">{m.dependents}</span></div>)}</div>
    </div>
  );
}

export function Security({ repoId, onOpen }: { repoId: string; onOpen: (p: string, l: number) => void }) {
  const [d, setD] = useState<{ score: number; findings: any[] } | null>(null);
  useEffect(() => { api<{ score: number; findings: any[] }>(`/repos/${repoId}/security`).then(setD); }, [repoId]);
  if (!d) return <p className="p-6 text-slate-400 text-sm">Loading…</p>;
  const counts = SEV.map((s) => [s, d.findings.filter((f) => f.severity === s).length] as const);
  return (
    <div className="p-6 overflow-auto h-full">
      <div className="flex items-center gap-6 mb-4">
        <div className="text-4xl font-bold">{d.score}<span className="text-sm text-slate-400">/100</span></div>
        <div className="flex gap-3 text-sm">{counts.map(([s, n]) => <span key={s} className={sevColor[s]}>{n} {s}</span>)}</div>
      </div>
      <p className="text-xs text-slate-500 mb-4">Static pattern analysis. “confirmed-static” = unambiguous match; “probable” = risky pattern that still needs data-flow review. Secrets are always masked.</p>
      {d.findings.length === 0 && <p className="text-slate-400 text-sm">No findings. 🎉</p>}
      <ul className="space-y-3">
        {d.findings.map((f, i) => (
          <li key={i} className="bg-panel border border-line rounded p-3 text-sm">
            <div className="flex justify-between"><span className={`font-semibold ${sevColor[f.severity]}`}>{f.severity.toUpperCase()} · {f.rule_id}</span><span className="text-xs text-slate-400">{f.confidence}</span></div>
            <button onClick={() => onOpen(f.path, f.line)} className="text-accent text-xs">{f.path}:{f.line}</button>
            <pre className="bg-bg rounded p-2 mt-1 text-xs overflow-auto">{f.evidence}</pre>
            <p className="mt-1"><b>Impact:</b> {f.impact}</p><p><b>Fix:</b> {f.fix}</p>
          </li>))}
      </ul>
    </div>
  );
}

export function Dependencies({ repoId }: { repoId: string }) {
  const [deps, setDeps] = useState<any[] | null>(null);
  useEffect(() => { api<any[]>(`/repos/${repoId}/dependencies`).then(setDeps); }, [repoId]);
  if (!deps) return <p className="p-6 text-slate-400 text-sm">Loading…</p>;
  const vuln = deps.filter((d) => d.vulns.length);
  return (
    <div className="p-6 overflow-auto h-full">
      <p className="text-sm mb-3">{deps.length} dependencies · <span className={vuln.length ? 'text-red-400' : 'text-green-400'}>{vuln.length} with known vulnerabilities (OSV.dev)</span></p>
      <table className="w-full text-sm"><thead className="text-left text-slate-400"><tr><th>Package</th><th>Version</th><th>Ecosystem</th><th>Manifest</th><th>Advisories</th></tr></thead>
        <tbody>{deps.map((d, i) => (
          <tr key={i} className="border-t border-line"><td className="py-1">{d.name}{d.is_dev && <span className="text-xs text-slate-500"> dev</span>}</td><td>{d.version ?? '—'}</td><td>{d.ecosystem}</td><td className="text-xs text-slate-400">{d.manifest}</td>
            <td>{d.vulns.map((v: any) => <a key={v.id} href={`https://osv.dev/${v.id}`} target="_blank" rel="noreferrer" className="text-red-400 mr-2 text-xs">{v.id}</a>)}</td></tr>))}</tbody></table>
    </div>
  );
}
