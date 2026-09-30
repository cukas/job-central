// Greenhouse public board API (ToS-clean): GET /v1/boards/{slug}/jobs?content=true.
import type { Adapter, CanonicalJob } from "../types.js";
import { fetchJson, htmlToText, isRemote, nowIso } from "../util.js";

interface GreenhouseJob {
  id: number | string;
  title?: string;
  absolute_url?: string;
  company_name?: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
}

export function greenhouseAdapter(slug: string, company: string): Adapter {
  return {
    name: `greenhouse:${slug}`,
    async fetchJobs(): Promise<CanonicalJob[]> {
      const data = await fetchJson<{ jobs?: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
      const now = nowIso();
      return (data.jobs ?? []).map((j) => {
        const location = j.location?.name ?? "";
        return {
          id: `gh-${slug}-${j.id}`,
          canonicalUrl: j.absolute_url ?? "",
          title: (j.title ?? "").trim(),
          company: j.company_name || company,
          location,
          descriptionMd: htmlToText(j.content ?? ""),
          techStack: [],
          remoteFriendly: isRemote(location),
          sourceKind: "ats",
          sourcePriority: 1,
          postedAt: j.updated_at,
          firstSeenAt: now,
          lastSeenAt: now,
        };
      });
    },
  };
}
