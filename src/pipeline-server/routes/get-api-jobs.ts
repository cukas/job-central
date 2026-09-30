import type { Express, Request, Response } from "express";
import { count, list } from "../store.js";
import { toWire } from "../wire.js";

// GET /api/jobs?limit&offset → { jobs: [...snake_case...], total }. Wire stays
// snake_case so the Electron consumers read canonical_url/description_md unchanged.
export function registerGetApiJobsRoute(app: Express): void {
  app.get("/api/jobs", (req: Request, res: Response) => {
    const limit = Number(req.query.limit ?? 50) || 50;
    const offset = Number(req.query.offset ?? 0) || 0;
    res.json({ jobs: list(limit, offset).map(toWire), total: count() });
  });
}
