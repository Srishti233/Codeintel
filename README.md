> ⚠️ **Early version:** indexing, hybrid search, cited chat, code explorer, security scan and dependency analysis are implemented but not yet tested end-to-end with Docker. PR review, multi-agent pipeline, test/doc generation and evaluation are on the roadmap.
# CodeIntel — local-first AI Codebase Intelligence

CodeIntel connects to a GitHub repository, parses it with tree-sitter, splits it into symbol-aware chunks (functions, classes, methods), embeds them locally with Ollama, and stores everything in PostgreSQL + pgvector. You can then ask questions and get streamed answers with clickable file and line citations, explore code in a Monaco-based explorer, scan for security issues, and check dependencies against OSV.dev. Everything runs on your own machine with docker compose up.

**Zero paid services.** LLM + embeddings run locally through [Ollama](https://ollama.com); vulnerability data
comes from the free [OSV.dev](https://osv.dev) API (no key); GitHub sign-in uses a personal access token.

## Quick start

```bash
cp .env.example .env
# put two random strings in .env:   openssl rand -hex 32   (JWT_SECRET, TOKEN_ENC_KEY)
docker compose up --build
```

First start downloads the models (`nomic-embed-text` ≈ 270 MB, `qwen2.5-coder:7b` ≈ 4.7 GB) via the
`ollama-init` service — watch `docker compose logs -f ollama-init`. A 7B model wants ~8 GB RAM (or a GPU;
see the commented block in `docker-compose.yml`). For weak machines set `CHAT_MODEL=qwen2.5-coder:1.5b` in `.env`.

Open http://localhost:3000 → paste a GitHub PAT (fine-grained, read-only *Contents*; or classic `repo`) →
import a repo → watch indexing progress → chat.

> Changing `EMBED_MODEL` to one with a different dimension? Set `EMBED_DIM` and run `docker compose down -v`
> (the vector column size is fixed at first migration).

## Architecture

```
apps/
  server/   Express API (src/api.ts) + BullMQ worker (src/worker.ts), same image
    sql/schema.sql       normalized schema, pgvector HNSW + GIN full-text indexes
    src/ingest/          git clone → discover → tree-sitter chunker → indexer
    src/retrieval.ts     hybrid search: vector + full-text + exact symbol, RRF fusion, import-graph expansion
    src/security/        pattern scanner (secrets always masked), manifest parser, OSV lookup
    src/routes/          auth, repos/files/search/stats/impact/security/deps, SSE chat
    test/                vitest: chunker, scanner, dependency parsing
  web/      Next.js 14 + Tailwind + Monaco + Recharts
```

Pipeline: `clone → discover/ignore → detect language → tree-sitter parse → symbol chunks → imports/edges →
embeddings (Ollama) → pgvector`, run as a background job with live progress (DB-backed, polled by the UI).

### Safety properties implemented
- Repo text is wrapped in `<chunk>` tags and declared untrusted in the system prompt; the closing tag is escaped.
- Secrets are masked in findings, file viewer, search results, and everything sent to the model.
- GitHub tokens are AES-256-GCM encrypted at rest and stripped from `.git/config` after cloning.
- Every repo route enforces ownership (`user_id`); file reads are path-traversal checked.
- No code is executed and nothing is written back to GitHub, so no confirmation flows are needed yet.

## What is implemented vs. not (honest status)

| Area | Status |
|---|---|
| GitHub token auth, repo list/import, re-index, delete | ✅ |
| Clone, ignore rules, language detection, tree-sitter chunking (TS/JS/TSX/Python/Go/Java/Rust) | ✅ tested |
| Paragraph/section chunking fallback for other file types | ✅ |
| Embeddings + pgvector + hybrid retrieval (vector + FTS + symbol + graph, RRF) | ✅ (SQL not covered by automated tests) |
| Streaming chat with file:line citations, sources panel, history stored | ✅ |
| Code explorer (Monaco, symbols, search modes, imported-by, transitive impact) | ✅ |
| Security scan (secrets, injection, XSS, SSRF, weak crypto, TLS, CORS, prompt-injection) with `confirmed-static`/`probable` labels + score | ✅ pattern-based only |
| Dependency parsing (package.json + lockfile, requirements, go.mod, Dockerfile) + OSV vulnerabilities | ✅ |
| Dashboard: LOC by language, most-depended files | ✅ basic |
| Multi-agent pipeline, PR review, test/doc generation, architecture map, git-history intelligence, churn, evaluation harness, AI-observability page, sandboxed execution | ❌ not built (see roadmap) |

Only latency/chunk counts are logged for chat (structured logs via pino); there is no observability page yet.
Clones are `--depth 1`, so git history features need a deeper clone first.

## Roadmap (suggested order)
1. **PR review**: fetch PR diff via GitHub API, retrieve context per hunk, structured review JSON (never post without confirmation).
2. **Agents**: planner → retrieval → analyst → security → verifier, each a function with its own prompt and JSON schema (Ollama supports `format: "json"`).
3. **Evaluation**: Q/A fixtures per repo, measure recall@k and citation validity (cited ranges must exist in retrieved chunks).
4. **Architecture map**: directory/import graph with Recharts/d3, node click → chat prefilled.
5. Deeper clone + `git log` tables for authorship/churn.

## Development
```bash
npm install
docker compose up postgres redis ollama ollama-init -d
export $(grep -v '^#' .env | xargs)   # plus DATABASE_URL/REDIS_URL/OLLAMA_URL → localhost defaults work
npm -w apps/server run dev:api    # terminal 1
npm -w apps/server run dev:worker # terminal 2
npm -w apps/web run dev           # terminal 3
npm test && npm run typecheck
```
