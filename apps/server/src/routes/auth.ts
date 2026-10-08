import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { encrypt, decrypt } from '../crypto';
import { gh, GhRepo } from '../github';
import { requireAuth, wrap } from './util';

export const authRouter = Router();

/** Sign in with a GitHub personal access token (free; no OAuth app needed). */
authRouter.post('/auth/token', wrap(async (req, res) => {
  const { token } = z.object({ token: z.string().min(10).max(255) }).parse(req.body);
  let u: { id: number; login: string; avatar_url: string };
  try { u = await gh(token, '/user'); } catch { return res.status(401).json({ error: 'GitHub rejected this token' }); }
  const { rows } = await pool.query(
    `INSERT INTO users (github_id, login, avatar_url, token_enc) VALUES ($1,$2,$3,$4)
     ON CONFLICT (github_id) DO UPDATE SET login=EXCLUDED.login, avatar_url=EXCLUDED.avatar_url, token_enc=EXCLUDED.token_enc
     RETURNING id, login, avatar_url`, [u.id, u.login, u.avatar_url, encrypt(token)]);
  const jwtToken = jwt.sign({ sub: rows[0].id }, config.JWT_SECRET, { expiresIn: '7d' });
  res.json({ jwt: jwtToken, user: rows[0] });
}));

authRouter.get('/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, login, avatar_url FROM users WHERE id=$1', [req.userId]);
  rows[0] ? res.json(rows[0]) : res.status(401).json({ error: 'unauthorized' });
}));

authRouter.get('/github/repos', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT token_enc FROM users WHERE id=$1', [req.userId]);
  const repos = await gh<GhRepo[]>(decrypt(rows[0].token_enc), '/user/repos?per_page=100&sort=updated');
  res.json(repos.map((r) => ({ fullName: r.full_name, private: r.private, description: r.description, defaultBranch: r.default_branch })));
}));
