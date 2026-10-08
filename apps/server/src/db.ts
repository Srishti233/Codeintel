import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

export async function migrate(): Promise<void> {
  const sql = fs
    .readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8')
    .replace('__EMBED_DIM__', String(config.EMBED_DIM));
  // Advisory lock so api + worker starting together don't race.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}

export const vec = (a: number[]) => '[' + a.join(',') + ']';
