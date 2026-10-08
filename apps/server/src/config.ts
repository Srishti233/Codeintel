import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().default('postgres://codeintel:codeintel@localhost:5432/codeintel'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  CHAT_MODEL: z.string().default('qwen2.5-coder:7b'),
  EMBED_MODEL: z.string().default('nomic-embed-text'),
  EMBED_DIM: z.coerce.number().default(768),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be set (>=16 chars). See .env.example'),
  TOKEN_ENC_KEY: z.string().min(16, 'TOKEN_ENC_KEY must be set (>=16 chars). See .env.example'),
  PORT: z.coerce.number().default(4000),
  REPOS_DIR: z.string().default('./data/repos'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  MAX_FILE_BYTES: z.coerce.number().default(400_000),
  MAX_FILES: z.coerce.number().default(5000),
  LOG_LEVEL: z.string().default('info'),
});

export const config = schema.parse(process.env);
