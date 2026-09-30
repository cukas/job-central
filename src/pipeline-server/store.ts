// JSON-file store for canonical jobs. Dedup key is canonicalUrl. No native modules: load → in-memory
// Map → atomic write (tmp + rename). Fine for the few-hundred jobs in play.
//
// The data dir is provided by the Electron main process at spawn via
// JOBS_DATA_DIR (app.getPath('userData')/job-pipeline); falls back to a tmp dir
// when run standalone (tests / curl smoke).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalJob } from "./types.js";

const DATA_DIR = process.env.JOBS_DATA_DIR || join(tmpdir(), "job-central-pipeline");
const DB_PATH = join(DATA_DIR, "jobs.json");

let jobs: Map<string, CanonicalJob> | null = null;

function ensureLoaded(): Map<string, CanonicalJob> {
  if (jobs) return jobs;
  jobs = new Map();
  try {
    const raw = readFileSync(DB_PATH, "utf8");
    const list = JSON.parse(raw) as CanonicalJob[];
    for (const job of list) if (job.canonicalUrl) jobs.set(job.canonicalUrl, job);
  } catch {
    // No file yet (fresh install) — start empty.
  }
  return jobs;
}

function persist(): void {
  const map = ensureLoaded();
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify([...map.values()]), "utf8");
  renameSync(tmp, DB_PATH); // atomic replace
}

// Upsert by canonicalUrl: a re-seen job keeps its original firstSeenAt and bumps
// lastSeenAt; everything else is overwritten with the fresh fetch. Jobs without a
// canonicalUrl are dropped (can't dedup / can't apply). Does NOT persist — the
// caller batches writes via flush() after a full ingest run.
export function upsert(job: CanonicalJob): boolean {
  if (!job.canonicalUrl) return false;
  const map = ensureLoaded();
  const existing = map.get(job.canonicalUrl);
  map.set(job.canonicalUrl, {
    ...job,
    firstSeenAt: existing?.firstSeenAt ?? job.firstSeenAt,
    lastSeenAt: job.lastSeenAt,
  });
  return true;
}

export function flush(): void {
  persist();
}

export function count(): number {
  return ensureLoaded().size;
}

export function list(limit: number, offset = 0): CanonicalJob[] {
  const all = [...ensureLoaded().values()].sort((a, b) => {
    const ka = a.postedAt || a.firstSeenAt;
    const kb = b.postedAt || b.firstSeenAt;
    return ka < kb ? 1 : ka > kb ? -1 : 0; // DESC, newest first
  });
  return all.slice(offset, offset + limit);
}
