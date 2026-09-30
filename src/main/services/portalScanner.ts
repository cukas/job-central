import type { AppData, JobPortal, PortalScanResult } from "../../shared/types.js";
import { normalizeJobUrlKey } from "../../shared/jobUrl.js";
import { mentionsHomeRegion } from "../../shared/homeRegion.js";

interface FoundJob {
  company: string;
  title: string;
  location: string;
  url: string;
  portalId: string;
  description: string;
}

function ashbyApi(url: string) {
  const match = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  return match ? `https://api.ashbyhq.com/posting-api/job-board/${match[1]}?includeCompensation=true` : undefined;
}

function leverApi(url: string) {
  const match = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  return match ? `https://api.lever.co/v0/postings/${match[1]}` : undefined;
}

function greenhouseApi(url: string) {
  const match = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  return match ? `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs` : undefined;
}

function buildApi(portal: JobPortal) {
  if (portal.sourceType === "ashby") return { type: "ashby", url: ashbyApi(portal.url) };
  if (portal.sourceType === "lever") return { type: "lever", url: leverApi(portal.url) };
  if (portal.sourceType === "greenhouse") return { type: "greenhouse", url: greenhouseApi(portal.url) };
  return { type: portal.sourceType, url: undefined };
}

function preferenceTerms(data: AppData) {
  const text = `${data.profile.location} ${data.profile.workPreference} ${data.profile.targetRoles.join(" ")} ${data.profile.headline} ${data.settings.search.locations.join(" ")} ${data.settings.search.targetRoles.join(" ")}`.toLowerCase();
  return {
    wantsSwitzerland: /switzerland|schweiz|suisse|zurich|zürich|zuerich|bern|basel|geneva|genf|lausanne|ch\b/.test(text),
    wantsRemote: /remote|hybrid/.test(text),
    roleTerms: [...data.profile.targetRoles, ...data.settings.search.targetRoles]
      .flatMap((role) => role.toLowerCase().split(/[^a-z0-9äöü]+/))
      .filter((term) => term.length >= 3),
  };
}

function includeKeywords(data: AppData, portal: JobPortal) {
  return [...data.settings.search.positiveKeywords, ...portal.positiveKeywords].filter(Boolean);
}

function excludeKeywords(data: AppData, portal: JobPortal) {
  return [...data.settings.search.negativeKeywords, ...data.settings.search.excludedCompanies, ...portal.negativeKeywords].filter(Boolean);
}

function jobScore(data: AppData, portal: JobPortal, job: FoundJob) {
  const haystack = `${job.title} ${job.location} ${job.description}`.toLowerCase();
  const prefs = preferenceTerms(data);
  let score = 0;

  for (const keyword of includeKeywords(data, portal)) {
    if (keyword && haystack.includes(keyword.toLowerCase())) score += 2;
  }
  for (const term of prefs.roleTerms) {
    if (haystack.includes(term)) score += 1;
  }
  if (prefs.wantsSwitzerland) {
    if (/switzerland|schweiz|suisse|zurich|zürich|zuerich|bern|basel|geneva|genf|lausanne|ch\b/.test(haystack) || mentionsHomeRegion(haystack, data.profile.location)) score += 6;
    else score -= 8;
  } else if (mentionsHomeRegion(haystack, data.profile.location)) {
    score += 6;
  }
  if (prefs.wantsRemote && /remote|hybrid/.test(haystack)) score += 2;
  for (const keyword of excludeKeywords(data, portal)) {
    if (keyword && haystack.includes(keyword.toLowerCase())) score -= 5;
  }
  return score;
}

function passesFilter(data: AppData, portal: JobPortal, job: FoundJob) {
  const lower = job.title.toLowerCase();
  const positive = includeKeywords(data, portal).map((item) => item.toLowerCase()).filter(Boolean);
  const negative = excludeKeywords(data, portal).map((item) => item.toLowerCase()).filter(Boolean);
  const hasPositive = positive.length === 0 || positive.some((item) => lower.includes(item));
  const hasNegative = negative.some((item) => lower.includes(item));
  return hasPositive && !hasNegative && jobScore(data, portal, job) >= 2;
}

