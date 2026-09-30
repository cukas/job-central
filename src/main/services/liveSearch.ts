import { BrowserWindow } from "electron";
import type { JobPortal } from "../../shared/types.js";

// A normal desktop Chrome UA so portal results pages render the same markup a real
// visitor sees (some boards serve a stripped page to obvious bots).
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function enc(value: string) {
  return encodeURIComponent(value.trim());
}

// Take the first couple of roles so the query is focused (boards do worse with a
// long OR-list crammed into one search box).
function primaryQuery(roles: string) {
  const parts = roles.split(/[\n,]/).map((part) => part.trim()).filter(Boolean);
  return parts.slice(0, 2).join(" ") || roles.trim();
}

// Build a results URL for a portal from the user's roles + location. Known boards
// get their native search URL; anything else falls back to a Google site: search.
export function portalSearchUrl(portal: JobPortal, roles: string, location: string): string | undefined {
  const host = (portal.url || "").toLowerCase();
  const query = primaryQuery(roles);
  if (!query) return undefined;
  // Easy, anti-bot-free Swiss boards (validated search formats) — these scrape
  // cleanly in our hidden Chromium, so they're the reliable card sources.
  if (host.includes("swissdevjobs")) return `https://swissdevjobs.ch/jobs?search=${enc(query)}&location=${enc(location)}`;
  if (host.includes("stelle.admin.ch")) return `https://www.stelle.admin.ch/stelle/en/home/stellen/stellenangebot.html?query=${enc(query)}&location=${enc(location)}`;
  if (host.includes("jobagent")) return `https://www.jobagent.ch/job?q=${enc(query)}`;
  if (host.includes("berner-stellen")) return `https://berner-stellen.ch/informatik-jobs?websearch=1&query=${enc(query)}`;
  // Cloudflare-protected — best-effort only; often returns thin/blocked content.
  if (host.includes("jobs.ch")) return `https://www.jobs.ch/en/vacancies/?term=${enc(query)}&location=${enc(location)}`;
  if (host.includes("indeed")) return `https://ch.indeed.com/jobs?q=${enc(query)}&l=${enc(location)}`;
  if (host.includes("linkedin")) return `https://www.linkedin.com/jobs/search/?keywords=${enc(query)}&location=${enc(location)}&f_TPR=r604800`;
  if (host.includes("google") || !host) return `https://www.google.com/search?q=${enc(`${query} ${location} jobs`)}`;
  if (portal.sourceType === "websearch" && /^https?:\/\//.test(portal.url)) {
    const domain = portal.url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return `https://www.google.com/search?q=${enc(`site:${domain} ${query} ${location}`)}`;
  }
  return undefined;
}

export interface ScrapedPortal {
  name: string;
  url: string;
  text: string;
  links: Array<{ text: string; href: string }>;
}

// Runs inside the loaded page: collect job-looking links + the visible text. We
// keep both because some boards put the title in the link and the company/location
// in surrounding text — the AI stitches them back together downstream.
const EXTRACT_SCRIPT = `(() => {
  const looksLikeJob = (s) => /job|jobs|vacanc|stelle|position|career|karriere|posting|offre|emploi|\\/view\\//i.test(s);
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => ({ text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140), href: a.href }))
    .filter((l) => l.text.length > 3 && /^https?:/i.test(l.href) && looksLikeJob(l.href + ' ' + l.text))
    .slice(0, 60);
  const text = ((document.body && document.body.innerText) || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 9000);
  return JSON.stringify({ text: text, links: links });
})()`;

// Most Swiss/EU boards (jobs.ch, Indeed) gate content behind a cookie-consent
// wall — until it's dismissed the results don't render and we scrape nothing. This
// clicks the common "accept all" controls (OneTrust/Usercentrics/Axeptio + a
// text-matched fallback) so the real listings appear.
const DISMISS_CONSENT_SCRIPT = `(() => {
  const click = (el) => { try { el.click(); return true; } catch (e) { return false; } };
  const selectors = [
    '#onetrust-accept-btn-handler', '.onetrust-close-btn-handler',
    '#axeptio_btn_acceptAll', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    'button[data-testid*="accept" i]', 'button[aria-label*="accept" i]', 'button[id*="accept" i]',
  ];
  let hit = 0;
  for (const s of selectors) { const el = document.querySelector(s); if (el && click(el)) hit++; }
  const re = /^(accept all|allow all|alle akzeptieren|akzeptieren|accept|einverstanden|zustimmen|ich stimme zu|agree|got it|verstanden|tout accepter|accepter)$/i;
  for (const b of Array.from(document.querySelectorAll('button, a[role="button"], [role="button"]'))) {
    const t = (b.textContent || '').replace(/\\s+/g, ' ').trim();
    if (re.test(t) && click(b)) hit++;
  }
  return hit;
})()`;

