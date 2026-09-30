// Ashby public job-board API (ToS-clean):
// GET /posting-api/job-board/{slug}?includeCompensation=true → { jobs: [...] }.
import type { Adapter, CanonicalJob } from "../types.js";
import { fetchJson, htmlToText, isRemote, nowIso } from "../util.js";

interface AshbyJob {
  id: string;
  title?: string;
  location?: string;
  jobUrl?: string;
  applyUrl?: string;
  isRemote?: boolean;
  isListed?: boolean;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedDate?: string;
  publishedAt?: string;
  address?: { postalAddress?: { addressCountry?: string; addressLocality?: string } };
}

export function ashbyAdapter(slug: string, company: string): Adapter {
  return {
    name: `ashby:${slug}`,
    async fetchJobs(): Promise<CanonicalJob[]> {
      const data = await fetchJson<{ jobs?: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
      const now = nowIso();
      const jobs: CanonicalJob[] = [];
      for (const j of data.jobs ?? []) {
        if (j.isListed === false) continue;
        const addr = j.address?.postalAddress ?? {};
        const country = (addr.addressCountry ?? "").trim();
        let location = (j.location || addr.addressLocality || "").trim();
        // Ashby `location` is often just a city; fold in the country so the
        // downstream Swiss/remote filter can see it.
        if (country && !location.toLowerCase().includes(country.toLowerCase())) {
          location = `${location}, ${country}`.replace(/^,\s*|,\s*$/g, "");
        }
        jobs.push({
          id: `ashby-${slug}-${j.id}`,
          canonicalUrl: j.jobUrl || j.applyUrl || "",
          title: (j.title ?? "").trim(),
          company,
          location,
          descriptionMd: j.descriptionPlain || htmlToText(j.descriptionHtml ?? ""),
          techStack: [],
          remoteFriendly: Boolean(j.isRemote) || isRemote(location),
          sourceKind: "ats",
          sourcePriority: 1,
          postedAt: j.publishedDate || j.publishedAt,
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
      return jobs;
    },
  };
}