function fitReason(data: AppData, portal: JobPortal, job: FoundJob) {
  const haystack = `${job.title} ${job.location} ${job.description}`.toLowerCase();
  const positiveMatches = includeKeywords(data, portal).filter((keyword) => keyword && haystack.includes(keyword.toLowerCase()));
  const negativeMatches = excludeKeywords(data, portal).filter((keyword) => keyword && haystack.includes(keyword.toLowerCase()));
  const score = jobScore(data, portal, job);
  const reasons = [
    `Fit score: ${score}`,
    positiveMatches.length ? `Matches: ${positiveMatches.slice(0, 5).join(", ")}` : "Kept because no positive keyword was required.",
    job.location ? `Location: ${job.location}` : "",
    portal.name ? `Source: ${portal.name}` : "",
    negativeMatches.length ? `Review carefully, also matched excluded terms: ${negativeMatches.join(", ")}` : "",
  ].filter(Boolean);
  return reasons.join(" · ");
}

function parseJobs(type: string, json: unknown, portal: JobPortal): FoundJob[] {
  if (type === "greenhouse") {
    const jobs = (json as { jobs?: Array<{ title?: string; absolute_url?: string; location?: { name?: string } }> }).jobs ?? [];
    return jobs.map((job) => ({
      company: portal.name,
      title: job.title ?? "",
      location: job.location?.name ?? "",
      url: job.absolute_url ?? portal.url,
      portalId: portal.id,
      description: "",
    }));
  }

  if (type === "ashby") {
    const jobs = (json as { jobs?: Array<{ title?: string; jobUrl?: string; location?: string; department?: string }> }).jobs ?? [];
    return jobs.map((job) => ({
      company: portal.name,
      title: job.title ?? "",
      location: job.location ?? "",
      url: job.jobUrl ?? portal.url,
      portalId: portal.id,
      description: job.department ?? "",
    }));
  }

  if (type === "lever" && Array.isArray(json)) {
    return (json as Array<{ text?: string; hostedUrl?: string; categories?: { location?: string; team?: string } }>).map((job) => ({
      company: portal.name,
      title: job.text ?? "",
      location: job.categories?.location ?? "",
      url: job.hostedUrl ?? portal.url,
      portalId: portal.id,
      description: job.categories?.team ?? "",
    }));
  }

  return [];
}

export async function scanEnabledPortals(data: AppData, makeId: (prefix: string) => string): Promise<PortalScanResult[]> {
  const results: PortalScanResult[] = [];
  const seen = new Set(data.jobPosts.map((job) => normalizeJobUrlKey(job.url)).filter(Boolean));
  const removedUrls = new Set((data.settings.removedJobUrls ?? []).map(normalizeJobUrlKey).filter(Boolean));

  for (const portal of data.portals.filter((item) => item.enabled)) {
    const result: PortalScanResult = {
      portalId: portal.id,
      portalName: portal.name,
      scanned: 0,
      added: 0,
      skipped: 0,
      errors: [],
    };
    results.push(result);

    const api = buildApi(portal);
    if (!api.url) {
      result.errors.push("Manual or websearch portal. Saved for user review, not fetched automatically yet.");
      continue;
    }

    try {
      const response = await fetch(api.url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const jobs = parseJobs(api.type, await response.json(), portal).filter((job) => job.title && job.url);
      result.scanned = jobs.length;

      const rankedJobs = jobs
        .map((job) => ({ job, score: jobScore(data, portal, job) }))
        .sort((a, b) => b.score - a.score);
      let addedForPortal = 0;

      for (const { job } of rankedJobs) {
        const urlKey = normalizeJobUrlKey(job.url);
        if (addedForPortal >= 8 || !urlKey || seen.has(urlKey) || removedUrls.has(urlKey) || !passesFilter(data, portal, job)) {
          result.skipped += 1;
          continue;
        }

        seen.add(urlKey);
        const jobId = makeId("job");
        const createdAt = new Date().toISOString();
        data.jobPosts = [{
          id: jobId,
          company: job.company,
          title: job.title,
          location: job.location,
          url: job.url,
          sourcePortalId: portal.id,
          description: job.description,
          fitReason: fitReason(data, portal, job),
          score: jobScore(data, portal, job),
          createdAt,
        }, ...data.jobPosts];
        data.applications = [{
          id: makeId("app"),
          jobPostId: jobId,
          status: "watching",
          priority: "medium",
          notes: fitReason(data, portal, job),
          events: [
            {
              id: makeId("event"),
              type: "portal_scan",
              title: "Found by portal scan",
              detail: portal.name,
              createdAt,
            },
          ],
          updatedAt: createdAt,
        }, ...data.applications];
        result.added += 1;
        addedForPortal += 1;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Unknown scan error");
    }
  }

  return results;
}
