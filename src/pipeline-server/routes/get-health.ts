import type { Express, Request, Response } from "express";

export function registerGetHealthRoute(app: Express): void {
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });
}
