// Adzuna aggregator (BYO-key): each user supplies their own free app_id/app_key;
// it is never shipped or centralized. canonical_url is the apply deep-link.
import type { Adapter, CanonicalJob } from "../types.js";
import { fetchJson, htmlToText, isRemote, nowIso } from "../util.js";

interface AdzunaResult {
  id: string;
  title?: string;
  redirect_url?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
  salary_min?: number;
  salary_max?: number;
  created?: string;
}

export interface AdzunaConfig {
  appId: string;
  appKey: string;
  country?: string;
  whats?: string[]; // one query per target role — Adzuna keyword-matches each
  where?: string;
  pages?: number; // pages (50/page) to pull per query
}

export function adzunaAdapter(cfg: AdzunaConfig): Adapter {
  const country = cfg.country || "ch";
  // De-dupe + drop empties; default to one "all jobs" query if no roles given.
  const whats = [...new Set((cfg.whats?.length ? cfg.whats : [""]).map((w) => w.trim()))];
  const pages = Math.max(1, Math.min(cfg.pages ?? 2, 5));
  const where = cfg.where || "";
  return {
    name: `adzuna:${country}:${whats.filter(Boolean).length || "all"}q`,
    async fetchJobs(): Promise<CanonicalJob[]> {
      const now = nowIso();
      // One query PER ROLE across `pages` (was a single page with all roles jammed
      // into one `what`, which matched almost nothing). Merge + de-dupe by id.
      const byId = new Map<string, CanonicalJob>();
      for (const what of whats) {
        for (let page = 1; page <= pages; page += 1) {
          let results: AdzunaResult[];
          try {
            const data = await fetchJson<{ results?: AdzunaResult[] }>(
              `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`,
              { app_id: cfg.appId, app_key: cfg.appKey, results_per_page: 50, what, where },
            );
            results = data.results ?? [];
          } catch {
            break; // 404 / rate-limit → stop paging this query, try the next role
          }
          if (!results.length) break; // no more results for this query
          for (const r of results) {
            const id = `adzuna-${country}-${r.id}`;
            if (byId.has(id)) continue;
            const location = r.location?.display_name ?? "";
            const desc = r.description ?? "";
            byId.set(id, {
              id,
              canonicalUrl: r.redirect_url ?? "",
              title: (r.title ?? "").trim(),
              company: r.company?.display_name ?? "",
              location,
              descriptionMd: desc.includes("<") ? htmlToText(desc) : desc,
              techStack: [],
              salaryMin: r.salary_min,
              salaryMax: r.salary_max,
              remoteFriendly: isRemote(location),
              sourceKind: "api",
              sourcePriority: 1,
              postedAt: r.created,
              firstSeenAt: now,
              lastSeenAt: now,
            });
          }
        }
      }
      return [...byId.values()];
    },
  };
}
