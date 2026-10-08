import { pool, vec } from './db';
import { embedQuery } from './llm';

export interface Hit {
  id: string; path: string; language: string; symbolName: string; symbolKind: string;
  parent: string | null; startLine: number; endLine: number; content: string;
  score: number; via: string[];
}

const STOP = new Set(['the', 'and', 'how', 'what', 'where', 'does', 'this', 'that', 'with', 'for', 'from', 'are', 'was', 'can', 'why', 'which', 'who', 'when', 'into', 'use', 'used', 'show', 'find', 'about', 'code', 'file', 'function']);

export function queryTokens(q: string): string[] {
  const t = q.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  return [...new Set(t.filter((w) => !STOP.has(w.toLowerCase())))].slice(0, 12);
}

const cols = `id, path, language, symbol_name, symbol_kind, parent, start_line, end_line, content`;
const toHit = (r: any): Hit => ({
  id: r.id, path: r.path, language: r.language, symbolName: r.symbol_name, symbolKind: r.symbol_kind,
  parent: r.parent, startLine: r.start_line, endLine: r.end_line, content: r.content, score: 0, via: [],
});

export type Mode = 'hybrid' | 'semantic' | 'keyword';

/** Hybrid retrieval: pgvector + full-text + exact symbol match, fused with Reciprocal Rank Fusion,
 *  then expanded with the most-imported neighbours from the file dependency graph. */
export async function search(repoId: string, query: string, k = 8, mode: Mode = 'hybrid'): Promise<Hit[]> {
  const tokens = queryTokens(query);
  const lists: { name: string; weight: number; rows: Hit[] }[] = [];

  if (mode !== 'keyword') {
    const v = await embedQuery(query);
    const { rows } = await pool.query(
      `SELECT ${cols} FROM code_chunks WHERE repo_id=$1 ORDER BY embedding <=> $2::vector LIMIT 30`, [repoId, vec(v)]);
    lists.push({ name: 'vector', weight: 1, rows: rows.map(toHit) });
  }
  if (mode !== 'semantic' && tokens.length) {
    const tsq = tokens.map((t) => t.toLowerCase()).join(' | '); // tokens are [A-Za-z0-9_] only
    const { rows } = await pool.query(
      `SELECT ${cols} FROM code_chunks, to_tsquery('simple', $2) q
       WHERE repo_id=$1 AND tsv @@ q ORDER BY ts_rank_cd(tsv, q) DESC LIMIT 30`, [repoId, tsq]);
    lists.push({ name: 'keyword', weight: 1, rows: rows.map(toHit) });

    const { rows: sym } = await pool.query(
      `SELECT ${cols} FROM code_chunks WHERE repo_id=$1 AND lower(symbol_name) = ANY($2) LIMIT 20`,
      [repoId, tokens.map((t) => t.toLowerCase())]);
    lists.push({ name: 'symbol', weight: 1.5, rows: sym.map(toHit) });
  }

  const fused = new Map<string, Hit>();
  for (const l of lists) {
    l.rows.forEach((h, rank) => {
      const e = fused.get(h.id) ?? h;
      e.score += l.weight / (60 + rank + 1);
      if (!e.via.includes(l.name)) e.via.push(l.name);
      fused.set(h.id, e);
    });
  }
  const top = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);

  // Graph expansion: pull in the first chunk of files imported by the top hit's file.
  if (mode === 'hybrid' && top.length) {
    const { rows: nb } = await pool.query(
      `SELECT c.id, c.path, c.language, c.symbol_name, c.symbol_kind, c.parent, c.start_line, c.end_line, c.content
       FROM file_edges e JOIN code_chunks c ON c.repo_id=e.repo_id AND c.path=e.to_path
       WHERE e.repo_id=$1 AND e.from_path=$2 AND c.symbol_kind <> 'module' ORDER BY c.start_line LIMIT 2`,
      [repoId, top[0].path]);
    for (const r of nb) {
      if (!top.some((t) => t.id === r.id)) top.push({ ...toHit(r), score: 0, via: ['graph'] });
    }
  }
  return top;
}
