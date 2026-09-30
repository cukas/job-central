// Ingest orchestration.
// Builds the configured adapters (plus an optional BYO-key Adzuna feed from the
// request), fetches them concurrently (cap 8), trims the global ATS boards to
// CH/EU-remote, upserts into the JSON store, and returns per-source counts.
import { adzunaAdapter } from "./adapters/adzuna.js";
import { keepSwissOrRemote } from "./filter.js";
import { buildAdapters } from "./sources.js";
import { count, flush, upsert } from "./store.js";
import type { ScopedAdapter } from "./types.js";

export interface IngestRequest {
  adzuna_app_id?: string | null;
  adzuna_app_key?: string | null;
  adzuna_country?: string | null;
  adzuna_whats?: string[] | null; // one query per role (preferred)
  adzuna_what?: string | null; // legacy single string, still honoured
  adzuna_where?: string | null;
}

export interface IngestResult {
  sources: Record<string, number | string>;
  total: number;
}

const CONCURRENCY = 8;

// Run `worker` over `items` with at most `limit` in flight at once.
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function runIngest(req: IngestRequest = {}): Promise<IngestResult> {
  const adapters: ScopedAdapter[] = buildAdapters();
  if (req.adzuna_app_id && req.adzuna_app_key) {
    adapters.push({
      scope: "user", // already country-scoped → never filtered
      adapter: adzunaAdapter({
        appId: req.adzuna_app_id,
        appKey: req.adzuna_app_key,
        country: req.adzuna_country || "ch",
        whats: req.adzuna_whats?.length ? req.adzuna_whats : (req.adzuna_what ? [req.adzuna_what] : []),
        where: req.adzuna_where || "",
        pages: 2,
      }),
    });
  }

  const fetched = await mapPool(adapters, CONCURRENCY, async ({ scope, adapter }) => {
    try {
      return { name: adapter.name, scope, jobs: await adapter.fetchJobs(), err: null as string | null };
    } catch (error) {
      return { name: adapter.name, scope, jobs: [], err: (error as Error).name || "Error" };
    }
  });

  const sources: Record<string, number | string> = {};
  for (const { name, scope, jobs, err } of fetched) {
    if (err) {
      sources[name] = `error: ${err}`;
      continue;
    }
    // Only the global ATS boards need CH/remote trimming; curated Swiss employers
    // and the user's own Adzuna feed are kept whole.
    const applyFilter = scope === "global";
    let stored = 0;
    for (const job of jobs) {
      if (applyFilter && !keepSwissOrRemote(job.location, job.remoteFriendly)) continue;
      if (upsert(job)) stored += 1;
    }
    sources[name] = stored;
  }
  flush();
  return { sources, total: count() };
}