const SCROLL_SCRIPT = `(() => { window.scrollTo(0, document.body.scrollHeight); return true; })()`;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Load one portal's results page in a hidden real-Chromium window, dismiss the
// cookie wall, let client-side rendering settle (and lazy-load on scroll), then
// scrape text + links. Best-effort: a blocked page just yields thin content.
export async function scrapePortal(name: string, url: string, timeoutMs = 24000): Promise<ScrapedPortal> {
  const empty: ScrapedPortal = { name, url, text: "", links: [] };
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1700,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  const runJs = (script: string) => win.webContents.executeJavaScript(script, true).catch(() => undefined);
  try {
    win.webContents.setUserAgent(BROWSER_UA);
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("load timeout")), timeoutMs)),
    ]).catch(() => undefined);
    await wait(1500);
    await runJs(DISMISS_CONSENT_SCRIPT); // accept cookies so results render
    await wait(1400);
    await runJs(SCROLL_SCRIPT); // trigger lazy-loaded result lists
    await wait(900);
    const raw = await runJs(EXTRACT_SCRIPT);
    if (!raw) return empty;
    const parsed = JSON.parse(String(raw)) as { text?: string; links?: Array<{ text: string; href: string }> };
    return { name, url, text: parsed.text ?? "", links: Array.isArray(parsed.links) ? parsed.links : [] };
  } catch {
    return empty;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

// A single real job-posting page fetched in stage 2 (its URL is a genuine,
// citable posting URL — the thing the AI is allowed to turn into a card).
export interface JobDetail {
  url: string;
  title: string;
  text: string;
}

// Tell an individual posting URL apart from an index/search/category page. The
// listing pages we scrape are full of both; only detail URLs are safe to hand
// the AI as real postings (citing an index page = a dead card).
export function isDetailUrl(href: string): boolean {
  try {
    const u = new URL(href);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    // Query-driven listings (search/filter/pagination) are never a single posting.
    if (/[?&](q|query|search|term|keywords?|page|location|l|category|cat|sort|filter|radius)=/i.test(u.search)) return false;
    // Known ATS posting hosts publish a detail page as host/{company}/{posting};
    // the board root (host/{company}) is just one segment, so require ≥2.
    if (/(^|\.)lever\.co$/.test(host) || host.includes("ashbyhq.com") || host.includes("greenhouse.io")
        || host.includes("smartrecruiters.com") || host.includes("recruitee.com")
        || host.includes("workable.com") || host.includes("personio.")) {
      return path.split("/").filter(Boolean).length >= 2;
    }
    // Bare section roots ("/jobs", "/vacancies", "/careers") are indexes, not details.
    if (/\/(search|jobs|vacancies|stellen|stellenangebote|positions?|careers|karriere|category|categories|browse|emplois?)\/?$/.test(path)) return false;
    // A job-ish section followed by a specific slug/id segment = a detail page.
    const m = path.match(/\/(jobs?|vacanc\w*|stelle\w*|position|posting|offre|emploi|o|p|view|opening|listing)s?\/([^/]+)/);
    if (!m) return false;
    const last = (path.replace(/\/+$/, "").split("/").pop() || "");
    return /\d/.test(last) || last.split("-").length >= 2; // an id, or a multi-word slug
  } catch {
    return false;
  }
}

// Stage 2: load one real posting page and pull its title + body text. Returns
// null if the page came back empty/blocked (so we never feed the AI a ghost).
async function scrapeDetail(url: string): Promise<JobDetail | null> {
  const res = await scrapePortal("detail", url, 16000);
  const text = res.text.trim();
  if (text.length < 200) return null;
  const title = text.split("\n").map((line) => line.trim()).find((line) => line.length > 6) || url;
  return { url, title: title.slice(0, 140), text: text.slice(0, 3500) };
}

// Scrape every enabled web-search portal in parallel (stage 1: listing pages),
// then follow the real detail links found across them (stage 2: a few actual
// postings). Returns ALL listing results (even empty ones) so the caller can
// report blocked vs. productive sources, plus the fetched postings.
export async function scrapePortalsForSearch(
  portals: JobPortal[],
  roles: string,
  location: string,
): Promise<{ portals: ScrapedPortal[]; details: JobDetail[] }> {
  const jobs = portals
    .map((portal) => ({ portal, url: portalSearchUrl(portal, roles, location) }))
    .filter((item): item is { portal: JobPortal; url: string } => Boolean(item.url));
  const scraped = await Promise.all(jobs.map(({ portal, url }) => scrapePortal(portal.name, url)));

  // Collect the real detail URLs surfaced by the listings, then fetch a handful.
  const detailUrls: string[] = [];
  const seen = new Set<string>();
  for (const source of scraped) {
    for (const link of source.links) {
      if (!seen.has(link.href) && isDetailUrl(link.href)) {
        seen.add(link.href);
        detailUrls.push(link.href);
      }
    }
  }
  const details = (await Promise.all(detailUrls.slice(0, 6).map(scrapeDetail)))
    .filter((detail): detail is JobDetail => detail !== null);
  return { portals: scraped, details };
}
