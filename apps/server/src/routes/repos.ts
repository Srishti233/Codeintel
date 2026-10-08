import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { decrypt } from '../crypto';
import { gh, GhRepo } from '../github';
import { indexQueue } from '../queue';
import { search, Mode } from '../retrieval';
import { maskSecrets } from '../security/scanner';
import { ownRepo, wrap } from './util';

export const repoRouter = Router();

async function enqueue(repoId: string) {
  const { rows } = await pool.query(`INSERT INTO analysis_jobs (repo_id) VALUES ($1) RETURNING id`, [repoId]);
  await indexQueue.add('index', { jobId: rows[0].id, repoId });
  await pool.query(`UPDATE repositories SET status='queued' WHERE id=$1`, [repoId]);
  return rows[0].id as string;
}

repoRouter.get('/repos', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, default_branch, is_private, status, commit_sha, file_count, chunk_count, indexed_at
     FROM repositories WHERE user_id=$1 ORDER BY created_at DESC`, [req.userId]);
  res.json(rows);
}));

repoRouter.post('/repos', wrap(async (req, res) => {
  const { fullName } = z.object({ fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/) }).parse(req.body);
  const u = await pool.query('SELECT token_enc FROM users WHERE id=$1', [req.userId]);
  let g: GhRepo;
  try { g = await gh<GhRepo>(decrypt(u.rows[0].token_enc), `/repos/${fullName}`); }
  catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  const { rows } = await pool.query(
    `INSERT INTO repositories (user_id, full_name, clone_url, default_branch, is_private)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, full_name) DO UPDATE SET default_branch=EXCLUDED.default_branch
     RETURNING id`, [req.userId, g.full_name, g.clone_url, g.default_branch, g.private]);
  const jobId = await enqueue(rows[0].id);
  res.status(201).json({ id: rows[0].id, jobId });
}));

repoRouter.post('/repos/:id/reindex', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  res.json({ jobId: await enqueue(repo.id) });
}));

repoRouter.delete('/repos/:id', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  await pool.query('DELETE FROM repositories WHERE id=$1', [repo.id]);
  await fs.rm(path.join(config.REPOS_DIR, repo.id), { recursive: true, force: true });
  res.status(204).end();
}));

repoRouter.get('/repos/:id', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const { rows } = await pool.query(
    `SELECT id, status, progress, message, error FROM analysis_jobs WHERE repo_id=$1 ORDER BY created_at DESC LIMIT 1`, [repo.id]);
  const { clone_url, user_id, ...pub } = repo;
  res.json({ ...pub, job: rows[0] ?? null });
}));

repoRouter.get('/repos/:id/tree', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const { rows } = await pool.query('SELECT path, language, loc FROM files WHERE repo_id=$1 ORDER BY path', [repo.id]);
  res.json(rows);
}));

repoRouter.get('/repos/:id/file', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const rel = z.string().min(1).max(500).parse(req.query.path);
  const root = path.resolve(config.REPOS_DIR, repo.id);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return res.status(400).json({ error: 'bad path' });
  const f = await pool.query('SELECT id, language FROM files WHERE repo_id=$1 AND path=$2', [repo.id, rel]);
  if (!f.rows[0]) return res.status(404).json({ error: 'not found' });
  const [content, symbols, importedBy] = await Promise.all([
    fs.readFile(abs, 'utf8'),
    pool.query('SELECT name, kind, parent, start_line, end_line FROM symbols WHERE file_id=$1 ORDER BY start_line', [f.rows[0].id]),
    pool.query('SELECT from_path FROM file_edges WHERE repo_id=$1 AND to_path=$2 ORDER BY from_path', [repo.id, rel]),
  ]);
  res.json({ path: rel, language: f.rows[0].language, content: maskSecrets(content), symbols: symbols.rows,
    importedBy: importedBy.rows.map((r) => r.from_path) });
}));

repoRouter.get('/repos/:id/search', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const q = z.string().min(2).max(300).parse(req.query.q);
  const mode = z.enum(['hybrid', 'semantic', 'keyword']).default('hybrid').parse(req.query.mode) as Mode;
  const hits = await search(repo.id, q, 10, mode);
  res.json(hits.map((h) => ({ ...h, content: maskSecrets(h.content).slice(0, 1200) })));
}));

repoRouter.get('/repos/:id/stats', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const [langs, top, sec] = await Promise.all([
    pool.query('SELECT language, count(*)::int AS files, sum(loc)::int AS loc FROM files WHERE repo_id=$1 GROUP BY language ORDER BY loc DESC', [repo.id]),
    pool.query(`SELECT to_path AS path, count(*)::int AS dependents FROM file_edges WHERE repo_id=$1 GROUP BY to_path ORDER BY dependents DESC LIMIT 10`, [repo.id]),
    pool.query('SELECT severity, count(*)::int AS n FROM security_findings WHERE repo_id=$1 GROUP BY severity', [repo.id]),
  ]);
  res.json({ languages: langs.rows, mostImported: top.rows, findingsBySeverity: sec.rows,
    totalLoc: langs.rows.reduce((a, r) => a + r.loc, 0), files: repo.file_count, chunks: repo.chunk_count });
}));

repoRouter.get('/repos/:id/impact', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const start = z.string().min(1).max(500).parse(req.query.path);
  // transitive dependents via recursive CTE (change-impact analysis)
  const { rows } = await pool.query(
    `WITH RECURSIVE r(path, depth) AS (
       SELECT from_path, 1 FROM file_edges WHERE repo_id=$1 AND to_path=$2
       UNION
       SELECT e.from_path, r.depth+1 FROM file_edges e JOIN r ON e.to_path=r.path WHERE e.repo_id=$1 AND r.depth < 6
     ) SELECT path, min(depth)::int AS depth FROM r GROUP BY path ORDER BY depth, path`, [repo.id, start]);
  res.json({ path: start, dependents: rows });
}));

repoRouter.get('/repos/:id/security', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const { rows } = await pool.query(
    `SELECT rule_id, category, severity, confidence, path, line, evidence, impact, fix FROM security_findings WHERE repo_id=$1
     ORDER BY array_position(ARRAY['critical','high','medium','low','info'], severity), path, line LIMIT 500`, [repo.id]);
  const { securityScore } = await import('../security/scanner');
  res.json({ score: securityScore(rows), findings: rows });
}));

repoRouter.get('/repos/:id/dependencies', wrap(async (req, res) => {
  const repo = await ownRepo(req, res); if (!repo) return;
  const { rows } = await pool.query(
    `SELECT ecosystem, name, version, is_dev, manifest, vulns FROM dependencies WHERE repo_id=$1
     ORDER BY jsonb_array_length(vulns) DESC, manifest, name`, [repo.id]);
  res.json(rows);
}));
