// Personio public XML feed (open, no key — common in the DACH/Swiss market):
// GET https://{slug}.jobs.personio.{tld}/xml → <position> elements.
import { XMLParser } from "fast-xml-parser";
import type { Adapter, CanonicalJob } from "../types.js";
import { fetchText, htmlToText, isRemote, nowIso } from "../util.js";

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// Recursively collect every object stored under a "position" key, regardless of
// the feed's outer wrapper element name (Personio nests under workzag-jobs/positions).
function collectPositions(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPositions(item, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("position" in obj) for (const p of asArray(obj.position)) out.push(p as Record<string, unknown>);
    for (const value of Object.values(obj)) if (value && typeof value === "object") collectPositions(value, out);
  }
}

const str = (value: unknown): string => (value === undefined || value === null ? "" : String(value)).trim();

export function personioAdapter(slug: string, company: string, tld = "de"): Adapter {
  return {
    name: `personio:${slug}`,
    async fetchJobs(): Promise<CanonicalJob[]> {
      // Swiss tenants live on .com or .de; try the configured tld first, then fall back.
      const tlds = [tld, ...["com", "de"].filter((t) => t !== tld)];
      for (const candidate of tlds) {
        let xml: string;
        try {
          xml = await fetchText(`https://${slug}.jobs.personio.${candidate}/xml`);
        } catch {
          continue;
        }
        const jobs = parseXml(xml, slug, company, candidate);
        if (jobs.length) return jobs;
      }
      return [];
    },
  };
}

function parseXml(xml: string, slug: string, company: string, tld: string): CanonicalJob[] {
  let root: unknown;
  try {
    root = parser.parse(xml);
  } catch {
    return [];
  }
  const positions: Record<string, unknown>[] = [];
  collectPositions(root, positions);
  const now = nowIso();
  return positions.map((pos) => {
    const pid = str(pos.id);
    const office = str(pos.office);
    const descBlocks: string[] = [];
    const jd = pos.jobDescriptions as Record<string, unknown> | undefined;
    for (const d of asArray(jd?.jobDescription) as Record<string, unknown>[]) {
      const name = str(d?.name);
      const value = d?.value !== undefined ? htmlToText(String(d.value)) : "";
      const seg = [name, value].filter(Boolean).join("\n").trim();
      if (seg) descBlocks.push(seg);
    }
    return {
      id: `personio-${slug}-${pid}`,
      canonicalUrl: `https://${slug}.jobs.personio.${tld}/job/${pid}`,
      title: str(pos.name),
      company: str(pos.subcompany) || company,
      location: office,
      descriptionMd: descBlocks.join("\n\n"),
      techStack: [],
      remoteFriendly: isRemote(office),
      sourceKind: "ats",
      sourcePriority: 1,
      postedAt: str(pos.createdAt) || undefined,
      firstSeenAt: now,
      lastSeenAt: now,
    };
  });
}
