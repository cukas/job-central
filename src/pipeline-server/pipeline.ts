import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { registerGetHealthRoute } from './routes/get-health.js';
import { registerGetApiJobsRoute } from './routes/get-api-jobs.js';
import { registerPostApiIngestRoute } from './routes/post-api-ingest.js';

const app = express();
const port = 8765;
const serverName = 'JobPipeline';

app.disable('x-powered-by');
app.use((req: Request, res: Response, next: NextFunction) => {
  const id = crypto.randomUUID();
  res.setHeader('X-Request-ID', id);
  (req as any).requestId = id;
  next();
});
app.use(express.json({ limit: '1mb' }));

registerGetHealthRoute(app);
registerGetApiJobsRoute(app);
registerPostApiIngestRoute(app);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(port, () => {
  console.log(`${serverName} listening on port ${port}`);
});
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 30000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;