import type { Express, NextFunction, Request, Response } from "express";
import { runIngest, type IngestRequest } from "../ingest.js";

// POST /api/ingest → run all configured sources (+ optional BYO-key Adzuna from
// the body), store, and return { sources: {name: count}, total }.
export function registerPostApiIngestRoute(app: Express): void {
  app.post("/api/ingest", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await runIngest((req.body ?? {}) as IngestRequest);
      res.json(result);
    } catch (error) {
      // Delegate to the central error handler in pipeline.ts: it logs the full
      // error server-side and replies with a generic message, so the exception
      // text (stack/internals) never leaks to the client.
      next(error);
    }
  });
}
