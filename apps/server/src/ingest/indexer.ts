import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, vec } from '../db';
import { config } from '../config';
import { log } from '../log';
import { decrypt } from '../crypto';
import { embed } from '../llm';
import { cloneRepo } from './git';
import { discoverFiles, looksBinary, resolveRelativeImport } from './discover';
import { chunkFile, Chunk } from './chunker';
import { scanFile, Finding } from '../security/scanner';
import { parseManifests, lookupVulns } from '../security/deps';

interface PendingChunk extends Chunk { fileId: string; path: string; language: string; imports: string[] }

async function progress(jobId: string, pct: number, message: string, status = 'running') {
  await pool.query('UPDATE analysis_jobs SET progress=$2, message=$3, status=$4 WHERE id=$1', [jobId, pct, message, status]);
}

export async function indexRepository(jobId: string, repoId: string): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.token_enc FROM repositories r JOIN users u ON u.id = r.user_id WHERE r.id = $1`, [repoId]);
    const repo = rows[0];
    if (!repo) throw new Error('repository not found');
    await pool.query(`UPDATE repositories SET status='indexing' WHERE id=$1`, [repoId]);

    // 0. preflight: make sure the embedding model is reachable before cloning anything
    await progress(jobId, 1, 'Checking embedding model');
    await embed(['preflight']);

    // 1. clone
    await progress(jobId, 3, `Cloning ${repo.full_name}`);
    const dest = path.join(config.REPOS_DIR, repoId);
    const sha = await cloneRepo(repo.clone_url, repo.default_branch, dest, decrypt(repo.token_enc));

    // 2. wipe previous index
    await pool.query('DELETE FROM files WHERE repo_id=$1', [repoId]);
    await pool.query('DELETE FROM file_edges WHERE repo_id=$1', [repoId]);
    await pool.query('DELETE FROM security_findings WHERE repo_id=$1', [repoId]);
    await pool.query('DELETE FROM dependencies WHERE repo_id=$1', [repoId]);

    // 3. discover
    await progress(jobId, 8, 'Discovering files');
    const files = await discoverFiles(dest, config.MAX_FILE_BYTES, config.MAX_FILES);
    const known = new Set(files.map((f) => f.rel));

    // manifests (also lockfiles, which discovery ignores) for dependency analysis
    const manifestNames = /(^|\/)(package\.json|package-lock\.json|requirements[\w.-]*\.txt|go\.mod|Dockerfile[\w.]*)$/;
    const manifestFiles: { path: string; text: string }[] = [];
    await (async function findManifests(dir: string): Promise<void> {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) { if (!['.git', 'node_modules', 'vendor', 'dist', '.next'].includes(e.name)) await findManifests(abs); continue; }
        const rel = path.relative(dest, abs).split(path.sep).join('/');
        if (manifestNames.test(rel) && (await fs.stat(abs)).size < 5_000_000) manifestFiles.push({ path: rel, text: await fs.readFile(abs, 'utf8') });
      }
    })(dest);

    // 4. parse + chunk + embed + store
    let chunkTotal = 0;
    let buffer: PendingChunk[] = [];
    const findings: Finding[] = [];
    const edges: [string, string][] = [];

    const flush = async () => {
      if (!buffer.length) return;
      const batch = buffer;
      buffer = [];
      for (let i = 0; i < batch.length; i += 16) {
        const part = batch.slice(i, i + 16);
        const vectors = await embed(part.map((c) => `// ${c.path} (${c.symbolKind} ${c.symbolName})\n${c.content}`));
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (let k = 0; k < part.length; k++) {
            const c = part[k];
            await client.query(
              `INSERT INTO code_chunks (repo_id,file_id,path,language,branch,commit_sha,symbol_name,symbol_kind,parent,start_line,end_line,content,dependencies,embedding)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::vector)`,
              [repoId, c.fileId, c.path, c.language, repo.default_branch, sha, c.symbolName, c.symbolKind, c.parent,
               c.startLine, c.endLine, c.content, c.imports, vec(vectors[k])]);
          }
          await client.query('COMMIT');
        } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      }
      chunkTotal += batch.length;
    };

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const buf = await fs.readFile(f.abs);
      if (looksBinary(buf)) continue;
      const text = buf.toString('utf8');
      const result = await chunkFile(f.language, text, f.rel);
      const loc = text.split('\n').filter((l) => l.trim()).length;
      const { rows: fr } = await pool.query(
        `INSERT INTO files (repo_id,path,language,size_bytes,loc,imports) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [repoId, f.rel, f.language, f.size, loc, result.imports]);
      const fileId = fr[0].id as string;
      for (const s of result.symbols) {
        await pool.query(
          `INSERT INTO symbols (repo_id,file_id,path,name,kind,parent,start_line,end_line) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [repoId, fileId, f.rel, s.name, s.kind, s.parent, s.startLine, s.endLine]);
      }
      for (const spec of result.imports) {
        const to = resolveRelativeImport(f.rel, spec, known);
        if (to && to !== f.rel) edges.push([f.rel, to]);
      }
      findings.push(...scanFile(f.rel, text));
      for (const c of result.chunks) buffer.push({ ...c, fileId, path: f.rel, language: f.language, imports: result.imports });
      if (buffer.length >= 32) await flush();
      if (i % 5 === 0 || i === files.length - 1) {
        await progress(jobId, 10 + Math.round(((i + 1) / files.length) * 75), `Indexed ${i + 1}/${files.length} files (${chunkTotal + buffer.length} chunks)`);
      }
    }
    await flush();

    // 5. graph edges
    await progress(jobId, 87, 'Building dependency graph');
    for (const [a, b] of edges) {
      await pool.query(`INSERT INTO file_edges (repo_id,from_path,to_path) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [repoId, a, b]);
    }

    // 6. security findings
    await progress(jobId, 90, 'Storing security findings');
    for (const f of findings) {
      await pool.query(
        `INSERT INTO security_findings (repo_id,rule_id,category,severity,confidence,path,line,evidence,impact,fix) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [repoId, f.ruleId, f.category, f.severity, f.confidence, f.path, f.line, f.evidence, f.impact, f.fix]);
    }

    // 7. dependencies + OSV vulnerabilities
    await progress(jobId, 94, 'Checking dependencies against OSV.dev');
    const deps = parseManifests(manifestFiles);
    const vulns = await lookupVulns(deps);
    for (const d of deps) {
      await pool.query(
        `INSERT INTO dependencies (repo_id,ecosystem,name,version,is_dev,manifest,vulns) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [repoId, d.ecosystem, d.name, d.version, d.isDev, d.manifest, JSON.stringify(vulns.get(`${d.manifest}|${d.name}`) ?? [])]);
    }

    await pool.query(
      `UPDATE repositories SET status='ready', commit_sha=$2, file_count=$3, chunk_count=$4, indexed_at=now() WHERE id=$1`,
      [repoId, sha, files.length, chunkTotal]);
    await pool.query(`UPDATE analysis_jobs SET status='done', progress=100, message=$2, finished_at=now() WHERE id=$1`,
      [jobId, `Done: ${files.length} files, ${chunkTotal} chunks`]);
    log.info({ repoId, files: files.length, chunks: chunkTotal }, 'index complete');
  } catch (e) {
    const msg = (e as Error).message;
    log.error({ repoId, err: msg }, 'index failed');
    await pool.query(`UPDATE repositories SET status='failed' WHERE id=$1`, [repoId]);
    await pool.query(`UPDATE analysis_jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1`, [jobId, msg]);
    throw e;
  }
}
