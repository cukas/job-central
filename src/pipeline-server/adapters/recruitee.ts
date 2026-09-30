// Recruitee public offers API (ToS-clean): GET https://{slug}.recruitee.com/api/offers/.
import type { Adapter, CanonicalJob } from "../types.js";
import { fetchJson, htmlToText, isRemote, nowIso } from "../util.js";

interface RecruiteeOffer {
  id: number | string;
  title?: string;
  location?: string;
  city?: string;
  country?: string;
  careers_url?: string;
  company_name?: string;
  remote?: boolean;
  description?: string;
  published_at?: string;
}

export function recruiteeAdapter(slug: string, company: string): Adapter {
  return {
    name: `recruitee:${slug}`,
    async fetchJobs(): Promise<CanonicalJob[]> {
      const data = await fetchJson<{ offers?: RecruiteeOffer[] }>(`https://${slug}.recruitee.com/api/offers/`);
      const now = nowIso();
      return (data.offers ?? []).map((o) => {
        const location = (o.location ?? "").trim() || [o.city, o.country].filter(Boolean).join(", ");
        return {
          id: `recruitee-${slug}-${o.id}`,
          canonicalUrl: o.careers_url ?? "",
          title: (o.title ?? "").trim(),
          company: o.company_name || company,
          location,
          descriptionMd: htmlToText(o.description ?? ""),
          techStack: [],
          remoteFriendly: Boolean(o.remote) || isRemote(location),
          sourceKind: "ats",
          sourcePriority: 1,
          postedAt: o.published_at,
          firstSeenAt: now,
          lastSeenAt: now,
        };
      });
    },
  };
}
