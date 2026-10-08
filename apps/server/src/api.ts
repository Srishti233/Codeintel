import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { config } from './config';
import { migrate, pool } from './db';
import { log } from './log';
import { authRouter } from './routes/auth';
import { repoRouter } from './routes/repos';
import { chatRouter } from './routes/chat';
import { requireAuth } from './routes/util';

async function main() {
  await migrate();
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.CORS_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => log.info({ method: req.method, url: req.url.split('?')[0], status: res.statusCode, ms: Date.now() - t }, 'req'));
    next();
  });

  app.get('/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  app.use('/api', authRouter);
  app.use('/api', requireAuth, repoRouter, chatRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'invalid request', details: err.issues });
    log.error({ err: (err as Error).message }, 'unhandled');
    res.status(500).json({ error: 'internal error' });
  });
  app.listen(config.PORT, () => log.info(`api listening on :${config.PORT}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
