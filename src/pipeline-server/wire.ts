// Map the camelCase CanonicalJob → the snake_case JSON the HTTP wire
// uses, so the Electron consumers (pipeline:sync, web:live-search) read
// canonical_url / description_md.
import type { CanonicalJob } from "./types.js";

export function toWire(job: CanonicalJob): Record<string, unknown> {
  return {
    id: job.id,
    canonical_url: job.canonicalUrl,
    title: job.title,
    company: job.company,
    location: job.location,
    description_md: job.descriptionMd,
    tech_stack: job.techStack,
    salary_min: job.salaryMin ?? null,
    salary_max: job.salaryMax ?? null,
    remote_friendly: job.remoteFriendly,
    language: job.language ?? null,
    source_kind: job.sourceKind,
    source_priority: job.sourcePriority,
    posted_at: job.postedAt ?? null,
    first_seen_at: job.firstSeenAt,
    last_seen_at: job.lastSeenAt,
  };
}
