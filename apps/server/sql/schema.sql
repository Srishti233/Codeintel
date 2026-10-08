CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id bigint UNIQUE NOT NULL,
  login text NOT NULL,
  avatar_url text,
  token_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  clone_url text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  is_private boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued',
  commit_sha text,
  file_count int NOT NULL DEFAULT 0,
  chunk_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  indexed_at timestamptz,
  UNIQUE (user_id, full_name)
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'index',
  status text NOT NULL DEFAULT 'queued',
  progress int NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_repo_idx ON analysis_jobs(repo_id, created_at DESC);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text NOT NULL,
  size_bytes int NOT NULL,
  loc int NOT NULL,
  imports text[] NOT NULL DEFAULT '{}',
  UNIQUE (repo_id, path)
);

CREATE TABLE IF NOT EXISTS file_edges (
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  from_path text NOT NULL,
  to_path text NOT NULL,
  PRIMARY KEY (repo_id, from_path, to_path)
);
CREATE INDEX IF NOT EXISTS edges_to_idx ON file_edges(repo_id, to_path);

CREATE TABLE IF NOT EXISTS symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  path text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  parent text,
  start_line int NOT NULL,
  end_line int NOT NULL
);
CREATE INDEX IF NOT EXISTS symbols_name_idx ON symbols(repo_id, lower(name));
CREATE INDEX IF NOT EXISTS symbols_file_idx ON symbols(file_id);

CREATE TABLE IF NOT EXISTS code_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text NOT NULL,
  branch text,
  commit_sha text,
  symbol_name text NOT NULL,
  symbol_kind text NOT NULL,
  parent text,
  start_line int NOT NULL,
  end_line int NOT NULL,
  content text NOT NULL,
  dependencies text[] NOT NULL DEFAULT '{}',
  embedding vector(__EMBED_DIM__) NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(symbol_name,'') || ' ' || path || ' ' || content)
  ) STORED
);
CREATE INDEX IF NOT EXISTS chunks_repo_idx ON code_chunks(repo_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON code_chunks USING gin(tsv);
CREATE INDEX IF NOT EXISTS chunks_vec_idx ON code_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_sym_idx ON code_chunks(repo_id, lower(symbol_name));

CREATE TABLE IF NOT EXISTS dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  ecosystem text NOT NULL,
  name text NOT NULL,
  version text,
  is_dev boolean NOT NULL DEFAULT false,
  manifest text NOT NULL,
  vulns jsonb NOT NULL DEFAULT '[]',
  UNIQUE (repo_id, manifest, name)
);

CREATE TABLE IF NOT EXISTS security_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  confidence text NOT NULL,
  path text NOT NULL,
  line int NOT NULL,
  evidence text NOT NULL,
  impact text NOT NULL,
  fix text NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_repo_idx ON security_findings(repo_id);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]',
  latency_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages(conversation_id, created_at);
