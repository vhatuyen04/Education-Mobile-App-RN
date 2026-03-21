import cors from 'cors';
import express, { Request, Response } from 'express';

import { authRouter } from './routes/auth.js';
import { getConfig } from './utils/config.js';

export function createServer() {
  const config = getConfig();

  const app = express();
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.use('/auth', authRouter);

  return { app, config };
}
