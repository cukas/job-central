// SmartRecruiters public postings API (ToS-clean), paginated:
// GET /v1/companies/{slug}/postings?limit=100&offset=N → { totalFound, content: [...] }.
// The list payload has no description/URL; the public posting URL is
// https://jobs.smartrecruiters.com/{companyIdentifier}/{postingId}.
import type { Adapter, CanonicalJob } from "../types.js";
import { fetchJson, nowIso } from "../util.js";

interface SrPosting {
  id: string;
  name?: string;
  company?: { identifier?: string; name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean };
  releasedDate?: string;
}

interface SrPage {
  totalFound?: number;
  content?: SrPosting[];
}

export function smartRecruitersAdapter(slug: string, company: string, maxPages = 5): Adapter {
  return {
    name: `smartrecruiters:${slug}`,
    async fetchJobs(): Promise<CanonicalJob[]> {
      const now = nowIso();
      const out: CanonicalJob[] = [];
      const limit = 100;
      let offset = 0;
      for (let page = 0; page < maxPages; page += 1) {
        const data = await fetchJson<SrPage>(`https://api.smartrecruiters.com/v1/companies/${slug}/postings`, { limit, offset });
        for (const c of data.content ?? []) {
          const loc = c.location ?? {};
          const country = (loc.country ?? "").toUpperCase();
          const location = [loc.city, loc.region, country].filter(Boolean).join(", ");
          const ident = c.company?.identifier || slug;
          out.push({
            id: `smartrec-${slug}-${c.id}`,
            canonicalUrl: `https://jobs.smartrecruiters.com/${ident}/${c.id}`,
            title: (c.name ?? "").trim(),
            company: c.company?.name || company,
            location,
            descriptionMd: "",
            techStack: [],
            remoteFriendly: Boolean(loc.remote),
            sourceKind: "ats",
            sourcePriority: 1,
            postedAt: c.releasedDate,
            firstSeenAt: now,
            lastSeenAt: now,
          });
        }
        offset += limit;
        if (offset >= (data.totalFound ?? 0) || !(data.content ?? []).length) break;
      }
      return out;
    },
  };
}
