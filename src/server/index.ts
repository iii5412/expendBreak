import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { assertProductionConfig } from './authConfig';
import { createApp } from './app';
import { logger } from './lib/logger';

dotenv.config();
assertProductionConfig(process.env, { exit: code => process.exit(code), log: message => logger.error(String(message)) });

const { app, config } = createApp({ env: process.env });

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Server running on http://0.0.0.0:${config.port}`);
  });
}

void startServer();
