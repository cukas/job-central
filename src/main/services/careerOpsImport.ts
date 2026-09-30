import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppData, CareerOpsImportResult, JobPortal } from "../../shared/types.js";

function cellValues(line: string) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function stripMarkdown(value: string) {
  return value.replace(/\*\*/g, "").replace(/✅|❌/g, "").trim();
}

function parseApplications(text: string) {
  return text
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const cells = cellValues(line);
      return {
        date: cells[1] ?? "",
        company: stripMarkdown(cells[2] ?? ""),
        title: stripMarkdown(cells[3] ?? ""),
        score: Number.parseFloat((cells[4] ?? "").replace("/5", "")),
        status: stripMarkdown(cells[5] ?? "Evaluated").toLowerCase(),
        notes: stripMarkdown(cells[8] ?? ""),
      };
    })
    .filter((job) => job.company && job.title);
}

function parsePortals(text: string): Array<Omit<JobPortal, "id" | "updatedAt">> {
  const portals: Array<Omit<JobPortal, "id" | "updatedAt">> = [];
  const blocks = text.split(/\n\s*-\s+name:\s+/).slice(1);

  for (const block of blocks) {
    const name = block.split("\n")[0]?.trim().replace(/^"|"$/g, "");
    const url = block.match(/careers_url:\s*(.+)/)?.[1]?.trim() ?? "";
    const sourceType = block.includes("ashbyhq.com")
      ? "ashby"
      : block.includes("greenhouse")
        ? "greenhouse"
        : block.includes("lever.co")
          ? "lever"
          : "websearch";
    const notes = block.match(/notes:\s*"([^"]+)"/)?.[1] ?? block.match(/notes:\s*(.+)/)?.[1]?.trim() ?? "";
    const enabled = !/enabled:\s*false/.test(block);
    if (!name || !url) continue;
    portals.push({
      name,
      country: "Switzerland",
      url,
      sourceType,
      enabled,
      query: block.match(/scan_query:\s*'([^']+)'/)?.[1] ?? block.match(/scan_query:\s*"([^"]+)"/)?.[1] ?? "",
      positiveKeywords: ["AI", "KI", "Frontend", "Staff", "Lead", "Principal", "Architect", "Engineering Manager"],
      negativeKeywords: ["Junior", "Intern", "Praktikant", "Werkstudent", "Lehre", "Trainee"],
      notes,
    });
  }

  return portals;
}

function statusFromCareerOps(status: string) {
  if (status.includes("reject")) return "rejected" as const;
  if (status.includes("applied")) return "applied" as const;
  if (status.includes("interview")) return "interview" as const;
  return "evaluating" as const;
}

export async function importCareerOps(root: string, data: AppData, makeId: (prefix: string) => string): Promise<CareerOpsImportResult> {
  const result: CareerOpsImportResult = { jobsAdded: 0, portalsAdded: 0, skipped: 0, errors: [] };

  try {
    const applications = parseApplications(await readFile(path.join(root, "data/applications.md"), "utf8"));
    const seen = new Set(data.jobPosts.map((job) => `${job.company.toLowerCase()}::${job.title.toLowerCase()}`));
    for (const imported of applications) {
      const key = `${imported.company.toLowerCase()}::${imported.title.toLowerCase()}`;
      if (seen.has(key)) {
        result.skipped += 1;
        continue;
      }
      seen.add(key);
      const jobId = makeId("job");
      data.jobPosts.unshift({
        id: jobId,
        company: imported.company,
        title: imported.title,
        location: "Switzerland",
        url: "",
        description: imported.notes,
        score: Number.isFinite(imported.score) ? imported.score : undefined,
        createdAt: imported.date || new Date().toISOString(),
      });
      data.applications.unshift({
        id: makeId("app"),
        jobPostId: jobId,
        status: statusFromCareerOps(imported.status),
        priority: Number.isFinite(imported.score) && imported.score >= 4.5 ? "high" : "medium",
        appliedAt: imported.status.includes("applied") ? imported.date : undefined,
        notes: imported.notes,
        events: [{
          id: makeId("event"),
          type: "created",
          title: "Imported from career-ops",
          detail: imported.status,
          createdAt: new Date().toISOString(),
        }],
        updatedAt: new Date().toISOString(),
      });
      result.jobsAdded += 1;
    }
  } catch (error) {
    result.errors.push(`applications.md: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  try {
    const portals = parsePortals(await readFile(path.join(root, "portals.yml"), "utf8"));
    const seen = new Set(data.portals.map((portal) => portal.url));
    for (const portal of portals) {
      if (seen.has(portal.url)) {
        result.skipped += 1;
        continue;
      }
      seen.add(portal.url);
      data.portals.push({
        ...portal,
        id: makeId("portal"),
        updatedAt: new Date().toISOString(),
      });
      result.portalsAdded += 1;
    }
  } catch (error) {
    result.errors.push(`portals.yml: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return result;
}
