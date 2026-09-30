// Dependency-light helpers shared by the pipeline adapters. Pure functions, plus thin fetch wrappers over the
// Node/Electron global `fetch`.

const UA = "job-central/0.1 (personal job search; contact: local)";

export function nowIso(): string {
  return new Date().toISOString();
}

export function isRemote(location: string): boolean {
  return (location || "").toLowerCase().includes("remote");
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#34": '"',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// HTML description → plain text (mirrors selectolax `HTMLParser(unescape(raw)).text`):
// unescape entities FIRST (some boards — e.g. Greenhouse — return entity-encoded
// markup like `&lt;h3&gt;`), THEN turn block tags into line breaks, strip the rest,
// and collapse blank-line runs.
export function htmlToText(raw: string): string {
  if (!raw) return "";
  const withBreaks = decodeEntities(raw)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, "\n")
    .replace(/<\s*(li|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  // Second decode pass: some boards (Greenhouse) double-encode (`&amp;nbsp;`).
  return decodeEntities(withBreaks)
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function withParams(url: string, params?: Record<string, string | number | undefined>): string {
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
}

const DEFAULT_TIMEOUT_MS = 20000;

export async function fetchJson<T = unknown>(url: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const res = await fetch(withParams(url, params), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}
