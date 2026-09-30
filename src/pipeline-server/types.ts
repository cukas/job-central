import type { CanonicalJob } from "../shared/models.js";

export type { CanonicalJob };

// A source adapter fetches one board/feed and maps it to CanonicalJob[].
export interface Adapter {
  name: string;
  fetchJobs(): Promise<CanonicalJob[]>;
}

// "swiss"  — curated CH employer, keep ALL roles (small-town offices won't always
//            match a city token, so they are not location-filtered).
// "global" — multinational, fetched whole then trimmed to CH/EU-remote at ingest.
// "user"   — the user's own Adzuna feed, already country-scoped → never filtered.
export type Scope = "swiss" | "global" | "user";

export interface ScopedAdapter {
  scope: Scope;
  adapter: Adapter;
}
