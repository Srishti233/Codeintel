import { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { pool } from '../db';

export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next: NextFunction) => { fn(req, res).catch(next); };

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  try {
    const p = jwt.verify(h?.startsWith('Bearer ') ? h.slice(7) : '', config.JWT_SECRET) as { sub: string };
    req.userId = p.sub;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

/** Authorization: the repo must belong to the caller. Returns the repo row or sends 404. */
export async function ownRepo(req: Request, res: Response, id = req.params.id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(404).json({ error: 'not found' }); return null; }
  const { rows } = await pool.query('SELECT * FROM repositories WHERE id=$1 AND user_id=$2', [id, req.userId]);
  if (!rows[0]) { res.status(404).json({ error: 'not found' }); return null; }
  return rows[0];
}
