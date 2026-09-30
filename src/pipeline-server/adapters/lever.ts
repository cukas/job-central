// Lever public postings API (ToS-clean): GET /v0/postings/{slug}?mode=json → array.
import type { Adapter, CanonicalJob } from "../types.js";
import { fetchJson, htmlToText, isRemote, nowIso } from "../util.js";

interface LeverPosting {
  id: string;
  text?: string;
  hostedUrl?: string;
  categories?: { location?: string };
  descriptionPlain?: string;
  description?: string;
  createdAt?: number;
}

export function leverAdapter(slug: string, company: string): Adapter {
  return {
    name: `lever:${slug}`,
    async fetchJobs(): Promise<CanonicalJob[]> {
      const data = await fetchJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      const now = nowIso();
      return (Array.isArray(data) ? data : []).map((p) => {
        const location = p.categories?.location ?? "";
        const postedAt = p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : undefined;
        return {
          id: `lv-${slug}-${p.id}`,
          canonicalUrl: p.hostedUrl ?? "",
          title: (p.text ?? "").trim(),
          company,
          location,
          descriptionMd: p.descriptionPlain ?? htmlToText(p.description ?? ""),
          techStack: [],
          remoteFriendly: isRemote(location),
          sourceKind: "ats",
          sourcePriority: 1,
          postedAt,
          firstSeenAt: now,
          lastSeenAt: now,
        };
      });
    },
  };
}
