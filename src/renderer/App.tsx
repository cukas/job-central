import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardList,
  Columns,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  BadgeCheck,
  Calendar,
  Flag,
  FolderOpen,
  Github,
  Globe2,
  GripVertical,
  History,
  LayoutDashboard,
  Link,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement } from "react";
import {
  addCvEntry,
  cvEntriesForSection,
  deleteCvEntry,
  deleteCvSection,
  duplicateCvEntry,
  duplicateCvSection,
  hydrateCvSection,
  hydrateCvSections,
  reorderCvEntries,
  reorderCvSections,
  serializeCvEntries as serializeStructuredCvEntries,
  setCvEntryVisibility,
  setCvSectionVisibility,
  updateCvEntry,
} from "../shared/cvModel";
import { cvPersonalDataItems, cvSectionContentHtml } from "../shared/cvRender";
import { CV_PAPER_CSS, cvFontStack } from "../shared/cvPaperCss";
import { normalizeJobUrlKey } from "../shared/jobUrl";
// pdf.js renders the EXPORTED PDF bytes to canvas pages for the paged preview, so the on-screen
// CV is the exact document that gets exported (one Chromium print engine, no second paginator).
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
import {
  analyzeImportedCvDocument,
  normalizeImportedCvText as normalizeImportedDocumentText,
  profileFromCvText as profileFromImportedCvText,
  sectionsFromCvText as sectionsFromImportedCvText,
} from "../shared/cvImport";
import type { CvImportAnalysis } from "../shared/cvImport";
import { escapeRegExp, homeRegionTerms, wholeWordPattern } from "../shared/homeRegion";
import type {
  AiPlan,
  AiProposal,
  AiProvider,
  AppData,
  AppSection,
  ApplicationStatus,
  ArtifactHistoryItem,
  CoverLetter,
  CvDocument,
  CvProject,
  CvReview,
  CvSection,
  CvVersion,
  JobEvaluation,
  JobApplication,
  JobCentralApi,
  JobPortal,
  JobPost,
  DocxResult,
  JobExtraction,
  LinkCheckResult,
  MirrorSyncStatus,
  PdfResult,
  PortalScanResult,
  Profile,
  ProfileFact,
  RemovedJob,
  RemovedJobInput,
  SalaryEstimate,
  SearchPreferences,
  SourceDocument,
} from "../shared/types";

// Minimal surface of Electron's <webview> tag that the in-app job browser uses.
// Typed here so we avoid pulling Electron types into the renderer bundle.
interface WebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  getWebContentsId(): number;
}

function jobCentral(): JobCentralApi {
  const api = (window as unknown as { jobCentral?: JobCentralApi }).jobCentral;
  if (!api) throw new Error("Job Central API is not available. Check the Electron preload bridge.");
  return api;
}

function isCvVersionDocument(cv: CvDocument | CvVersion): cv is CvVersion {
  return "sourceCvId" in cv;
}

// The master CV always exists as the build target, but a fresh/reset install seeds it
// empty. Treat it as "not a CV yet" until it has real content, so the Library doesn't
// list or count an empty shell ("0 CVs" until you build one).
function masterCvHasContent(data: AppData): boolean {
  return data.masterCv.sections.some((section) => section.enabled && section.content.trim() !== "");
}

function cvDocumentJobId(cv: CvDocument | CvVersion): string | undefined {
  return isCvVersionDocument(cv) ? cv.jobId : undefined;
}

type ScanPortalsOutcome = Awaited<ReturnType<JobCentralApi["scanPortals"]>>;
type ImportCvDocumentOutcome = Awaited<ReturnType<JobCentralApi["importCvDocument"]>>;
type PdfGenerationOutcome = { result: PdfResult };
type DocxGenerationOutcome = { result: DocxResult };

function scanResultMessage(result: ScanPortalsOutcome): string {
  return `${result.results.reduce((sum, item) => sum + item.added, 0)} jobs added`;
}

function importCvDocumentMessage(result: ImportCvDocumentOutcome): string {
  return result.filePath ? `Imported and analyzed ${result.filePath.split("/").pop()}` : "No file selected";
}

function pdfResultMessage(result: PdfGenerationOutcome): string {
  return result.result.pdfPath || "PDF generated";
}

function docxResultMessage(result: DocxGenerationOutcome): string {
  return result.result.docxPath || "Word document generated";
}

function packagePdfResultMessage(result: PdfGenerationOutcome): string {
  return result.result.pdfPath || "PDFs generated";
}

const statusLabels: Record<ApplicationStatus, string> = {
  watching: "Todo",
  evaluating: "Review",
  applied: "Applied",
  follow_up: "Follow up",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
  archived: "Archived",
};

const statusOrder: ApplicationStatus[] = ["watching", "evaluating", "applied", "follow_up", "interview", "offer", "rejected", "ghosted"];

const sectionMeta = {
  start: { icon: Search },
  cv: { icon: FileText },
  letters: { icon: FileText },
  jobs: { icon: ClipboardList },
  pipeline: { icon: ClipboardList },
  settings: { icon: Settings },
} satisfies Record<AppSection, { icon: typeof FileText }>;

const uiText = {
  en: {
    start: "Job Search",
    cv: "CV Builder",
    letters: "Letters",
    jobs: "Tracker",
    pipeline: "Pipeline",
    settings: "Settings",
    overview: "Overview",
    content: "Content",
    customize: "Customize",
    aiTools: "AI Tools",
    save: "Save",
    createVariant: "Create variant",
    aiPlan: "AI plan",
    photo: "Photo",
    contactIcons: "Contact icons",
  },
  de: {
    start: "Jobsuche",
    cv: "CV Builder",
    letters: "Motivationsschreiben",
    jobs: "Job Tracker",
    pipeline: "Pipeline",
    settings: "Einstellungen",
    overview: "Uebersicht",
    content: "Inhalt",
    customize: "Design",
    aiTools: "KI Tools",
    save: "Speichern",
    createVariant: "Variante erstellen",
    aiPlan: "KI Plan",
    photo: "Foto",
    contactIcons: "Kontakt-Icons",
  },
};

const cvTemplateOptions: Array<{ key: CvDocument["template"]; label: string; description: string; atsSafe: boolean }> = [
  { key: "flow", label: "Flow", description: "Photo-led modern layout with balanced spacing.", atsSafe: true },
  { key: "swiss", label: "Swiss", description: "Strict, typographic, recruiter-friendly.", atsSafe: true },
  { key: "compact", label: "Compact", description: "Dense layout for long experience.", atsSafe: true },
  { key: "executive", label: "Executive", description: "Leadership profile with strong top band.", atsSafe: true },
  { key: "minimal", label: "Minimal", description: "Quiet black-and-white ATS style.", atsSafe: true },
  { key: "sidebar", label: "Sidebar", description: "Strong left rail — eye-catching, but a two-column layout some parsers misread.", atsSafe: false },
  { key: "classic", label: "Classic", description: "Serif typography for formal applications.", atsSafe: true },
  { key: "ats", label: "ATS Pro ★", description: "Single column, standard headings — maximum ATS pass-through + callbacks.", atsSafe: true },
  { key: "zurich", label: "Zürich", description: "Swiss-standard: photo, clean accent rule, two-page friendly.", atsSafe: true },
  { key: "modern", label: "Modern", description: "Airy single column with a tasteful accent — recruiter-friendly.", atsSafe: true },
  { key: "slate", label: "Slate", description: "Dark name band, clean body. Bold but still single-column/ATS-safe.", atsSafe: true },
  { key: "editorial", label: "Editorial", description: "Magazine feel: big name, hairline rules, generous whitespace.", atsSafe: true },
  { key: "techmono", label: "Tech Mono", description: "Monospace headings for engineers; clean readable body.", atsSafe: true },
  { key: "elegant", label: "Elegant", description: "Refined serif, generous spacing — formal and attractive.", atsSafe: true },
];

const templateDefaults: Record<CvDocument["template"], Pick<CvDocument["style"], "accentColor" | "density">> = {
  flow: { accentColor: "#55a8e8", density: "comfortable" },
  swiss: { accentColor: "#111111", density: "comfortable" },
  compact: { accentColor: "#2563eb", density: "compact" },
  executive: { accentColor: "#f97316", density: "comfortable" },
  minimal: { accentColor: "#111111", density: "compact" },
  sidebar: { accentColor: "#0f766e", density: "compact" },
  classic: { accentColor: "#3f3f46", density: "comfortable" },
  ats: { accentColor: "#111111", density: "comfortable" },
  zurich: { accentColor: "#b91c1c", density: "comfortable" },
  modern: { accentColor: "#2563eb", density: "comfortable" },
  slate: { accentColor: "#0ea5e9", density: "comfortable" },
  editorial: { accentColor: "#111111", density: "comfortable" },
  techmono: { accentColor: "#0f766e", density: "compact" },
  elegant: { accentColor: "#7c3aed", density: "comfortable" },
};

const fontPresets = [
  "system",
  "Avenir Next",
  "Helvetica Neue",
  "Inter",
  "Arial",
  "SF Pro Display",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Gill Sans",
  "Menlo",
];

const visibleNavSections: AppSection[] = ["cv", "start", "pipeline", "settings"];

// Rendered A4 paper width in px; the preview scales relative to this so it
// always fits the (often narrow) preview panel without being clipped.
const PAPER_WIDTH = 794;

function splitCommaList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

// True when an error means the AI engine is missing/unselected/unresponsive — the
// one failure that the whole product can't recover from on its own, so we surface
// a banner that routes the user back to AI setup instead of a dead-end message.
function isAiSetupError(message: string) {
  return /no (detected )?ai (engine|cli)|ai (engine|cli)[^.]*(select|detect|respond|fail|not)|(select|detect)[^.]*ai (engine|cli)|choose or detect/i.test(message);
}

type SearchText = Record<keyof SearchPreferences, string>;
type CareerAdviceDirection = {
  title?: string;
  fit?: number;
  why?: string;
  watchOut?: string;
  keywords?: string[];
  companies?: string[];
  nextStep?: string;
};
type CareerAdviceOutput = {
  reply?: string;
  directions?: CareerAdviceDirection[];
  search?: Partial<SearchPreferences>;
  questions?: string[];
};

// Raw editable strings for the comma-list fields. We edit raw text so typing a
// comma or space is never stripped mid-keystroke; arrays are derived on save.
function searchPrefsToText(search: SearchPreferences): SearchText {
  return {
    targetRoles: search.targetRoles.join(", "),
    locations: search.locations.join(", "),
    positiveKeywords: search.positiveKeywords.join(", "),
    negativeKeywords: search.negativeKeywords.join(", "),
    targetCompanies: search.targetCompanies.join(", "),
    excludedCompanies: search.excludedCompanies.join(", "),
  };
}

function searchTextToPrefs(text: SearchText): SearchPreferences {
  return {
    targetRoles: splitCommaList(text.targetRoles),
    locations: splitCommaList(text.locations),
    positiveKeywords: splitCommaList(text.positiveKeywords),
    negativeKeywords: splitCommaList(text.negativeKeywords),
    targetCompanies: splitCommaList(text.targetCompanies),
    excludedCompanies: splitCommaList(text.excludedCompanies),
  };
}

function confirmDestructive(message: string) {
  return window.confirm(message);
}

function emptyPortal(): JobPortal {
  return {
    id: `portal_${Date.now().toString(36)}`,
    name: "New portal",
    country: "Switzerland",
    url: "",
    sourceType: "manual",
    enabled: true,
    query: "",
    positiveKeywords: [],
    negativeKeywords: [],
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

function searchHref(portal: JobPortal) {
  const query = portal.query || `site:${portal.url.replace(/^https?:\/\//, "")} ${portal.positiveKeywords.join(" OR ")}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// One-click starting points for the most common Swiss + global job sources, so a
// new portal is a click away instead of hand-typing name + URL + type each time.
const PORTAL_PRESETS: Array<{ label: string; name: string; url: string; sourceType: JobPortal["sourceType"]; notes?: string }> = [
  { label: "Google web search", name: "Google Search", url: "https://www.google.com/search", sourceType: "websearch", notes: "General web search for AI-decided queries." },
  { label: "jobs.ch", name: "jobs.ch", url: "https://www.jobs.ch", sourceType: "websearch" },
  { label: "LinkedIn Jobs", name: "LinkedIn Jobs", url: "https://www.linkedin.com/jobs", sourceType: "websearch" },
  { label: "Indeed CH", name: "Indeed Switzerland", url: "https://ch.indeed.com", sourceType: "websearch" },
  { label: "SwissDevJobs", name: "SwissDevJobs", url: "https://swissdevjobs.ch", sourceType: "websearch", notes: "Dev-focused, shows salaries. Scrapes cleanly." },
  { label: "stelle.admin.ch", name: "stelle.admin.ch", url: "https://www.stelle.admin.ch", sourceType: "websearch", notes: "Swiss federal government jobs — no anti-bot, strong for Bern." },
  { label: "jobagent.ch", name: "jobagent.ch", url: "https://www.jobagent.ch", sourceType: "websearch", notes: "Swiss aggregator — lightweight, scrapes well." },
  { label: "berner-stellen.ch", name: "berner-stellen.ch", url: "https://berner-stellen.ch", sourceType: "websearch", notes: "Regional Bern IT board (1300+ jobs)." },
  // --- More Swiss boards ---
  { label: "jobup.ch", name: "jobup.ch", url: "https://www.jobup.ch", sourceType: "websearch", notes: "Romandie / French-speaking Switzerland — big regional board." },
  { label: "JobScout24", name: "JobScout24", url: "https://www.jobscout24.ch", sourceType: "websearch", notes: "General Swiss job board." },
  { label: "ICTcareer", name: "ICTcareer", url: "https://www.ictcareer.ch", sourceType: "websearch", notes: "Swiss IT/ICT-focused board." },
  { label: "Prospective", name: "Prospective", url: "https://www.prospective.ch", sourceType: "websearch", notes: "Swiss IT & engineering jobs." },
  { label: "ostjob.ch", name: "ostjob.ch", url: "https://www.ostjob.ch", sourceType: "websearch", notes: "Eastern Switzerland regional board." },
  // --- DACH / EU big boards ---
  { label: "StepStone", name: "StepStone", url: "https://www.stepstone.de", sourceType: "websearch", notes: "Large DACH job board." },
  { label: "Xing Jobs", name: "Xing Jobs", url: "https://www.xing.com/jobs", sourceType: "websearch", notes: "DACH professional network jobs." },
  { label: "Glassdoor", name: "Glassdoor", url: "https://www.glassdoor.com", sourceType: "websearch", notes: "Global jobs + company reviews." },
  { label: "Monster CH", name: "Monster Switzerland", url: "https://www.monster.ch", sourceType: "websearch", notes: "Global aggregator, Swiss site." },
  // --- EU tech / remote ---
  { label: "Arbeitnow", name: "Arbeitnow", url: "https://www.arbeitnow.com", sourceType: "websearch", notes: "EU jobs — scrapes cleanly (open API)." },
  { label: "Landing.jobs", name: "Landing.jobs", url: "https://landing.jobs", sourceType: "websearch", notes: "EU tech jobs." },
  { label: "Honeypot", name: "Honeypot", url: "https://www.honeypot.io", sourceType: "websearch", notes: "EU developer-focused board." },
  { label: "WeWorkRemotely", name: "We Work Remotely", url: "https://weworkremotely.com", sourceType: "websearch", notes: "Remote jobs worldwide." },
  { label: "RemoteOK", name: "RemoteOK", url: "https://remoteok.com", sourceType: "websearch", notes: "Remote jobs, dev-heavy." },
  // --- EU official / FR ---
  { label: "EURES (EU)", name: "EURES", url: "https://eures.europa.eu", sourceType: "websearch", notes: "Official European job mobility portal." },
  { label: "Welcome to the Jungle", name: "Welcome to the Jungle", url: "https://www.welcometothejungle.com", sourceType: "websearch", notes: "FR/EU jobs — strong tech & startups." },
  { label: "Greenhouse board", name: "Greenhouse board", url: "https://boards.greenhouse.io/COMPANY", sourceType: "greenhouse", notes: "Replace COMPANY with the employer's Greenhouse slug." },
  { label: "Ashby board", name: "Ashby board", url: "https://jobs.ashbyhq.com/COMPANY", sourceType: "ashby", notes: "Replace COMPANY with the employer's Ashby slug." },
  { label: "Lever board", name: "Lever board", url: "https://jobs.lever.co/COMPANY", sourceType: "lever", notes: "Replace COMPANY with the employer's Lever slug." },
];

function portalFromPreset(preset: (typeof PORTAL_PRESETS)[number]): JobPortal {
  return { ...emptyPortal(), name: preset.name, url: preset.url, sourceType: preset.sourceType, notes: preset.notes ?? "" };
}

function urlHintForType(sourceType: JobPortal["sourceType"]) {
  if (sourceType === "websearch") return "domain the AI searches within";
  if (sourceType === "greenhouse") return "e.g. boards.greenhouse.io/company";
  if (sourceType === "ashby") return "e.g. jobs.ashbyhq.com/company";
  if (sourceType === "lever") return "e.g. jobs.lever.co/company";
  return "job board or careers page";
}

function findJobByUrlKey(jobs: JobPost[], url?: string | null): JobPost | undefined {
  const key = normalizeJobUrlKey(url);
  if (!key) return undefined;
  return jobs.find((job) => normalizeJobUrlKey(job.url) === key);
}

function buildJobUrlMap(jobs: JobPost[]): Map<string, JobPost> {
  const map = new Map<string, JobPost>();
  for (const job of jobs) {
    const key = normalizeJobUrlKey(job.url);
    if (key) map.set(key, job);
  }
  return map;
}

function planHint(plan: AiPlan) {
  if (plan.purpose === "portal_search") return "Search strategy, fit reasoning, portal/query suggestions, and open questions.";
  if (plan.purpose === "cover_letter") return "Job-specific motivation letter draft based on the selected role and profile.";
  if (plan.purpose === "optimize_cv") return "Whole-master-CV optimization with stronger text, template, font, density, and accent choices.";
  if (plan.purpose === "cv_entry") return "Rewrite or feedback for a specific master CV entry.";
  if (plan.purpose === "evaluate_job") return "Fit evaluation with strengths, risks, and what to check before applying.";
  if (plan.purpose === "interview_prep") return "Interview themes, STAR stories, gaps to address, and questions to ask.";
  if (plan.purpose === "follow_up") return "Concise follow-up message for the application.";
  return "AI task prepared for the selected CLI.";
}

function readablePlanOutput(plan: AiPlan) {
  const output = plan.output?.trim();
  if (!output) return "";
  const cleaned = output
    .split("\n")
    .filter((line) => !/^(Error:|Attempt \d+ failed:|\[Routing\]|API returned invalid|Traceback|at\s+\S+\s+\()/i.test(line.trim()))
    .join("\n")
    .trim();
  if (!cleaned) {
    return "The selected AI CLI failed. The fallback workflow kept existing CV or letter content intact.";
  }
  if (cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned) as { strategy?: string; letter?: string; content?: string; body?: string };
      return parsed.strategy || parsed.letter || parsed.content || parsed.body || "AI returned structured data that was applied to the artifact.";
    } catch {
      return "AI returned structured data. Use the related CV, job card, or letter to review the applied result.";
    }
  }
  return cleaned;
}

function cleanUserText(value: string) {
  const diagnosticLine = /^(Error:|Attempt \d+ failed:|\[Routing\]|API returned invalid|Traceback|at\s+\S+\s+\(|Ripgrep is not available|Full report available at:|npm (verbose|error)|\s*at async\s)/i;
  const lines = value.split("\n");
  const firstDiagnosticIndex = lines.findIndex((line) => diagnosticLine.test(line.trim()));
  const bodyLines = firstDiagnosticIndex >= 0 ? lines.slice(0, firstDiagnosticIndex) : lines;
  return bodyLines.filter((line) => !diagnosticLine.test(line.trim())).join("\n").trim();
}

function newestPlan(plans: AiPlan[], predicate: (plan: AiPlan) => boolean) {
  return plans
    .filter(predicate)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function dumpLocalData(data: AppData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `job-central-dump-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface AiJobTarget {
  key: string;
  company: string;
  title: string;
  location: string;
  url: string;
  reason: string;
  fit?: number;
}

// Pull a fit/match score (0-100) the AI was asked to include per card.
function extractFit(text: string): number | undefined {
  const match = text.match(/\bfit\b[^0-9]{0,12}(\d{1,3})\s*%?/i) ?? text.match(/(\d{1,3})\s*%\s*(?:fit|match)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return value >= 0 && value <= 100 ? value : undefined;
}

// Deterministic fallback: overlap of the candidate's target roles with the job
// title + reason, mapped to a believable 60-98 band so every card shows a fit.
function localFit(target: AiJobTarget, roles: string[]): number {
  const hay = `${target.title} ${target.reason}`.toLowerCase();
  const tokens = [...new Set(roles.flatMap((role) => role.toLowerCase().split(/[^a-z]+/)).filter((token) => token.length > 3))];
  if (!tokens.length) return 75;
  const hits = tokens.filter((token) => hay.includes(token)).length;
  const ratio = hits / Math.min(tokens.length, 6);
  return Math.max(60, Math.min(98, Math.round(60 + ratio * 38)));
}

function stripMarkdown(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^\s*\d+\.\s*/, "")
    .trim();
}

function cleanAiTargetField(value: string) {
  return stripMarkdown(value).replace(/^[-•:]+/, "").trim();
}

function isUsefulAiTarget(target: AiJobTarget) {
  const combined = `${target.company} ${target.title}`.trim();
  const junkPattern = /^(role|rank|company|job title|target role|link to filtered search|search on|view job|careers|filtered search|open job|apply\b.*)$/i;
  if (!target.company || !target.title || !target.url) return false;
  if (junkPattern.test(target.company) || junkPattern.test(target.title)) return false;
  if (/^\d+$/.test(target.company) || /^\d+$/.test(target.title)) return false;
  if (/^\s*role\s*:/i.test(combined)) return false;
  return true;
}

function sourceLabelForTarget(target: AiJobTarget) {
  return target.url.includes("http") ? target.url.replace(/^https?:\/\//, "").split("/")[0] : target.url;
}

function locationHintPattern(homeRegion: string) {
  const home = homeRegionTerms(homeRegion).map(escapeRegExp);
  return wholeWordPattern(["Zurich", "Zürich", ...home, "St\\. Gallen", "Switzerland", "Remote", "Hybrid", "CH"]);
}

function defaultSearchIdea(homeRegion: string) {
  return homeRegion.trim() ? `Remote-first or hybrid around ${homeRegion.trim()}` : "Remote-first or hybrid";
}

function parseAiJobTargets(output = "", homeRegion = ""): AiJobTarget[] {
  const targets: AiJobTarget[] = [];
  const seen = new Set<string>();
  const seenUrls = new Set<string>();

  const pushTarget = (fields: Omit<AiJobTarget, "key">) => {
    const target = { ...fields, key: `${fields.company}-${fields.title}-${fields.url}` };
    if (!isUsefulAiTarget(target) || seen.has(target.key) || seenUrls.has(target.url)) return;
    targets.push(target);
    seen.add(target.key);
    seenUrls.add(target.url);
  };

  // PRIMARY — the format the model actually emits: one labelled markdown block per
  // job, e.g.
  //   **1. <Exact job title>**
  //   - **Company:** <co>   - **Location:** <loc>   - **Fit:** <NN>%
  //   - **Why it fits:** <reason>   - **Apply link:** [Apply via X](<url>)
  // Split before each numbered heading, then read the block's "**Label:** value"
  // lines. The old code had no block parser, so the only link ("[Apply via X](url)")
  // became the title and the reason was scraped from a raw text window — the bug
  // behind cards titled "Apply via Greenhouse" with company "Apply Link:".
  for (const block of output.split(/\n(?=\s*[*#]*\s*\d+\.\s+\S)/)) {
    const head = block.match(/^\s*[*#]*\s*\d+\.\s+(.+?)\s*\**\s*$/m);
    if (!head) continue;
    const fields: Record<string, string> = {};
    for (const line of block.split(/\n/)) {
      const field = line.match(/\*\*\s*([^*:]+?)\s*:?\s*\*\*\s*(.*)$/);
      if (field) fields[field[1].trim().toLowerCase()] = field[2].trim();
    }
    const urlSource = fields["apply link"] ?? fields["apply url"] ?? fields["apply"] ?? fields["link"] ?? fields["url"] ?? "";
    const urlMatch = urlSource.match(/\((https?:\/\/[^)\s]+)\)/) ?? urlSource.match(/https?:\/\/[^\s)]+/)
      ?? block.match(/\((https?:\/\/[^)\s]+)\)/) ?? block.match(/https?:\/\/[^\s)]+/);
    pushTarget({
      company: cleanAiTargetField(fields["company"] ?? ""),
      title: cleanAiTargetField(head[1]),
      location: cleanAiTargetField(fields["location"] ?? ""),
      url: urlMatch?.[1] ?? urlMatch?.[0] ?? "",
      reason: cleanAiTargetField(fields["why it fits"] ?? fields["alignment"] ?? fields["why"] ?? fields["reason"] ?? fields["match"] ?? "") || "Suggested by the AI search.",
      fit: extractFit(fields["fit"] ?? fields["fit score"] ?? fields["match"] ?? "") ?? extractFit(block),
    });
  }

  // FALLBACK 1 — markdown tables ("company | title | location | … " with a URL).
  const tableRows = output.split(/\n/).filter((line) => line.includes("|") && !/^\s*\|?\s*:?-+/.test(line));
  for (const row of tableRows) {
    const cells = row.split("|").map((cell) => stripMarkdown(cell)).filter(Boolean);
    const urlMatch = row.match(/\((https?:\/\/[^)\s]+)\)/) ?? row.match(/https?:\/\/[^\s|)]+/);
    const url = urlMatch?.[1] ?? urlMatch?.[0] ?? "";
    if (!url || cells.length < 4 || /rank|company|target role|job title/i.test(cells.join(" "))) continue;
    const withoutRank = /^\d+$/.test(cells[0]) ? cells.slice(1) : cells;
    // Prompt emits columns in "company, title, location" order — keep this in sync.
    pushTarget({
      company: cleanAiTargetField(withoutRank[0] ?? "Company"),
      title: cleanAiTargetField(withoutRank[1] ?? "Target role"),
      location: cleanAiTargetField(withoutRank[2] ?? ""),
      url,
      reason: withoutRank.slice(3).map(cleanAiTargetField).filter(Boolean).join(" · ") || "Suggested by AI search plan.",
      fit: extractFit(row),
    });
  }

  // FALLBACK 2 — loose "[label](url)" links with context scraped from nearby text.
  // Apply-button / search anchors are skipped so they never become a card title.
  for (const match of output.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    const label = cleanAiTargetField(match[1]);
    const url = match[2];
    if (seenUrls.has(url) || /google\.com\/search/i.test(url) || /^(view job|careers|filtered search|search zurich roles|link|apply\b.*)$/i.test(label)) continue;
    const nearby = output.slice(Math.max(0, (match.index ?? 0) - 220), Math.min(output.length, (match.index ?? 0) + 360));
    const heading = cleanAiTargetField(nearby.match(/\*\*([^*\n]+)\*\*/)?.[1] ?? "");
    const parts = label.split(/\s+[-–—]\s+|,\s+/);
    pushTarget({
      company: heading && !/view job|filtered|search|careers|^role:?$|apply/i.test(heading) ? heading : cleanAiTargetField(parts[0] || "AI target"),
      title: parts.length > 1 ? cleanAiTargetField(parts.slice(1).join(" - ")) : label,
      location: cleanAiTargetField(nearby.match(locationHintPattern(homeRegion))?.[0] ?? ""),
      url,
      reason: stripMarkdown(nearby.replace(/\n+/g, " ")).replace(/\bfit:?\s*\d{1,3}\s*%\s*[—–-]?\s*/i, "").slice(0, 240),
      fit: extractFit(nearby),
    });
  }

  return targets.slice(0, 200);
}

function actionState(application: JobApplication) {
  if (!application.nextActionAt) return { label: "No next action", tone: "muted" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(application.nextActionAt);
  next.setHours(0, 0, 0, 0);
  const diffDays = Math.round((next.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, tone: "bad" };
  if (diffDays === 0) return { label: "Due today", tone: "warn" };
  return { label: `Next in ${diffDays}d`, tone: "ok" };
}

function moveSection(sections: CvSection[], fromId: string, toId: string) {
  const fromIndex = sections.findIndex((section) => section.id === fromId);
  const toIndex = sections.findIndex((section) => section.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return sections;
  const next = [...sections];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

const sectionHeadings: Array<[CvSection["kind"], RegExp]> = [
  ["profile", /^(profile|summary|about|profil|kurzprofil|zusammenfassung|personal statement)$/i],
  ["experience", /^(professional|experience|professional experience|work experience|employment|employment history|career|career history|berufserfahrung|erfahrung|praxis|arbeitserfahrung)$/i],
  ["skills", /^(skills|core skills|technical skills|kompetenzen|faehigkeiten|fähigkeiten|technologies|technology|tools|stack)$/i],
  ["education", /^(education|ausbildung|studium|weiterbildung)$/i],
  ["languages", /^(languages|language skills|sprachen|sprachkenntnisse)$/i],
  ["speaking", /^(teaching\s*&\s*speaking|teaching and speaking|speaking|talks|workshops|unterricht|vortraege|vorträge)$/i],
  ["projects", /^(projects|selected projects|side projects|projekte|ausgewaehlte projekte|ausgewählte projekte)$/i],
  ["certificates", /^(certificates|certifications|zertifikate|licenses|licences)$/i],
  ["courses", /^(courses|training|trainings|kurse|weiterbildungen)$/i],
  ["awards", /^(awards|honors|honours|auszeichnungen)$/i],
  ["organisations", /^(organisations|organizations|memberships|mitgliedschaften|volunteering)$/i],
  ["publications", /^(publications|publikationen|articles|artikel)$/i],
  ["references", /^(references|referenzen)$/i],
  ["interests", /^(interests|hobbies|interessen)$/i],
  ["declaration", /^(declaration|erklaerung|erklärung)$/i],
];

const contentTemplates: Array<{
  kind: CvSection["kind"];
  title: string;
  description: string;
}> = [
  { kind: "education", title: "Education", description: "Degrees, schools, focus, honors, exchange terms." },
  { kind: "experience", title: "Professional Experience", description: "Roles, employers, dates, locations, and measurable impact." },
  { kind: "skills", title: "Skills", description: "Skill groups, tools, methods, and proficiency levels." },
  { kind: "languages", title: "Languages", description: "Languages, fluency levels, and extra communication details." },
  { kind: "certificates", title: "Certificates", description: "Certifications, licences, issuers, and completion dates." },
  { kind: "interests", title: "Interests", description: "Relevant personal interests that support the career story." },
  { kind: "projects", title: "Projects", description: "Projects, open source work, role, stack, and outcome." },
  { kind: "courses", title: "Courses", description: "Online or in-person courses and completed trainings." },
  { kind: "awards", title: "Awards", description: "Recognitions from industry, competitions, or academia." },
  { kind: "organisations", title: "Organisations", description: "Memberships or volunteering with role and dates." },
  { kind: "publications", title: "Publications", description: "Articles, books, papers, podcasts, or talks you authored." },
  { kind: "references", title: "References", description: "Reference people, relationship, and contact details." },
  { kind: "declaration", title: "Declaration", description: "Personal declaration, signature, or closing statement." },
  { kind: "speaking", title: "Teaching & Speaking", description: "Teaching, workshops, conference talks, and guest lectures." },
  { kind: "custom", title: "Custom", description: "A clean custom section for anything else." },
];

function normalizeImportedCvText(text: string) {
  const headingWords = [
    "Profile",
    "Summary",
    "Professional Experience",
    "Work Experience",
    "Experience",
    "Berufserfahrung",
    "Skills",
    "Kompetenzen",
    "Education",
    "Ausbildung",
    "Languages",
    "Sprachen",
    "Teaching & Speaking",
    "Teaching and Speaking",
    "Projects",
    "Projekte",
  ];
  let cleaned = text
    .replace(/\u00a0/g, " ")
    .replace(/[•●▪]/g, "\n- ")
    .replace(/\f/g, "\n")
    .replace(/\r/g, "\n");

  for (const heading of headingWords) {
    cleaned = cleaned.replace(new RegExp(`\\s+(${heading})\\s+`, "gi"), "\n$1\n");
  }

  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .filter((line) =>
      line &&
      !/^page\s+\d+(\s+of\s+\d+)?$/i.test(line) &&
      !/^\d+\s*\/\s*\d+$/.test(line) &&
      !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)
    );

  return lines.join("\n").trim();
}

function cvLines(text: string) {
  return normalizeImportedCvText(text)
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line &&
      !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) &&
      !/^[-–—]\s*\d+\s*[-–—]$/.test(line) &&
      !/^page\s+\d+(\s+of\s+\d+)?$/i.test(line)
    );
}

function sectionKind(line: string): CvSection["kind"] | undefined {
  const normalized = line.replace(/[:|]+$/g, "").trim();
  return sectionHeadings.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function isContactLine(line: string) {
  return /@|linkedin\.com|github\.com|https?:\/\/|www\.|\+\d|^\d[\d\s()./-]{6,}\d$|zurich|zürich|zuerich|switzerland|schweiz/i.test(line);
}

function looksLikeName(line: string) {
  const words = line.split(/\s+/);
  return words.length >= 2 && words.length <= 5 && line.length <= 70 && !isContactLine(line) && !sectionKind(line) && !/\d{2,}/.test(line);
}

function profileFromCvText(text: string, current: Profile): Profile {
  const lines = cvLines(text);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? current.email;
  const phone = text.match(/(?:\+|00)\d[\d\s()./-]{6,}\d/)?.[0]?.trim() ?? current.phone;
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s,)]+/i)?.[0] ?? current.linkedin;
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s,)]+/i)?.[0] ?? current.github;
  const websiteCandidates = [...text.matchAll(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s,)]+)?/gi)]
    .map((match) => match[0])
    .filter((candidate) =>
      !/linkedin|github|gmail|hotmail|outlook|icloud|bluewin|proton/i.test(candidate) &&
      candidate !== email.split("@")[1]
    );
  const website = websiteCandidates[0] ?? current.website;
  const nameLine = lines.find(looksLikeName);
  const headlineStart = lines.findIndex((line) =>
    line !== nameLine &&
    line.length <= 120 &&
    !isContactLine(line) &&
    !sectionKind(line) &&
    !/^(native|fluent|german|english|deutsch|englisch)$/i.test(line)
  );
  const headline = headlineStart >= 0
    ? lines.slice(headlineStart, headlineStart + 3)
      .filter((line) => !isContactLine(line) && !sectionKind(line) && !looksLikeName(line))
      .join(" ")
      .slice(0, 140)
    : current.headline;

  return {
    ...current,
    fullName: nameLine || current.fullName,
    headline: headline || current.headline,
    email,
    phone,
    linkedin,
    github,
    website,
    updatedAt: new Date().toISOString(),
  };
}

function addBucket(buckets: Map<CvSection["kind"], string[]>, kind: CvSection["kind"], line: string) {
  buckets.set(kind, [...(buckets.get(kind) ?? []), line]);
}

function inferLooseSections(lines: string[], buckets: Map<CvSection["kind"], string[]>) {
  if (!buckets.has("languages")) {
    const languages = lines.filter((line) => /^(german|deutsch|english|englisch|french|franzoesisch|französisch|italian|italienisch)\b/i.test(line));
    if (languages.length) buckets.set("languages", languages);
  }
  if (!buckets.has("skills")) {
    const skills = lines.filter((line) => /(react|typescript|javascript|node|next\.js|vue|express|python|ai|llm|claude|copilot|css|html|frontend|architecture)/i.test(line));
    if (skills.length) buckets.set("skills", [...new Set(skills)].slice(0, 12));
  }
  if (!buckets.has("education")) {
    const education = lines.filter((line) => /(university|universitaet|universität|bachelor|master|hslu|eth|fh|degree|diploma|apprenticeship|lehre|ausbildung)/i.test(line));
    if (education.length) buckets.set("education", education);
  }
  if (!buckets.has("experience")) {
    const start = lines.findIndex((line) => /(\d{2}\/\d{4}|\d{4}|present|heute|aktuell|lead|engineer|architect|developer|manager)/i.test(line));
    if (start >= 0) {
      const experience = lines.slice(start).filter((line) => !sectionKind(line) && !isContactLine(line));
      if (experience.length) buckets.set("experience", experience.slice(0, 80));
    }
  }
}

function sectionsFromCvText(text: string, baseSections: CvSection[]) {
  const lines = cvLines(text);
  const buckets = new Map<CvSection["kind"], string[]>();
  let current: CvSection["kind"] | undefined;
  const importedProfile = profileFromCvText(text, {
    id: "import",
    fullName: "",
    headline: "",
    email: "",
    phone: "",
    location: "",
    linkedin: "",
    github: "",
    website: "",
    targetRoles: [],
    workPreference: "",
    compensation: "",
    updatedAt: new Date().toISOString(),
  });

  for (const line of lines) {
    const matched = sectionKind(line);
    if (matched) {
      current = matched;
      continue;
    }
    if (
      line === importedProfile.fullName ||
      line === importedProfile.headline ||
      importedProfile.headline.includes(line) ||
      isContactLine(line)
    ) {
      continue;
    }
    current ??= "profile";
    addBucket(buckets, current, line);
  }

  if (buckets.size === 0 || [...buckets.values()].every((lines) => !lines.join("").trim())) {
    buckets.set("profile", lines.filter((line) => !isContactLine(line) && !sectionKind(line)).slice(0, 12));
  }
  inferLooseSections(lines, buckets);

  const merged = baseSections.map((section) => {
    const bucketLines = buckets.get(section.kind);
    const content = section.kind === "profile"
      ? bucketLines?.join(" ").replace(/\s{2,}/g, " ").trim()
      : bucketLines?.join("\n").trim();
    return content ? { ...section, content, enabled: true } : section;
  });
  for (const [kind, lines] of buckets.entries()) {
    if (merged.some((section) => section.kind === kind) || !lines.join("").trim()) continue;
    const template = contentTemplates.find((item) => item.kind === kind);
    merged.push({
      id: `section_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: template?.title ?? kind,
      kind,
      content: lines.join("\n").trim(),
      enabled: true,
    });
  }
  return merged;
}

const onboardingCopy = {
  en: {
    steps: ["Welcome", "Document folder", "AI assistant", "Build your CV"],
    skip: "Skip",
    back: "Back",
    next: "Continue",
    finish: "Finish setup",
    welcomeTitle: "Welcome to Job Central",
    welcomeBody: "Let's set up your own job hunt in a few steps: who you are, your real CV, and the exact roles you are targeting. Nothing here is preset — everything below becomes your personal search and tailored applications.",
    language: "Language",
    aboutTitle: "About you",
    aboutBody: "This appears on your CV and applications. You can refine it later in the CV studio.",
    cvTitle: "Build your CV",
    cvBody: "Drop your CVs, work certificates and diplomas — agy reads them, builds your master CV, and you pick which projects make the cut. It works only from your documents — always review what it writes before you use it.",
    cvImport: "Upload PDF / DOCX / TXT",
    cvPlaceholder: "Or paste your existing CV, LinkedIn export, or raw career history here.",
    cvDetected: "Detected sections",
    cvEmpty: "No CV yet — you can paste text above or skip and build it later.",
    goalTitle: "What are you aiming for?",
    goalBody: "This replaces the old fixed targets and drives every search and tailored CV. Separate entries with commas.",
    roles: "Target roles / titles",
    rolesPh: "e.g. Product Manager, UX Designer, Data Analyst",
    locations: "Locations & work setup",
    locationsPh: "e.g. Zurich, Remote, Hybrid Switzerland",
    include: "Must-have keywords (optional)",
    includePh: "e.g. SaaS, Figma, SQL",
    exclude: "Exclude keywords (optional)",
    excludePh: "e.g. Internship, Sales",
    targetCompanies: "Target companies (optional)",
    targetCompaniesPh: "e.g. Google, Roche, On",
    excludedCompanies: "Excluded companies (optional)",
    aiTitle: "Connect an AI assistant (optional)",
    aiBody: "Job Central uses a local AI CLI to tailor CVs and write cover letters. Detect what's installed, or skip and add one later in Settings.",
    aiDetect: "Detect AI tools",
    aiNone: "Continue without AI for now",
    aiInstalled: "Detected",
    aiMissing: "Not found",
    finishing: "Saving your setup",
    nameRequired: "Please enter your name to continue.",
  },
  de: {
    steps: ["Willkommen", "Dokumentenordner", "AI-Assistent", "CV aufbauen"],
    skip: "Überspringen",
    back: "Zurück",
    next: "Weiter",
    finish: "Einrichtung abschliessen",
    welcomeTitle: "Willkommen bei Job Central",
    welcomeBody: "Richten wir deine Jobsuche in wenigen Schritten ein: wer du bist, dein echtes CV und die Rollen, die du anvisierst. Nichts ist vorgegeben — alles hier wird zu deiner persönlichen Suche und zu massgeschneiderten Bewerbungen.",
    language: "Sprache",
    aboutTitle: "Über dich",
    aboutBody: "Das erscheint auf deinem CV und in Bewerbungen. Du kannst es später im CV-Studio verfeinern.",
    cvTitle: "Dein CV aufbauen",
    cvBody: "Wirf deine CVs, Arbeitszeugnisse und Diplome ein — agy liest sie, baut dein Master-CV und du wählst, welche Projekte reinkommen. Es arbeitet nur mit deinen Dokumenten — prüf aber immer, was es schreibt.",
    cvImport: "PDF / DOCX / TXT hochladen",
    cvPlaceholder: "Oder füge hier dein bestehendes CV, einen LinkedIn-Export oder deinen Werdegang ein.",
    cvDetected: "Erkannte Abschnitte",
    cvEmpty: "Noch kein CV — du kannst oben Text einfügen oder später erstellen.",
    goalTitle: "Was ist dein Ziel?",
    goalBody: "Das ersetzt die alten fixen Vorgaben und steuert jede Suche und jedes massgeschneiderte CV. Trenne Einträge mit Kommas.",
    roles: "Zielrollen / Titel",
    rolesPh: "z.B. Product Manager, UX Designer, Data Analyst",
    locations: "Orte & Arbeitsmodell",
    locationsPh: "z.B. Zürich, Remote, Hybrid Schweiz",
    include: "Wichtige Stichworte (optional)",
    includePh: "z.B. SaaS, Figma, SQL",
    exclude: "Auszuschliessende Stichworte (optional)",
    excludePh: "z.B. Praktikum, Sales",
    targetCompanies: "Zielunternehmen (optional)",
    targetCompaniesPh: "z.B. Google, Roche, On",
    excludedCompanies: "Ausgeschlossene Unternehmen (optional)",
    aiTitle: "AI-Assistent verbinden (optional)",
    aiBody: "Job Central nutzt ein lokales AI-CLI, um CVs anzupassen und Motivationsschreiben zu verfassen. Erkenne installierte Tools oder füge später in den Einstellungen eines hinzu.",
    aiDetect: "AI-Tools erkennen",
    aiNone: "Vorerst ohne AI fortfahren",
    aiInstalled: "Erkannt",
    aiMissing: "Nicht gefunden",
    finishing: "Einrichtung wird gespeichert",
    nameRequired: "Bitte gib deinen Namen ein, um fortzufahren.",
  },
} as const;

function OnboardingWizard({
  data,
  setData,
  run,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
}) {
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState<"en" | "de">(data.settings.language);
  const [profileDraft, setProfileDraft] = useState<Profile>(data.profile);
  const [cvText, setCvText] = useState("");
  const [roles, setRoles] = useState(data.settings.search.targetRoles.join(", "));
  const [locations, setLocations] = useState(data.settings.search.locations.join(", "));
  const [includeKeywords, setIncludeKeywords] = useState(data.settings.search.positiveKeywords.join(", "));
  const [excludeKeywords, setExcludeKeywords] = useState(data.settings.search.negativeKeywords.join(", "));
  const [targetCompanies, setTargetCompanies] = useState(data.settings.search.targetCompanies.join(", "));
  const [excludedCompanies, setExcludedCompanies] = useState(data.settings.search.excludedCompanies.join(", "));
  const [engineTest, setEngineTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [engineBusy, setEngineBusy] = useState<null | "install" | "test">(null);
  const [zeugApplied] = useState(false);
  // True once the imported CV has been written to the master CV (so the agy material
  // chat refines real data, and finish() won't clobber those refinements).
  const [masterSeeded, setMasterSeeded] = useState(false);

  const t = onboardingCopy[language];
  const agy = data.aiProviders.find((provider) => provider.key === "agy");
  const otherEngines = data.aiProviders.filter((provider) => provider.key !== "agy" && provider.key !== "custom");
  const totalSteps = t.steps.length;
  const nameReady = Boolean(profileDraft.fullName.trim());

  function setField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfileDraft((prev) => ({ ...prev, [key]: value }));
  }

  function applyImportedText(rawText: string) {
    const cleaned = normalizeImportedDocumentText(rawText);
    setCvText(cleaned);
    const importedProfile = profileFromImportedCvText(cleaned, profileDraft);
    // Manual edits win; only fill fields the user left blank.
    setProfileDraft((prev) => ({
      ...importedProfile,
      ...Object.fromEntries(Object.entries(prev).filter(([, value]) => typeof value === "string" && value.trim())),
    }) as Profile);
    // Seed the goal from the CV itself (headline → target role, CV location →
    // where), so these fields reflect the uploaded CV rather than stale/blank
    // defaults. The user can still edit them on the next step.
    if (importedProfile.headline?.trim()) setRoles(importedProfile.headline.trim());
    if (importedProfile.location?.trim()) setLocations(importedProfile.location.trim());
  }

  async function importCv() {
    await run(language === "de" ? "CV importieren" : "Importing CV", async () => {
      const result = await jobCentral().importCvDocument();
      if (result.text) applyImportedText(result.text);
      return result;
    });
  }

  async function finish(selectedProvider?: AiProvider["key"]) {
    await run(t.finishing, async () => {
      await jobCentral().setLanguage(language);
      // Profile + target roles were filled by Analyze (from the documents) and refined in
      // the chat — there are no About-you/Goal forms anymore, so persist the CURRENT values.
      // saveProfile also wires up the self workspace. The master CV was built in the workbench.
      await jobCentral().saveProfile(data.profile);
      await jobCentral().updateSearchPreferences(data.settings.search);
      if (selectedProvider) await jobCentral().selectAiProvider(selectedProvider);
      const next = await jobCentral().completeOnboarding();
      setData(next);
      return next;
    }, () => (language === "de" ? "Bereit. Viel Erfolg!" : "All set. Good luck!"));
  }

  // Persist the language the MOMENT it's chosen — not deferred to finish(), because the
  // folder-first/build and skip completion paths don't call finish(), which previously left
  // the choice unsaved (settings.language stayed "en" → the whole app rendered English).
  // setData here also switches the live UI to the chosen language immediately.
  async function chooseLanguage(lang: "en" | "de") {
    setLanguage(lang);
    const next = await jobCentral().setLanguage(lang);
    setData(next);
  }

  // Existing users who already set up can leave the wizard without overwriting
  // their data — this only marks onboarding complete and closes it.
  async function skipSetup() {
    await run(language === "de" ? "Einrichtung übersprungen" : "Skipping setup", async () => {
      const next = await jobCentral().completeOnboarding();
      setData(next);
      return next;
    });
  }

  function goNext() {
    setStep((current) => Math.min(current + 1, totalSteps - 1));
  }
  function goBack() {
    setStep((current) => Math.max(current - 1, 0));
  }
  // The AI step is no longer the last step, so engine selection must advance the
  // wizard rather than finish onboarding. finish() runs on the final (folder) step.
  async function selectEngineAndContinue(providerKey?: AiProvider["key"]) {
    if (providerKey) {
      const next = await run(language === "de" ? "Engine wählen" : "Selecting engine", async () => {
        const updated = await jobCentral().selectAiProvider(providerKey);
        setData(updated);
        return updated;
      });
      if (!next) return; // selection failed — stay on the AI step rather than advancing engine-less
    }
    goNext();
  }

  return (
    <div className="onboarding">
      <aside className="onboarding-rail">
        <div className="brand">
          <div className="brand-mark">JC</div>
          <strong>Job Central</strong>
        </div>
        <ol className="onboarding-steps">
          {t.steps.map((label, index) => (
            <li key={label} className={index === step ? "active" : index < step ? "done" : ""}>
              <span>{index < step ? <Check size={14} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <button className="onboarding-skip-all" onClick={skipSetup}>
          <X size={14} /> {language === "de" ? "Überspringen – schon erledigt" : "Skip — already set up"}
        </button>
      </aside>

      <main className="onboarding-main">
        <div className="onboarding-panel">
          {step === 0 ? (
            <div className="onboarding-step">
              <Sparkles size={30} className="onboarding-icon" />
              <h1>{t.welcomeTitle}</h1>
              <p>{t.welcomeBody}</p>
              <div className="onboarding-lang">
                <span>{t.language}</span>
                <div className="seg-control">
                  <button className={language === "en" ? "active" : ""} onClick={() => void chooseLanguage("en")}>English</button>
                  <button className={language === "de" ? "active" : ""} onClick={() => void chooseLanguage("de")}>Deutsch</button>
                </div>
              </div>
            </div>
          ) : null}


          {step === 3 ? (
            <div className="onboarding-step onboarding-step--wide">
              <FileText size={28} className="onboarding-icon" />
              <h1>{t.cvTitle}</h1>
              <p>{t.cvBody}</p>
              <CvWorkbench
                data={data}
                setData={setData}
                run={run}
                isDe={language === "de"}
                targetRole={roles}
                markSeeded={() => setMasterSeeded(true)}
              />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-step">
              <Bot size={28} className="onboarding-icon" />
              <h1>{t.aiTitle}</h1>
              <p>{t.aiBody}</p>

              <div className="engine-setup">
                <div className="engine-setup-head">
                  <div>
                    <strong>Antigravity (agy)</strong>
                    <span>{language === "de" ? "Empfohlen — Googles KI-Engine, nutzt dein Google-Konto (AI Pro/Ultra). Kein Node oder Homebrew nötig." : "Recommended — Google's AI engine, uses your Google account (AI Pro/Ultra). No Node or Homebrew needed."}</span>
                  </div>
                  <span className={`engine-badge ${engineTest?.ok ? "ok" : agy?.detected ? "warn" : "missing"}`}>
                    {engineTest?.ok ? (language === "de" ? "Bereit" : "Ready") : agy?.detected ? (language === "de" ? "Installiert" : "Installed") : (language === "de" ? "Nicht installiert" : "Not installed")}
                  </span>
                </div>

                <ol className="engine-steps">
                  <li className={agy?.detected ? "done" : "active"}>
                    <div>
                      <strong>{language === "de" ? "1. Engine installieren" : "1. Install the engine"}</strong>
                      <span>{engineBusy === "install" ? (language === "de" ? "Engine wird heruntergeladen — das kann eine Minute dauern…" : "Downloading the engine — this can take a minute…") : agy?.detected ? (language === "de" ? `Installiert (${agy.version ?? "bereit"})` : `Installed (${agy.version ?? "ready"})`) : (language === "de" ? "Ein Klick — lädt eine eigenständige Binary herunter." : "One click — downloads a self-contained binary.")}</span>
                    </div>
                    {agy?.detected
                      ? <Check size={18} className="engine-step-ok" />
                      : engineBusy === "install"
                        ? <span className="engine-working"><Loader2 size={16} className="spin" /> {language === "de" ? "Installiere…" : "Installing…"}</span>
                        : <button className="primary small" onClick={() => {
                            setEngineBusy("install");
                            void run(language === "de" ? "KI-Engine wird installiert" : "Installing AI engine", async () => {
                              const next = await jobCentral().installCli("agy");
                              setData(next);
                              return next;
                            }).finally(() => setEngineBusy(null));
                          }}><Download size={15} /> {language === "de" ? "Installieren" : "Install"}</button>}
                  </li>
                  <li className={engineTest?.ok ? "done" : agy?.detected ? "active" : ""}>
                    <div>
                      <strong>{language === "de" ? "2. Mit Google anmelden" : "2. Sign in with Google"}</strong>
                      <span>{language === "de" ? "Öffnet ein Terminal mit agy — bestätige im Browser und komm dann zurück." : "Opens a Terminal running agy — approve in your browser, then come back."}</span>
                    </div>
                    <button className="secondary small" disabled={!agy?.detected} onClick={() => run(language === "de" ? "Anmeldung wird geöffnet" : "Opening sign-in", async () => {
                      await jobCentral().loginCli("agy");
                      return undefined;
                    })}><ExternalLink size={15} /> {language === "de" ? "Anmelden" : "Sign in"}</button>
                  </li>
                  <li className={engineTest?.ok ? "done" : engineBusy === "test" ? "active" : ""}>
                    <div>
                      <strong>{language === "de" ? "3. Verbindung testen" : "3. Test the connection"}</strong>
                      <span>{engineBusy === "test" ? (language === "de" ? "Die Engine wird um eine Antwort gebeten — ein paar Sekunden…" : "Asking the engine to answer — a few seconds…") : engineTest ? engineTest.message : (language === "de" ? "Bestätigt, dass die Engine antwortet." : "Confirms the engine answers.")}</span>
                    </div>
                    {engineTest?.ok
                      ? <Check size={18} className="engine-step-ok" />
                      : engineBusy === "test"
                        ? <span className="engine-working"><Loader2 size={16} className="spin" /> {language === "de" ? "Teste…" : "Testing…"}</span>
                        : <button className="secondary small" disabled={!agy?.detected} onClick={() => {
                            setEngineBusy("test");
                            void run(language === "de" ? "Engine wird getestet" : "Testing engine", async () => {
                              const result = await jobCentral().testCli("agy");
                              setEngineTest(result);
                              return result;
                            }, (r) => r.ok ? (language === "de" ? "Verbunden!" : "Connected!") : (language === "de" ? "Noch nicht verbunden" : "Not connected yet")).finally(() => setEngineBusy(null));
                          }}><Sparkles size={15} /> {language === "de" ? "Testen" : "Test"}</button>}
                  </li>
                </ol>

                <button className="primary engine-finish" disabled={!agy?.detected} onClick={() => selectEngineAndContinue("agy")}>
                  <Check size={16} /> {engineTest?.ok ? (language === "de" ? "Antigravity nutzen & weiter" : "Use Antigravity & continue") : (language === "de" ? "Antigravity nutzen" : "Use Antigravity")}
                </button>
              </div>

              <details className="engine-alt">
                <summary>{language === "de" ? "Nutzt du bereits eine andere KI-CLI?" : "Already use a different AI CLI?"}</summary>
                <button className="secondary small" onClick={() => run(t.aiDetect, async () => {
                  const next = await jobCentral().detectAiProviders();
                  setData(next);
                  return next;
                })}><RefreshCw size={15} /> {t.aiDetect}</button>
                <div className="onboarding-providers">
                  {otherEngines.map((provider) => (
                    <button
                      key={provider.key}
                      className={`onboarding-provider${provider.detected ? "" : " disabled"}`}
                      disabled={!provider.detected}
                      onClick={() => selectEngineAndContinue(provider.key)}
                    >
                      <strong>{provider.label}</strong>
                      <span className={provider.detected ? "ok" : "missing"}>{provider.detected ? t.aiInstalled : t.aiMissing}</span>
                    </button>
                  ))}
                </div>
              </details>

              <button className="link-button" onClick={() => selectEngineAndContinue()}>{t.aiNone}</button>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="onboarding-step">
              <FolderOpen size={28} className="onboarding-icon" />
              <h1>{language === "de" ? "Dokumentenordner" : "Document folder"}</h1>
              <p>
                {language === "de"
                  ? "Wähle einen Ordner — Job Central legt dort automatisch alle CVs, Anschreiben und dein Profil ab (.md/.pdf/.docx), pro Job ein Unterordner. Optional, du kannst es auch später in den Einstellungen festlegen."
                  : "Pick a folder — Job Central keeps a tidy copy of every CV, letter and your profile there (.md/.pdf/.docx), one sub-folder per job. Optional; you can also set this later in Settings."}
              </p>
              {data.settings.workspaceFolder?.rootPath ? (
                <p className="onboarding-folder-set"><Check size={14} /> {data.settings.workspaceFolder.rootPath}</p>
              ) : null}
              <button
                className="secondary"
                onClick={() => run(language === "de" ? "Ordner wählen" : "Choosing folder", () => jobCentral().selectMirrorFolder().then((next) => (setData(next), next)))}
              >
                <FolderOpen size={17} /> {data.settings.workspaceFolder?.rootPath ? (language === "de" ? "Ordner ändern" : "Change folder") : (language === "de" ? "Ordner wählen" : "Choose folder")}
              </button>
            </div>
          ) : null}
        </div>

        <footer className="onboarding-footer">
          <button className="ghost" onClick={goBack} disabled={step === 0}><ArrowLeft size={16} /> {t.back}</button>
          <div className="onboarding-footer-right">
            {step === 3 ? <button className="ghost" onClick={goNext}>{t.skip}</button> : null}
            {step < totalSteps - 1 ? (
              <button className="primary" onClick={goNext}>{t.next} <ArrowRight size={16} /></button>
            ) : (
              <button className="primary" onClick={() => finish()}><Check size={16} /> {t.finish}</button>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}

// agy's model has no CLI flag — it lives in ~/.gemini/antigravity-cli/settings.json.
// This reads the current value and lets the user set any model name (so a new
// model works the moment it ships, without a hardcoded list to maintain).
// Curated agy/Antigravity model names (display names — agy stores these verbatim
// in its own config). Starting set; "Custom…" covers anything from agy's /model
// menu, and the user's current value is always preserved. TODO: replace with the
// live model_probe.py list once the agy TUI scrape is tuned.
const AGY_MODELS = [
  "Gemini 3.5 Flash (High)",
  "Gemini 3.5 Flash (Medium)",
  "Gemini 3.1 Pro",
];

function AgyModelControl({ onActivated, isDe }: { onActivated?: (data: AppData) => void; isDe: boolean }) {
  const [model, setModel] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    jobCentral().getAgyModel().then((value) => {
      if (cancelled) return;
      setModel(value);
      setDraft(value ?? "");
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function saveValue(value: string) {
    setSaving(true);
    setNote(null);
    try {
      const saved = await jobCentral().setAgyModel(value.trim());
      setModel(saved);
      setDraft(saved ?? "");
      setEditing(false);
      // Picking an agy model means the user wants agy — make it the active engine
      // so runs actually use it (the model picker and the active provider can never
      // silently disagree, which is what made it look like the choice "didn't stick").
      const next = await jobCentral().selectAiProvider("agy");
      onActivated?.(next);
      setNote(isDe ? "Gespeichert — agy ist jetzt deine aktive Engine." : "Saved — agy is now your active engine.");
      window.setTimeout(() => setNote(null), 2600);
    } catch (error) {
      setNote(error instanceof Error ? error.message : (isDe ? "Modell konnte nicht gespeichert werden." : "Could not save the model."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agy-model">
      {editing ? (
        <div className="agy-model-edit">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void saveValue(draft); if (event.key === "Escape") { setDraft(model ?? ""); setEditing(false); } }}
            placeholder={isDe ? "z. B. Gemini 3.5 Flash (High)" : "e.g. Gemini 3.5 Flash (High)"}
            spellCheck={false}
            autoFocus
          />
          <button className="secondary small" disabled={saving} onClick={() => void saveValue(draft)}>{saving ? (isDe ? "Speichern…" : "Saving…") : (isDe ? "Speichern" : "Save")}</button>
          <button className="ghost small" onClick={() => { setDraft(model ?? ""); setEditing(false); }}>{isDe ? "Abbrechen" : "Cancel"}</button>
        </div>
      ) : (
        <select
          className="agy-model-select"
          disabled={saving}
          value={model && AGY_MODELS.includes(model) ? model : "__current"}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "__custom") { setDraft(model ?? ""); setEditing(true); return; }
            if (value === "__current") return;
            void saveValue(value);
          }}
          title={isDe ? "Antigravity-(agy-)Modell auswählen" : "Choose the Antigravity (agy) model"}
        >
          {model && AGY_MODELS.includes(model) ? null : <option value="__current">{model || (isDe ? "Account-Standard" : "Account default")}</option>}
          {AGY_MODELS.map((name) => <option key={name} value={name}>{name}</option>)}
          <option value="__custom">{isDe ? "Benutzerdefiniert…" : "Custom…"}</option>
        </select>
      )}
      {note ? <small className="agy-model-note">{note}</small> : <small className="agy-model-hint">{isDe ? "agy speichert sein Modell selbst — wähle eines oder 'Benutzerdefiniert…' für einen genauen Namen aus Antigravitys Menü." : "agy stores its own model — pick one, or 'Custom…' for any exact name from Antigravity's menu."}</small>}
    </div>
  );
}

// Circular fit gauge for a search-result card (0-100). Green/amber/grey by band.
// When onExplain is given it becomes a button: click to see why this fit.
function FitRing({ value, onExplain, isDe }: { value: number; onExplain?: () => void; isDe?: boolean }) {
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const dash = (pct / 100) * circumference;
  const color = pct >= 80 ? "#22c55e" : pct >= 65 ? "#f59e0b" : "#94a3b8";
  const inner = (
    <svg width="50" height="50" viewBox="0 0 50 50" aria-hidden="true">
      <circle cx="25" cy="25" r={radius} fill="none" stroke="var(--line-strong)" strokeWidth="4" />
      <circle
        cx="25" cy="25" r={radius} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`} transform="rotate(-90 25 25)"
      />
      <text x="25" y="25" textAnchor="middle" dominantBaseline="central" fill={color} fontSize="15" fontWeight="800">{pct}</text>
    </svg>
  );
  if (onExplain) {
    return (
      <button
        type="button"
        className="fit-ring fit-ring-button"
        title={isDe ? `${pct}% Passung — klicken, um den Grund zu sehen` : `${pct}% fit — click to see why`}
        onClick={(event) => { event.stopPropagation(); onExplain(); }}
      >
        {inner}
      </button>
    );
  }
  return <div className="fit-ring" title={isDe ? `${pct}% Passung für deine Zielrollen` : `${pct}% fit for your target roles`}>{inner}</div>;
}

// Paste-anything intake: drop old CVs / LinkedIn text / notes and agy merges the
// real facts into the master CV (and keeps the raw text as a source document for
// future tailoring). Used in onboarding and in the CV section. `prepare` lets the
// onboarding flow persist the imported CV to the master before agy refines it.
function AgyMaterialChat({
  setData,
  isDe,
  prepare,
}: {
  setData: (data: AppData) => void;
  isDe: boolean;
  prepare?: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Array<{ role: "you" | "agy"; text: string }>>([]);
  const logRef = useRef<HTMLDivElement>(null);
  // Keep the newest message in view, and cap history so a heavy session can't grow
  // the log unbounded.
  const appendLog = (entry: { role: "you" | "agy"; text: string }) =>
    setLog((prev) => [...prev, entry].slice(-50));
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, busy]);

  async function send() {
    const material = text.trim();
    if (!material || busy) return;
    setBusy(true);
    appendLog({ role: "you", text: material });
    setText("");
    try {
      if (prepare) await prepare();
      const res = await jobCentral().ingestCvMaterial({ text: material });
      setData(res.data);
      appendLog({ role: "agy", text: res.summary || (isDe ? "CV aktualisiert." : "Updated your CV.") });
    } catch (error) {
      appendLog({ role: "agy", text: error instanceof Error ? error.message : "Error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agy-material">
      <strong>{isDe ? "Material einwerfen — agy nutzt es für dein CV" : "Drop in material — agy uses it for your CV"}</strong>
      <span className="panel-help">
        {isDe
          ? "Füge alte CVs, LinkedIn-Text oder Notizen ein. agy übernimmt Fakten daraus in dein Master-CV — prüf das Ergebnis."
          : "Paste old CVs, LinkedIn text or notes — agy merges the facts into your master CV; review the result."}
      </span>
      {log.length || busy ? (
        <div className="agy-material-log" ref={logRef}>
          {log.map((message, index) => (
            <div key={index} className={message.role}>
              <strong>{message.role === "you" ? (isDe ? "Du" : "You") : "agy"}</strong>
              <p>{message.text}</p>
            </div>
          ))}
          {busy ? <div className="agy"><strong>agy</strong><p className="agy-typing"><Loader2 size={13} className="spin" /> …</p></div> : null}
        </div>
      ) : null}
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={isDe ? "Hier einfügen… (⌘/Ctrl+Enter zum Senden)" : "Paste here… (⌘/Ctrl+Enter to send)"}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }}
      />
      <button className="primary small" disabled={busy || !text.trim()} onClick={() => void send()}>
        {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {isDe ? "An agy senden" : "Send to agy"}
      </button>
    </div>
  );
}

function kindLabel(kind: SourceDocument["kind"], isDe: boolean): string {
  if (kind === "cv") return "CV";
  if (kind === "zeugnis") return isDe ? "Zeugnis / Diplom" : "Certificate";
  return isDe ? "Dokument" : "Document";
}

// The CV workbench: one drop field for ALL documents (collect) → one AI "Build my CV"
// (build) → a source-cited project picker + the persistent agy chat (refine). Replaces
// the old four-control CV step. AI-only intake (no deterministic paste box) per the
// AI-first product. Stacked to fit the onboarding wizard's narrow column.
function CvWorkbench({
  data,
  setData,
  run,
  isDe,
  targetRole,
  markSeeded,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  isDe: boolean;
  targetRole: string;
  markSeeded: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<null | "ingest" | "build" | "tailor">(null);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState(targetRole.split(",")[0]?.trim() ?? "");
  // Default doc language = the user's primary language; opt-in to also build the other.
  const [cvLang, setCvLang] = useState<"en" | "de">(data.settings.language);
  const otherLang: "en" | "de" = cvLang === "de" ? "en" : "de";
  const otherLangName = isDe
    ? (otherLang === "de" ? "Deutsch" : "Englisch")
    : (otherLang === "de" ? "German" : "English");
  const [alsoOtherLang, setAlsoOtherLang] = useState(false);
  // Unified intake: pasted text is added as a SOURCE (built from on Analyze), not an
  // immediate refine — that's the separate post-build agy chat.
  const [pasteText, setPasteText] = useState("");

  const sources = data.sourceDocuments ?? [];
  const projects: CvProject[] = (data.cvProjects ?? []).slice().sort((a, b) => a.order - b.order);
  const builtCv = data.masterCv.sections.filter((section) => section.enabled && section.content.trim());

  async function ingestFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    const paths = arr.map((file) => { try { return jobCentral().getPathForFile(file); } catch { return ""; } }).filter(Boolean);
    if (!paths.length) {
      setMessage(isDe ? "Diese Dateien konnten nicht gelesen werden." : "Couldn't read those files.");
      return;
    }
    setBusy("ingest");
    try {
      await run(isDe ? "Dokumente einlesen" : "Reading documents", async () => {
        const next = await jobCentral().importDocumentPaths(paths);
        setData(next);
        return next;
      });
    } finally {
      setBusy(null);
    }
  }

  async function removeDoc(id: string) {
    await run(isDe ? "Entfernen" : "Removing", async () => {
      const next = await jobCentral().removeSourceDocument(id);
      setData(next);
      return next;
    });
  }

  async function addPastedSource() {
    const t = pasteText.trim();
    if (!t || busy !== null) return;
    setBusy("ingest");
    try {
      const next = await jobCentral().addTextSource(t);
      setData(next);
      setPasteText("");
    } finally {
      setBusy(null);
    }
  }

  async function build() {
    setBusy("build");
    setMessage("");
    try {
      const res = await jobCentral().buildCvFromSources({ targetLang: cvLang });
      setData(res.data);
      markSeeded();
      let summary = res.summary;
      // Opt-in: also produce the other-language master CV (translate-on-demand).
      if (alsoOtherLang) {
        const tr = await jobCentral().translateCv({ cvId: "master", targetLang: otherLang });
        setData(tr.data);
        summary = `${summary} ${tr.summary}`.trim();
      }
      setMessage(summary);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isDe ? "Fehler" : "Error"));
    } finally {
      setBusy(null);
    }
  }

  async function tailor() {
    const wanted = role.trim();
    if (!wanted) return;
    setBusy("tailor");
    try {
      const res = await jobCentral().tailorProjects({ targetRole: wanted });
      setData(res.data);
      markSeeded();
      setMessage(res.summary);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isDe ? "Fehler" : "Error"));
    } finally {
      setBusy(null);
    }
  }

  async function toggleProject(id: string, included: boolean) {
    // Preserve each project's existing order — only flip the toggled one's included flag,
    // so toggling never reshuffles the list.
    const payload = projects.map((project) => ({ id: project.id, included: project.id === id ? included : project.included, order: project.order }));
    const updated = await jobCentral().setCvProjects({ projects: payload, targetRole: role.trim() || undefined });
    setData(updated);
    markSeeded();
  }

  // Persist a master-CV style/template change from the onboarding design controls.
  // Picking a template also adopts its signature accent + density (matches CV Studio).
  async function saveStyle(patch: { template?: CvDocument["template"]; accentColor?: string; density?: CvDocument["style"]["density"]; showPhoto?: boolean }) {
    const template = patch.template ?? data.masterCv.template;
    const defaults = patch.template ? templateDefaults[patch.template] : undefined;
    const next: CvDocument = {
      ...data.masterCv,
      template,
      style: {
        ...data.masterCv.style,
        ...(defaults ?? {}),
        ...(patch.accentColor !== undefined ? { accentColor: patch.accentColor } : {}),
        ...(patch.density !== undefined ? { density: patch.density } : {}),
        ...(patch.showPhoto !== undefined ? { showPhoto: patch.showPhoto } : {}),
      },
    };
    setData(await jobCentral().saveMasterCv(next));
  }

  return (
    <div className="cv-workbench">
      <div className="cvw-main">
      <section className="cvw-zone">
        <div className="cvw-zone-head">
          <strong>{isDe ? "1 · Unterlagen einwerfen" : "1 · Drop your documents"}</strong>
          <span>{isDe ? "CVs, Arbeitszeugnisse, Diplome. agy baut dein Master-CV daraus — prüf das Ergebnis." : "CVs, Arbeitszeugnisse, diplomas. agy builds your master CV from them — review what it writes."}</span>
        </div>
        <div
          className={`cvw-dropzone${dragging ? " dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void ingestFiles(event.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click(); } }}
        >
          <Upload size={22} />
          <strong>{isDe ? "Dateien hierher ziehen" : "Drop files here"}</strong>
          <span>{isDe ? "oder klicken zum Auswählen · PDF, DOCX, TXT" : "or click to browse · PDF, DOCX, TXT"}</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md"
          style={{ display: "none" }}
          onChange={(event) => { if (event.target.files) void ingestFiles(event.target.files); event.target.value = ""; }}
        />
        {sources.length ? (
          <ul className="cvw-sources">
            {sources.map((doc) => (
              <li key={doc.id}>
                <FileText size={15} />
                <div className="cvw-source-meta">
                  <strong>{doc.name}</strong>
                  <span>{kindLabel(doc.kind, isDe)} · {doc.words} {isDe ? "Wörter" : "words"}</span>
                </div>
                <button className="row-icon-button" title={isDe ? "Entfernen" : "Remove"} onClick={() => void removeDoc(doc.id)}><X size={15} /></button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="cvw-paste">
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={isDe ? "…oder Text einfügen: LinkedIn, Notizen, alter CV — wird mitanalysiert (⌘/Ctrl+Enter)" : "…or paste text: LinkedIn, notes, an old CV — analyzed with your docs (⌘/Ctrl+Enter)"}
            disabled={busy !== null}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void addPastedSource(); } }}
          />
          <button className="secondary small cvw-paste-add" disabled={!pasteText.trim() || busy !== null} onClick={() => void addPastedSource()}>
            <Plus size={14} /> {isDe ? "Als Quelle hinzufügen" : "Add as source"}
          </button>
        </div>
        <div className="cvw-lang-row">
          <span className="cvw-lang-label">{isDe ? "CV-Sprache" : "CV language"}</span>
          <div className="cv-lang-toggle" title={isDe ? "Sprache, in der agy dein CV baut" : "Language agy builds your CV in"}>
            {(["de", "en"] as const).map((l) => (
              <button key={l} type="button" className={cvLang === l ? "active" : ""} disabled={busy !== null} onClick={() => setCvLang(l)}>
                {l === "de" ? "DE" : "EN"}
              </button>
            ))}
          </div>
          <label className="cvw-also-lang">
            <input type="checkbox" checked={alsoOtherLang} onChange={(event) => setAlsoOtherLang(event.target.checked)} disabled={busy !== null} />
            {isDe ? `Auch auf ${otherLangName}` : `Also in ${otherLangName}`}
          </label>
        </div>
        <button className="primary cvw-build" disabled={!sources.length || busy !== null} onClick={() => void build()}>
          {busy === "build"
            ? <><Loader2 size={16} className="spin" /> {isDe ? "Analysiere deine Unterlagen…" : "Analyzing your documents…"}</>
            : <><Sparkles size={16} /> {builtCv.length || projects.length ? (isDe ? "Erneut analysieren" : "Re-analyze") : (isDe ? "Unterlagen analysieren" : "Analyze my documents")}</>}
        </button>
        {busy === "ingest" || busy === "build" ? (
          <div className="cvw-loading" role="status" aria-live="polite">
            <div className="cvw-loading-bar" />
            <span>
              {busy === "build"
                ? (isDe ? "agy baut dein CV aus deinen Unterlagen…" : "agy is building your CV from your documents…")
                : (isDe ? "Lese Dokumente… eingescannte PDFs (Scans) werden per OCR gelesen und dauern ~1 Min." : "Reading documents… scanned PDFs are OCR'd and take ~1 min.")}
            </span>
          </div>
        ) : null}
        {message ? <p className="cvw-message">{message}</p> : null}
      </section>

      {builtCv.length || projects.length ? (
        <section className="cvw-zone">
          <AgyMaterialChat setData={setData} isDe={isDe} prepare={async () => markSeeded()} />
        </section>
      ) : null}

      {data.profile.fullName.trim() || data.profile.email.trim() || projects.length ? (
        <section className="cvw-zone">
          <div className="cvw-zone-head">
            <strong>{isDe ? "2 · Das hat agy gefunden" : "2 · What agy found"}</strong>
            <span>{isDe ? "Aus deinen Unterlagen entnommen — nichts erfunden. Feineinstellung später im CV-Studio." : "Pulled from your documents — nothing invented. Fine-tune later in the CV studio."}</span>
          </div>
          <ul className="cvw-findings">
            {data.profile.fullName.trim() ? <li><span>{isDe ? "Name" : "Name"}</span><strong>{data.profile.fullName}</strong></li> : null}
            {data.profile.email.trim() ? <li><span>Email</span><strong>{data.profile.email}</strong></li> : null}
            {data.profile.phone.trim() ? <li><span>{isDe ? "Telefon" : "Phone"}</span><strong>{data.profile.phone}</strong></li> : null}
            {data.profile.location.trim() ? <li><span>{isDe ? "Ort" : "Location"}</span><strong>{data.profile.location}</strong></li> : null}
            {data.profile.headline.trim() ? <li><span>{isDe ? "Titel" : "Headline"}</span><strong>{data.profile.headline}</strong></li> : null}
            <li><span>{isDe ? "Projekte / Rollen" : "Projects / roles"}</span><strong>{projects.length}</strong></li>
          </ul>
        </section>
      ) : null}

      {builtCv.length ? (
        <section className="cvw-zone">
          <div className="cvw-zone-head"><strong>{isDe ? "3 · Dein Master-CV" : "3 · Your master CV"}</strong></div>
          <div className="cvw-preview">
            {builtCv.map((section) => (
              <div key={section.id} className="cvw-preview-section">
                <h4>{section.title}</h4>
                <p>{section.content}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {projects.length ? (
        <section className="cvw-zone">
          <div className="cvw-zone-head">
            <strong>{isDe ? "4 · Projekte für dieses CV wählen" : "4 · Pick projects for this CV"}</strong>
            <span>{isDe ? "Schalte ein/aus, was rein soll. Viele Projekte? Zielrolle eingeben und agy vorauswählen lassen." : "Toggle what belongs in this CV. Many projects? Set a target role and let agy pre-select."}</span>
          </div>
          <div className="cvw-tailor">
            <input value={role} onChange={(event) => setRole(event.target.value)} placeholder={isDe ? "Zielrolle (z. B. Senior Backend Engineer)" : "Target role (e.g. Senior Backend Engineer)"} />
            <button className="secondary" disabled={!role.trim() || busy !== null} onClick={() => void tailor()}>
              {busy === "tailor" ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {isDe ? "Auto-anpassen" : "Auto-tailor"}
            </button>
          </div>
          <ul className="cvw-projects">
            {projects.map((project) => (
              <li key={project.id} className={project.included ? "included" : ""}>
                <label className="cvw-project-toggle">
                  <input type="checkbox" checked={project.included} onChange={(event) => void toggleProject(project.id, event.target.checked)} />
                  <div className="cvw-project-body">
                    <strong>{[project.role || project.title, project.organisation].filter(Boolean).join(" — ") || project.title}</strong>
                    {project.summary ? <span>{project.summary}</span> : null}
                    {project.sourceQuote?.trim() && project.sourceDocId
                      ? <em className="cvw-cited"><ShieldCheck size={12} /> {isDe ? "belegt" : "cited"}</em>
                      : <em className="cvw-unsourced"><ShieldAlert size={12} /> {isDe ? "unbelegt — prüfen oder entfernen" : "unsourced — confirm or drop"}</em>}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      </div>
      <aside className="cvw-preview-pane">
        <div className="cvw-design">
          <label className="cvw-design-field">
            <span>{isDe ? "Vorlage" : "Template"}</span>
            <select value={data.masterCv.template} disabled={busy !== null} onChange={(event) => void saveStyle({ template: event.target.value as CvDocument["template"] })}>
              {cvTemplateOptions.map((tpl) => <option key={tpl.key} value={tpl.key}>{tpl.label}{tpl.atsSafe ? "" : " ⚠"}</option>)}
            </select>
          </label>
          <label className="cvw-design-field">
            <span>{isDe ? "Akzent" : "Accent"}</span>
            <input type="color" value={data.masterCv.style.accentColor} disabled={busy !== null} onChange={(event) => void saveStyle({ accentColor: event.target.value })} />
          </label>
          <div className="cvw-design-photo">
            <div className="cvw-photo cvw-photo-sm">
              {data.profile.photoDataUrl
                ? <img src={data.profile.photoDataUrl} alt="" />
                : (data.profile.fullName.trim() ? data.profile.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2) : "?")}
            </div>
            <div className="cvw-design-photo-controls">
              <label className="cvw-photo-upload">
                <Upload size={13} /> {data.profile.photoDataUrl ? (isDe ? "Foto ändern" : "Change photo") : (isDe ? "Foto hochladen" : "Upload photo")}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => void run(isDe ? "Foto speichern" : "Saving photo", () => jobCentral().saveProfile({ ...data.profile, photoDataUrl: String(reader.result) }).then((next) => (setData(next), next)));
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              <label className="cvw-also-lang">
                <input type="checkbox" checked={data.masterCv.style.showPhoto} disabled={busy !== null} onChange={(event) => void saveStyle({ showPhoto: event.target.checked })} />
                {isDe ? "Im CV zeigen" : "Show in CV"}
              </label>
            </div>
          </div>
        </div>
        <div className="cvw-preview-scroll">
          <CvPreview profile={data.profile} cv={data.masterCv} zoom={0.5} />
        </div>
      </aside>
    </div>
  );
}

// Methods that should exist on the preload bridge. The RENDERER hot-reloads via Vite but
// the preload/main process do NOT — so after adding IPC you must fully restart (Ctrl+C,
// npm run dev) or the new methods are missing from the live `jobCentral` and features like
// drag-drop / delete / build silently no-op. When you add a new IPC method, add its name
// here so a stale window flags itself instead of failing mysteriously.
const EXPECTED_API_METHODS = [
  "importDocumentPaths",
  "removeSourceDocument",
  "getPathForFile",
  "buildCvFromSources",
  "addTextSource",
  "setCvProjects",
  "tailorProjects",
] as const;

// Shows a fixed banner when the running window's preload is older than the renderer (i.e.
// expected IPC methods are missing) — the recurring "I changed main.ts but it didn't take"
// trap. The renderer is always fresh, so this appears immediately and clears itself once
// the app is restarted with the rebuilt preload.
function StalePreloadBanner({ isDe }: { isDe: boolean }) {
  const api = (window as unknown as { jobCentral?: Record<string, unknown> }).jobCentral;
  const missing = api ? EXPECTED_API_METHODS.filter((name) => typeof api[name] !== "function") : [...EXPECTED_API_METHODS];
  if (!missing.length) return null;
  return (
    <div className="stale-banner" role="alert">
      <ShieldAlert size={18} />
      <div>
        <strong>{isDe ? "Neue Funktionen brauchen einen Neustart" : "New features need a restart"}</strong>
        <span>
          {isDe
            ? "Dieses Fenster läuft auf einem älteren Build — Drag-and-drop, Löschen und Bauen funktionieren evtl. nicht. Stoppe den Dev-Server (Ctrl+C) und starte "
            : "This window is running an older build — drag-drop, delete and Build may not work. Stop the dev server (Ctrl+C) and run "}
          <code>npm run dev</code>{isDe ? " neu." : " again."}
        </span>
      </div>
    </div>
  );
}

// Review-gated capture: facts the AI pulled from your chats wait here until you
// approve them. Nothing ever lands in your profile/CV without an explicit click.
function ProfileFactsBanner({
  data,
  setData,
  run,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
}) {
  const pending: ProfileFact[] = data.pendingProfileFacts.filter((fact) => fact.status === "pending");
  if (!pending.length) return null;
  const isDe = data.settings.language === "de";
  const resolve = (approve: string[], reject: string[]) =>
    run(isDe ? "Profil aktualisieren" : "Updating profile", () =>
      jobCentral().resolveProfileFacts({ approve, reject }).then((next) => (setData(next), next)),
    );
  return (
    <div className="facts-banner" role="region" aria-label={isDe ? "Neue Profilfakten zur Überprüfung" : "New profile facts to review"}>
      <div className="facts-banner-head">
        <Sparkles size={18} />
        <div>
          <strong>{isDe ? `${pending.length} neue Fakten aus deinen Gesprächen` : `${pending.length} new fact${pending.length > 1 ? "s" : ""} from your chats`}</strong>
          <span>{isDe ? "Prüfe, was in dein Profil soll — nichts wird automatisch hinzugefügt." : "Review what should go into your profile — nothing is added automatically."}</span>
        </div>
        <div className="facts-banner-actions">
          <button className="primary small" onClick={() => resolve(pending.map((f) => f.id), [])}>{isDe ? "Alle übernehmen" : "Add all"}</button>
          <button className="row-icon-button" title={isDe ? "Alle verwerfen" : "Discard all"} onClick={() => resolve([], pending.map((f) => f.id))}><X size={16} /></button>
        </div>
      </div>
      <ul className="facts-list">
        {pending.map((fact) => (
          <li key={fact.id}>
            <div className="fact-body">
              <span className="fact-cat">{fact.category}</span>
              <strong>{fact.assertion}</strong>
              {fact.sourceSegment ? <em>“{fact.sourceSegment}”</em> : null}
            </div>
            <div className="fact-actions">
              <button className="icon-ok" title={isDe ? "Übernehmen" : "Add"} onClick={() => resolve([fact.id], [])}><Check size={15} /></button>
              <button className="icon-no" title={isDe ? "Verwerfen" : "Discard"} onClick={() => resolve([], [fact.id])}><X size={15} /></button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [section, setSection] = useState<AppSection>("start");
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  // Set when the Library asks to edit a specific CV, so the CV editor opens with
  // that CV selected. Consumed (cleared) once the editor picks it up.
  const [pendingCvId, setPendingCvId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Persistent (not auto-dismissing) banner shown when an AI action fails because
  // the engine is missing/unselected — gives the user a one-click route to fix it.
  const [aiSetupError, setAiSetupError] = useState<string | null>(null);
  const [aiStream, setAiStream] = useState<{ planId: string; title: string; text: string; running: boolean; provider?: string; model?: string } | null>(null);
  const [aiConsoleOpen, setAiConsoleOpen] = useState(false);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorSyncStatus | null>(null);
  const aiConsoleBodyRef = useRef<HTMLPreElement>(null);
  const actionQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const actionQueueDepthRef = useRef(0);

  // Subscribe once to live AI CLI output streamed from the main process.
  useEffect(() => {
    const unsubscribe = jobCentral().onAiStream((event) => {
      if (event.phase === "start") {
        // Start COLLAPSED — show the small "AI activity" pill (with a spinner) so the user
        // sees something is running, without dumping the raw stream over the UI. They can
        // click the pill to expand the full console. (Don't auto-open it.)
        setAiStream({ planId: event.planId, title: event.title ?? (data?.settings.language === "de" ? "KI-Lauf" : "AI run"), text: "", running: true, provider: event.provider, model: event.model });
      } else if (event.phase === "chunk") {
        setAiStream((prev) => (prev && prev.planId === event.planId ? { ...prev, text: prev.text + (event.text ?? "") } : prev));
      } else if (event.phase === "end") {
        setAiStream((prev) =>
          prev && prev.planId === event.planId
            ? { ...prev, running: false, text: `${prev.text}${event.text ? `\n${event.text}` : ""}\n\n— ${event.status === "failed" ? "failed" : "done"} —` }
            : prev,
        );
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const el = aiConsoleBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aiStream?.text]);

  // Subscribe to live folder-mirror status (sync in progress / ok / error).
  useEffect(() => {
    const unsubscribe = jobCentral().onMirrorStatus(setMirrorStatus);
    void jobCentral().getMirrorStatus().then(setMirrorStatus);
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void jobCentral().getState().then(async (next) => {
      if (cancelled) return;
      setData(next);
      setSelectedApplicationId(next.applications[0]?.id ?? null);
      // Auto-detect installed AI CLIs on startup so search and AI features work
      // without the user having to find and click "Detect CLIs" first.
      if (next.aiProviders.some((provider) => provider.key !== "custom" && !provider.detected)) {
        try {
          const detected = await jobCentral().detectAiProviders();
          if (!cancelled) setData(detected);
        } catch {
          // Best-effort; the user can still detect manually in Settings.
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Self-heal: once the selected engine is detected and active again, drop the banner.
  useEffect(() => {
    const working = data?.aiProviders.some((provider) => provider.detected && provider.key === data.settings.activeAiProvider);
    if (aiSetupError && working) setAiSetupError(null);
  }, [data, aiSetupError]);

  const selectedApplication = useMemo(
    () => data?.applications.find((item) => item.id === selectedApplicationId) ?? data?.applications[0],
    [data, selectedApplicationId],
  );
  const selectedJob = selectedApplication ? data?.jobPosts.find((job) => job.id === selectedApplication.jobPostId) : undefined;

  async function run<T>(label: string, task: () => Promise<T>, done?: (value: T) => string) {
    actionQueueDepthRef.current += 1;
    const queued = actionQueueRef.current.then(async () => {
      setBusy(label);
      try {
        const value = await task();
        setToast(done?.(value) ?? (data?.settings.language === "de" ? "Gespeichert" : "Saved"));
        window.setTimeout(() => setToast(null), 2800);
        return value;
      } catch (error) {
        const message = error instanceof Error ? error.message : (data?.settings.language === "de" ? "Aktion fehlgeschlagen" : "Action failed");
        if (isAiSetupError(message)) setAiSetupError(message);
        setToast(message);
        window.setTimeout(() => setToast(null), 4200);
        throw error;
      } finally {
        setBusy(null);
      }
    });
    actionQueueRef.current = queued.catch(() => undefined);
    void queued.finally(() => {
      actionQueueDepthRef.current -= 1;
      if (actionQueueDepthRef.current === 0) actionQueueRef.current = Promise.resolve();
    }).catch(() => undefined);
    return queued;
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" />
      </div>
    );
  }

  const labels = uiText[data.settings.language];

  if (!data.settings.onboardingComplete) {
    return (
      <>
        <StalePreloadBanner isDe={data.settings.language === "de"} />
        <OnboardingWizard data={data} setData={setData} run={run} />
      </>
    );
  }

  return (
    <div className="app-shell">
      <StalePreloadBanner isDe={data.settings.language === "de"} />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">JC</div>
          <div>
            <strong>Job Central</strong>
            <span>{data.settings.defaultCountry}</span>
          </div>
        </div>

        <nav className="nav-list">
          {visibleNavSections.map((key) => {
            const Icon = sectionMeta[key].icon;
            return (
              <button key={key} className={section === key ? "active" : ""} onClick={() => setSection(key)}>
                <Icon size={19} />
                <span>{labels[key]}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="account-chip">
          <User size={18} />
          <div>
            <strong>{data.profile.fullName}</strong>
            <span>{data.profile.location}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{labels[section]}</h1>
            <p>{topbarCopy(section, data)}</p>
          </div>
          <div className="top-actions">
            {busy ? <span className="busy"><Loader2 className="spin" size={16} />{busy}</span> : null}
            {toast ? <span className="toast"><Check size={15} />{toast}</span> : null}
          </div>
        </header>

        {aiSetupError ? (
          <div className="ai-setup-banner" role="alert">
            <Bot size={18} />
            <div>
              <strong>{data.settings.language === "de" ? "Keine KI-Engine verfügbar" : "No AI engine is responding"}</strong>
              <span>{data.settings.language === "de" ? "Job Central braucht eine eingerichtete KI, um CVs anzupassen, Formulare auszufüllen und zu suchen." : "Job Central needs a working AI engine to tailor CVs, fill forms, and search."}</span>
            </div>
            <div className="ai-setup-banner-actions">
              <button className="primary small" onClick={() => { setAiSetupError(null); setSection("settings"); }}>
                {data.settings.language === "de" ? "KI einrichten" : "Open AI setup"}
              </button>
              <button
                className="secondary small"
                onClick={() => { setAiSetupError(null); void run(data.settings.language === "de" ? "Assistent wird neu gestartet" : "Restarting setup", () => jobCentral().restartOnboarding().then((next) => (setData(next), next))); }}
              >
                {data.settings.language === "de" ? "Assistent neu starten" : "Re-run setup"}
              </button>
              <button className="row-icon-button" title={data.settings.language === "de" ? "Schließen" : "Dismiss"} onClick={() => setAiSetupError(null)}>
                <X size={16} />
              </button>
            </div>
          </div>
        ) : null}

        <ProfileFactsBanner data={data} setData={setData} run={run} />

        {section === "start" || section === "pipeline" ? (
          <ApplicationCockpit
            view={section === "pipeline" ? "pipeline" : "search"}
            data={data}
            setData={setData}
            run={run}
            busy={busy}
            selectedApplication={selectedApplication}
            selectedJob={selectedJob}
            onSelect={setSelectedApplicationId}
            onOpenCv={() => {
              // Land on the tailored CV for the selected job (not the master), so the
              // user sees the variant they just generated without having to switch.
              const variant = selectedJob ? data.cvVersions.find((cv) => cv.jobId === selectedJob.id) : undefined;
              setPendingCvId(variant?.id ?? null);
              setSection("cv");
            }}
            onOpenJobs={() => setSection("jobs")}
            onOpenPipeline={() => setSection("pipeline")}
            onAiSetupError={setAiSetupError}
          />
        ) : section === "cv" ? (
          <CvStudio data={data} setData={setData} run={run} onOpenJobStudio={() => setSection("start")} initialCvId={pendingCvId} onCvOpened={() => setPendingCvId(null)} />
        ) : section === "letters" ? (
          <LettersView data={data} setData={setData} run={run} />
        ) : section === "jobs" ? (
          <JobTracker
            data={data}
            setData={setData}
            run={run}
            selectedApplication={selectedApplication}
            selectedJob={selectedJob}
            onSelect={setSelectedApplicationId}
          />
        ) : (
          <SettingsView data={data} setData={setData} run={run} mirrorStatus={mirrorStatus} />
        )}
      </main>

      {aiStream && aiConsoleOpen ? (
        <div className="ai-console">
          <div className="ai-console-head">
            <div className="ai-console-title">
              {aiStream.running ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
              <div className="ai-console-title-text">
                <span>{aiStream.title}</span>
                {aiStream.provider || aiStream.model ? (
                  <small>{[aiStream.provider, aiStream.model].filter(Boolean).join(" · ")}</small>
                ) : null}
              </div>
            </div>
            <button onClick={() => setAiConsoleOpen(false)} aria-label={data.settings.language === "de" ? "KI-Aktivität schließen" : "Close AI activity"}><X size={15} /></button>
          </div>
          <pre className="ai-console-body" ref={aiConsoleBodyRef}>{aiStream.text || (data.settings.language === "de" ? "Wird gestartet…" : "Starting…")}</pre>
        </div>
      ) : null}
      {aiStream && !aiConsoleOpen ? (
        <button
          className={`ai-console-fab${aiStream.running ? " running" : ""}`}
          onClick={() => setAiConsoleOpen(true)}
          title={data.settings.language === "de" ? "KI-Aktivität anzeigen" : "Show AI activity"}
        >
          {aiStream.running ? <Loader2 className="spin" size={14} /> : <Bot size={14} />}
          {aiStream.running
            ? (data.settings.language === "de" ? "KI arbeitet…" : "AI working…")
            : (data.settings.language === "de" ? "KI-Aktivität" : "AI activity")}
        </button>
      ) : null}
    </div>
  );
}

function topbarCopy(section: AppSection, data: AppData) {
  if (data.settings.language === "de") {
    if (section === "start") return "Jobs suchen, Paket bauen, bewerben und nachverfolgen";
    if (section === "cv") return "Master-CV bearbeiten, Designs waehlen und PDF exportieren";
    if (section === "letters") return `${data.coverLetters.length} Motivationsschreiben fuer verfolgte Jobs`;
    if (section === "jobs") return `${data.applications.length} Bewerbungen im Tracker`;
    if (section === "pipeline") return `${data.applications.length} Bewerbungen im Pipeline-Board · ${data.cvVersions.length} Lebenslauf-Varianten`;
    return `${data.aiProviders.filter((provider) => provider.detected).length} KI-CLIs erkannt`;
  }
  if (section === "start") return "Search jobs, build the package, apply, and track follow-up";
  if (section === "cv") return "Edit the master CV, choose designs, and export PDFs";
  if (section === "letters") return `${data.coverLetters.length} cover letters for tracked jobs`;
  if (section === "jobs") return `${data.applications.length} tracked applications`;
  if (section === "pipeline") return `${data.applications.length} applications across your pipeline · ${data.cvVersions.length} CV variants`;
  return `${data.aiProviders.filter((provider) => provider.detected).length} AI CLIs detected`;
}

function summarizeAiFailure(output: string, isDe?: boolean) {
  const firstUsefulLine = output
    .split(/\n/)
    .map((line) => line.trim())
    .find((line) =>
      line &&
      !line.startsWith("at ") &&
      !line.includes("/node_modules/") &&
      !line.startsWith("[Routing]"),
    );
  return firstUsefulLine || (isDe ? "Das AI-CLI ist fehlgeschlagen. Der Entwurf ist weiter bearbeitbar — bitte erneut versuchen oder einen anderen Anbieter wählen." : "The AI CLI failed. The draft content remains editable, so you can retry or switch provider.");
}

function looksLikeAiFailure(plan: AiPlan) {
  return plan.status === "failed" || /retry attempts exhausted|api returned invalid|quota|exhausted|error:/i.test(plan.output ?? "");
}

function parseAiJsonOutput(output: string) {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? output;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as { sections?: Record<string, string>; strategy?: string };
  } catch {
    return undefined;
  }
}

function parseCareerAdviceOutput(output?: string): CareerAdviceOutput | undefined {
  if (!output) return undefined;
  return parseAiJsonOutput(output) as CareerAdviceOutput | undefined;
}

function AiPlanOutput({ plan, isDe }: { plan: AiPlan; isDe?: boolean }) {
  if (!plan.output) return null;
  if (looksLikeAiFailure(plan)) {
    return (
      <div className="ai-error">
        <strong>{isDe ? "KI-Lauf fehlgeschlagen" : "AI run failed"}</strong>
        <p>{summarizeAiFailure(plan.output, isDe)}</p>
      </div>
    );
  }
  if (plan.purpose === "tailor_cv") {
    const tailored = parseAiJsonOutput(plan.output);
    if (tailored?.sections) {
      return (
        <div className="ai-applied-output">
          <strong>{isDe ? "CV-Aktualisierung angewendet" : "CV update applied"}</strong>
          <p>{tailored.strategy || (isDe ? "Die generierten Abschnittsänderungen wurden auf das Job-CV angewendet." : "The generated section changes were applied to the selected job CV.")}</p>
        </div>
      );
    }
  }
  return <pre>{plan.output}</pre>;
}

// "CHF 95'000 – 115'000 / yr" — Swiss thousands grouping, localized period label.
function formatSalaryRange(estimate: SalaryEstimate, isDe: boolean): string {
  const fmt = (value: number) => value.toLocaleString("de-CH");
  const period = estimate.period === "month" ? (isDe ? "Mt." : "mo") : estimate.period === "hour" ? (isDe ? "Std." : "hr") : (isDe ? "Jahr" : "yr");
  return `${estimate.currency} ${fmt(estimate.min)} – ${fmt(estimate.max)} / ${period}`;
}

function defaultJobEvaluation(job: JobPost): JobEvaluation {
  const roughScore = typeof job.score === "number"
    ? Math.min(100, Math.max(0, job.score <= 10 ? job.score * 10 : job.score))
    : 55;
  return {
    jobId: job.id,
    fitScore: roughScore,
    riskScore: 35,
    effortScore: 45,
    priorityScore: roughScore,
    summary: job.fitReason || job.description || "No rating notes yet.",
    strengths: job.fitReason ? [job.fitReason] : [],
    risks: [],
    missingInfo: [job.location ? "" : "Location", job.url ? "" : "Job URL"].filter(Boolean),
    recommendation: roughScore >= 80 ? "high_priority" : roughScore >= 60 ? "apply" : "watch",
    aiSuggested: false,
    updatedAt: new Date().toISOString(),
  };
}

function packageChecklist(input: {
  profile: AppData["profile"];
  job: JobPost;
  cv?: CvVersion;
  letter?: CoverLetter;
  pendingProposals: AiProposal[];
  duplicateCvCount: number;
  duplicateLetterCount: number;
}) {
  return [
    { label: "Contact details", ok: Boolean(input.profile.email && input.profile.phone), detail: input.profile.email && input.profile.phone ? "Email and phone present" : "Missing email or phone" },
    { label: "Job metadata", ok: Boolean(input.job.url && input.job.description), detail: input.job.url && input.job.description ? "URL and description present" : "Missing job URL or description" },
    { label: "Job CV", ok: Boolean(input.cv), detail: input.cv ? input.cv.title : "No job-specific CV yet" },
    { label: "Motivation", ok: Boolean(input.letter), detail: input.letter ? "Letter draft exists" : "No motivation letter yet" },
    { label: "AI review", ok: input.pendingProposals.length === 0, detail: input.pendingProposals.length ? `${input.pendingProposals.length} pending proposals` : "No pending proposals" },
    { label: "Duplicates", ok: input.duplicateCvCount <= 1 && input.duplicateLetterCount <= 1, detail: `${Math.max(0, input.duplicateCvCount - 1)} duplicate CVs, ${Math.max(0, input.duplicateLetterCount - 1)} duplicate letters` },
  ];
}

function proposalPreview(proposal: AiProposal) {
  const text = proposal.edited ?? proposal.proposed ?? "";
  return text.length > 520 ? `${text.slice(0, 520)}...` : text;
}

function historyForJob(history: ArtifactHistoryItem[], jobId: string) {
  return history.filter((item) => item.jobId === jobId).slice(0, 18);
}

// Some career sites (e.g. jobs.vontobel.com) serve a blank shell when they see
// "Electron" / the app name in the UA. Present a plain desktop-Chrome UA so they
// render normally.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

// Runs inside the visible job page to harvest its visible text + job-looking links,
// so the AI can turn a results page the user is already viewing into job cards.
const GRAB_JOBS_SCRIPT = `(() => {
  const looksLikeJob = (s) => /job|jobs|vacanc|stelle|position|career|karriere|posting|offre|emploi|\\/view\\//i.test(s);
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => ({ text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 140), href: a.href }))
    .filter((l) => l.text.length > 3 && /^https?:/i.test(l.href) && looksLikeJob(l.href + ' ' + l.text))
    .slice(0, 80);
  const text = ((document.body && document.body.innerText) || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 16000);
  return JSON.stringify({ text: text, links: links });
})()`;

// In-app job browser. Opens a posting inside the app (in the user's logged-in
// session via a persistent partition), so links can be trusted, the real posting
// text imported into the pipeline, and application forms pre-filled.
function JobBrowser({ url, profile, language, onImported, onBuildAll, onClose, onAiSetupError, onJobsGrabbed }: {
  url: string;
  profile: Profile;
  language: "en" | "de";
  onImported: (data: AppData) => void;
  onBuildAll: (extraction: JobExtraction) => Promise<void>;
  onClose: () => void;
  onAiSetupError: (message: string) => void;
  onJobsGrabbed: () => void;
}) {
  const isDe = language === "de";
  const viewRef = useRef<WebviewElement | null>(null);
  const [address, setAddress] = useState(url);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<JobExtraction | null>(null);
  const [reviewItems, setReviewItems] = useState<string[]>([]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const syncUrl = () => setAddress(view.getURL());
    const onStart = () => { setLoading(true); setStatus(null); };
    const onStop = () => { setLoading(false); syncUrl(); };
    const onFail = (event: Event) => {
      const e = event as unknown as { errorCode: number; errorDescription: string; isMainFrame: boolean };
      // -3 (ABORTED) fires for redirects/cancelled sub-loads and is harmless.
      if (!e.isMainFrame || e.errorCode === -3) return;
      setLoading(false);
      setStatus(isDe
        ? `Diese Seite konnte nicht geladen werden (${e.errorDescription || `Fehler ${e.errorCode}`}). Versuche es erneut oder öffne sie extern.`
        : `This page did not load (${e.errorDescription || `error ${e.errorCode}`}). Try reload, or open it externally.`);
    };
    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    view.addEventListener("did-navigate", syncUrl);
    view.addEventListener("did-navigate-in-page", syncUrl);
    view.addEventListener("did-fail-load", onFail);
    return () => {
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
      view.removeEventListener("did-navigate", syncUrl);
      view.removeEventListener("did-navigate-in-page", syncUrl);
      view.removeEventListener("did-fail-load", onFail);
    };
  }, []);

  function go(to: string) {
    const target = /^https?:\/\//i.test(to) ? to : `https://www.google.com/search?q=${encodeURIComponent(to)}`;
    void viewRef.current?.loadURL(target).catch(() => undefined);
  }

  async function readPage() {
    const view = viewRef.current;
    if (!view) return;
    setBusy("import");
    setStatus(isDe ? "Stellenanzeige wird gelesen…" : "Reading the posting…");
    try {
      const text = String(await view.executeJavaScript("document.body && document.body.innerText || ''"));
      const extraction = await jobCentral().extractJobFromPage({ url: view.getURL(), text });
      setDraft(extraction);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : (isDe ? "Diese Seite konnte nicht gelesen werden." : "Could not read this page."));
    } finally {
      setBusy(null);
    }
  }

  // One-shot: read the loaded posting and hand it to the parent, which creates
  // the job and generates the tailored CV + cover letter in one go.
  async function buildAll() {
    const view = viewRef.current;
    if (!view) return;
    setBusy("build");
    setStatus(isDe
      ? "Stellenanzeige wird gelesen, dann werden CV + Motivationsschreiben erstellt — das läuft über die KI und kann eine Minute dauern…"
      : "Reading the posting, then building your tailored CV + cover letter — this runs the AI and can take a minute…");
    try {
      const text = String(await view.executeJavaScript("document.body && document.body.innerText || ''"));
      const extraction = await jobCentral().extractJobFromPage({ url: view.getURL(), text });
      await onBuildAll(extraction);
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : (isDe ? "Diese Seite konnte nicht verarbeitet werden." : "Could not build from this page."));
    } finally {
      setBusy(null);
    }
  }

  async function confirmImport() {
    if (!draft) return;
    setBusy("import");
    try {
      const data = await jobCentral().createJob({
        company: draft.company,
        title: draft.title,
        location: draft.location,
        url: draft.url,
        description: draft.description,
        fitReason: "Imported from the in-app browser.",
      });
      onImported(data);
      setDraft(null);
      setStatus(isDe
        ? `${draft.company} – ${draft.title} wurde zur Pipeline hinzugefügt.`
        : `Added ${draft.company} – ${draft.title} to your pipeline.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : (isDe ? "Die Stelle konnte nicht hinzugefügt werden." : "Could not add the job."));
    } finally {
      setBusy(null);
    }
  }

  async function autofill() {
    const view = viewRef.current;
    if (!view) return;
    setBusy("fill");
    setReviewItems([]);
    setStatus(isDe ? "Formular wird gelesen…" : "Reading the form…");
    try {
      const webContentsId = view.getWebContentsId();
      // Step 1 — discover every fillable control across all frames (iframe-based
      // ATS forms like Greenhouse/Workday included).
      const { fields } = await jobCentral().extractApplicationForm(webContentsId);
      if (!fields.length) {
        setStatus(isDe
          ? "Noch keine Formularfelder gefunden. Klicke zuerst auf „Bewerben“ — die meisten Seiten zeigen das Formular (oft in einem eingebetteten Frame) erst danach."
          : "No form fields found yet. Click Apply on the posting first — most sites only show the form (often in an embedded frame) after that.");
        return;
      }
      const fileCount = fields.filter((field) => field.isFile).length;
      setStatus(isDe
        ? `${fields.length} Felder gefunden — die KI füllt sie aus…`
        : `Found ${fields.length} fields — asking the AI to fill them…`);
      // Step 2 — let the AI map profile + CV onto the fields, using the page text
      // as context for company-specific questions.
      const pageText = String(await view.executeJavaScript("document.body && document.body.innerText || ''")).slice(0, 8000);
      const mapping = await jobCentral().mapApplicationForm({ fields, pageText });
      // Step 3 — apply the values back into the live form.
      const filled = await jobCentral().applyApplicationForm({ webContentsId, values: mapping.values });
      const review = [...mapping.review];
      if (fileCount > 0) {
        review.unshift(isDe
          ? `Lade dein CV/Anschreiben als PDF selbst hoch — ${fileCount} Upload-Feld${fileCount === 1 ? "" : "er"} gefunden (Browser erlauben kein automatisches Anhängen von Dateien).`
          : `Attach your CV/letter PDF yourself — ${fileCount} upload field${fileCount === 1 ? "" : "s"} found (browsers don't allow auto-attaching files).`);
      }
      setReviewItems(review);
      setStatus(filled > 0
        ? (isDe
          ? `${filled} Feld${filled === 1 ? "" : "er"} ausgefüllt. Überprüfe die Checkliste unten, hänge dein PDF an und sende das Formular selbst ab.`
          : `Filled ${filled} field${filled === 1 ? "" : "s"}. Review the checklist below, attach your PDF, then submit yourself.`)
        : (isDe
          ? "Automatisches Ausfüllen war nicht möglich — das Formular verwendet möglicherweise benutzerdefinierte Elemente. Prüfe die Hinweise unten und fülle es manuell aus."
          : "Couldn't fill anything automatically — this form may use custom widgets. Check the notes below and fill manually."));
    } catch (error) {
      const message = error instanceof Error ? error.message : (isDe ? "Diese Seite konnte nicht automatisch ausgefüllt werden." : "Could not autofill this page.");
      if (isAiSetupError(message)) onAiSetupError(message);
      setStatus(message);
    } finally {
      setBusy(null);
    }
  }

  // Scrape the page the user is currently viewing (a real, logged-in session that
  // already passed any Cloudflare/login wall) and turn it into job cards.
  async function grabJobs() {
    const view = viewRef.current;
    if (!view) return;
    setBusy("grab");
    setReviewItems([]);
    setStatus(isDe ? "Stellen auf dieser Seite werden gelesen…" : "Reading jobs on this page…");
    try {
      const raw = String(await view.executeJavaScript(GRAB_JOBS_SCRIPT));
      const parsed = JSON.parse(raw) as { text?: string; links?: Array<{ text: string; href: string }> };
      const next = await jobCentral().grabJobsFromPage({ url: view.getURL(), text: parsed.text ?? "", links: parsed.links ?? [] });
      onImported(next);
      onJobsGrabbed();
      const count = parseAiJobTargets(next.aiPlans.find((plan) => plan.purpose === "portal_search")?.output, next.profile.location).length;
      setStatus(count > 0
        ? (isDe
          ? `${count} ${count === 1 ? "Stelle" : "Stellen"} von dieser Seite übernommen — schließe dieses Fenster, um sie unter „Stellen finden“ zu sehen.`
          : `Grabbed ${count} job${count === 1 ? "" : "s"} from this page — close this window to review them in Find jobs.`)
        : (isDe
          ? "Keine eindeutigen Stellenanzeigen auf dieser Seite gefunden. Öffne eine Suchergebnis- oder Listenseite und versuche es erneut."
          : "No clear job postings found on this page. Open a search-results or listing page, then try again."));
    } catch (error) {
      const message = error instanceof Error ? error.message : (isDe ? "Stellen konnten nicht von dieser Seite gelesen werden." : "Could not read jobs from this page.");
      if (isAiSetupError(message)) onAiSetupError(message);
      setStatus(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="job-browser-overlay" role="dialog" aria-label={isDe ? "Integrierter Stellenbrowser" : "In-app job browser"}>
      <div className="job-browser">
        <div className="job-browser-toolbar">
          <div className="job-browser-nav">
            <button title={isDe ? "Zurück" : "Back"} onClick={() => viewRef.current?.goBack()}><ArrowLeft size={16} /></button>
            <button title={isDe ? "Vorwärts" : "Forward"} onClick={() => viewRef.current?.goForward()}><ArrowRight size={16} /></button>
            <button title={isDe ? "Neu laden" : "Reload"} onClick={() => viewRef.current?.reload()}><RefreshCw size={16} /></button>
          </div>
          <input
            className="job-browser-address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") go(address); }}
            spellCheck={false}
          />
          {loading ? <Loader2 className="spin" size={16} /> : null}
          <div className="job-browser-actions">
            <button className="primary" disabled={Boolean(busy)} onClick={() => void buildAll()} title={isDe ? "Diese Stelle importieren und ein passendes CV + Motivationsschreiben erstellen" : "Import this job and generate a tailored CV + cover letter"}>
              <Sparkles size={15} /> {isDe ? "Alles erstellen" : "Build everything"}
            </button>
            <button className="secondary" disabled={Boolean(busy)} onClick={() => void readPage()}>
              <Download size={15} /> {isDe ? "Nur importieren" : "Import only"}
            </button>
            <button className="secondary" disabled={Boolean(busy)} onClick={() => void grabJobs()} title={isDe ? "Stellenanzeigen auf dieser Seite (mit deiner echten Sitzung – auch hinter Login/Cloudflare) als Karten in „Stellen finden“ übernehmen" : "Scrape the job listings on this page (your real session — past any login/Cloudflare wall) into cards in Find jobs"}>
              <Bot size={15} /> {isDe ? "Stellen übernehmen" : "Grab jobs"}
            </button>
            <button className="secondary" disabled={Boolean(busy)} onClick={() => void autofill()} title={isDe ? "Die KI füllt dieses Bewerbungsformular aus deinem Profil und CV aus — du prüfst, hängst das PDF an und sendest es ab" : "Let the AI fill this application form from your profile and CV — you review, attach the PDF, and submit"}>
              <Sparkles size={15} /> {isDe ? "KI-Autofill" : "AI Autofill"}
            </button>
            <button className="row-icon-button" title={isDe ? "Schließen" : "Close"} onClick={onClose}><X size={17} /></button>
          </div>
        </div>
        {status ? (
          <div className="job-browser-status">
            <span>{status}</span>
            <a href={address} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {isDe ? "Extern öffnen" : "Open externally"}</a>
          </div>
        ) : null}
        {reviewItems.length ? (
          <div className="job-browser-review">
            <strong>{isDe ? "Vor dem Absenden:" : "Before you submit:"}</strong>
            <ul>
              {reviewItems.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        {draft ? (
          <div className="job-browser-import">
            <strong>{isDe ? "Diese Stellenanzeige importieren?" : "Import this posting?"}</strong>
            <div className="job-browser-import-grid">
              <label>{isDe ? "Unternehmen" : "Company"}<input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></label>
              <label>{isDe ? "Bezeichnung" : "Title"}<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label>{isDe ? "Ort" : "Location"}<input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
            </div>
            <label className="job-browser-import-desc">{isDe ? "Beschreibung" : "Description"}<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <div className="toolbar-row">
              <button className="primary" disabled={Boolean(busy)} onClick={() => void confirmImport()}><Plus size={15} /> {isDe ? "Zur Pipeline hinzufügen" : "Add to pipeline"}</button>
              <button className="secondary" onClick={() => setDraft(null)}>{isDe ? "Abbrechen" : "Cancel"}</button>
            </div>
          </div>
        ) : null}
        <div className="job-browser-frame">
          {createElement("webview", {
            ref: viewRef,
            src: url,
            partition: "persist:jobbrowser",
            allowpopups: "true",
            useragent: BROWSER_UA,
            className: "job-webview",
          })}
        </div>
      </div>
    </div>
  );
}

function ApplicationCockpit({
  data,
  setData,
  run,
  busy,
  selectedApplication,
  selectedJob,
  onSelect,
  onOpenCv,
  onOpenJobs,
  onOpenPipeline,
  onAiSetupError,
  view,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  busy: string | null;
  selectedApplication?: JobApplication;
  selectedJob?: JobPost;
  onSelect: (applicationId: string) => void;
  onOpenCv: () => void;
  onOpenJobs: () => void;
  onOpenPipeline: () => void;
  onAiSetupError: (message: string) => void;
  view: "search" | "pipeline";
}) {
  const isDe = data.settings.language === "de";
  const [aiMessage, setAiMessage] = useState("");
  const [targetRoles, setTargetRoles] = useState(
    data.settings.search.targetRoles.length ? data.settings.search.targetRoles.join(", ") : data.profile.targetRoles.join(", "),
  );
  const [searchIdea, setSearchIdea] = useState(
    data.settings.search.locations.length ? data.settings.search.locations.join(", ") : data.profile.workPreference || defaultSearchIdea(data.profile.location),
  );
  const [searchQuestion, setSearchQuestion] = useState("");
  const [searchPlanId, setSearchPlanId] = useState<string | null>(null);
  const [resultsPage, setResultsPage] = useState(0);
  const [draggingAppId, setDraggingAppId] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<PortalScanResult[]>([]);
  const [dismissedTargetKeys, setDismissedTargetKeys] = useState<string[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const [targetModalKey, setTargetModalKey] = useState<string | null>(null);
  const [applicationModalOpen, setApplicationModalOpen] = useState(false);
  // Search vs Pipeline is now driven by the sidebar (two separate sections) rather
  // than an in-page tab bar, so the active view comes straight from the `view` prop.
  const studioTab = view;
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [searchText, setSearchText] = useState<SearchText>(() => searchPrefsToText(data.settings.search));
  const [showPasteLink, setShowPasteLink] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [pasteLink, setPasteLink] = useState("");
  const [linkChecks, setLinkChecks] = useState<Record<string, LinkCheckResult | "checking">>({});
  const checkedUrlsRef = useRef<Set<string>>(new Set());
  const [jobWorkspaceTab, setJobWorkspaceTab] = useState<"overview" | "ai" | "proposals" | "package" | "history">("overview");
  const [proposalEdits, setProposalEdits] = useState<Record<string, string>>({});
  const selectedCv = selectedApplication?.cvVersionId
    ? data.cvVersions.find((cv) => cv.id === selectedApplication.cvVersionId)
    : selectedJob
      ? data.cvVersions.find((cv) => cv.jobId === selectedJob.id)
      : undefined;
  const selectedLetterRaw = selectedJob ? data.coverLetters.find((letter) => letter.jobId === selectedJob.id) : undefined;
  const selectedLetter = selectedLetterRaw ? { ...selectedLetterRaw, content: cleanUserText(selectedLetterRaw.content) } : undefined;
  const selectedConversation = selectedJob ? data.aiConversations.find((conversation) => conversation.jobId === selectedJob.id) : undefined;
  const selectedProposals = selectedJob ? data.aiProposals.filter((proposal) => proposal.jobId === selectedJob.id || (!proposal.jobId && proposal.cvVersionId === selectedCv?.id)) : [];
  const pendingProposals = selectedProposals.filter((proposal) => proposal.status === "pending");
  const selectedEvaluation = selectedJob
    ? data.jobEvaluations.find((evaluation) => evaluation.jobId === selectedJob.id) ?? defaultJobEvaluation(selectedJob)
    : undefined;
  const duplicateCvCount = selectedJob ? data.cvVersions.filter((cv) => cv.jobId === selectedJob.id).length : 0;
  const duplicateLetterCount = selectedJob ? data.coverLetters.filter((letter) => letter.jobId === selectedJob.id).length : 0;
  const selectedHistory = selectedJob ? historyForJob(data.artifactHistory, selectedJob.id) : [];
  const readiness = selectedJob
    ? packageChecklist({
      profile: data.profile,
      job: selectedJob,
      cv: selectedCv,
      letter: selectedLetter,
      pendingProposals,
      duplicateCvCount,
      duplicateLetterCount,
    })
    : [];
  const jobPlans = selectedJob
    ? data.aiPlans.filter((plan) => plan.relatedJobId === selectedJob.id)
    : data.aiPlans.filter((plan) => plan.purpose === "portal_search");
  const searchPlan = searchPlanId ? data.aiPlans.find((plan) => plan.id === searchPlanId) : data.aiPlans.find((plan) => plan.purpose === "portal_search");
  const removedJobUrlKeys = new Set((data.settings.removedJobUrls ?? []).map(normalizeJobUrlKey).filter(Boolean));
  const archivedJobsByUrl = new Map<string, RemovedJob>();
  for (const job of data.settings.removedJobs ?? []) {
    const key = normalizeJobUrlKey(job.url);
    if (key) archivedJobsByUrl.set(key, { ...job, url: key });
  }
  for (const url of data.settings.removedJobUrls ?? []) {
    const key = normalizeJobUrlKey(url);
    if (key && !archivedJobsByUrl.has(key)) archivedJobsByUrl.set(key, { url: key, removedAt: "" });
  }
  const archivedJobs = [...archivedJobsByUrl.values()].sort((a, b) => (b.removedAt || "").localeCompare(a.removedAt || ""));
  const jobsByUrl = buildJobUrlMap(data.jobPosts);
  const searchTargets = parseAiJobTargets(searchPlan?.output, data.profile.location)
    .filter((target) => !dismissedTargetKeys.includes(target.key))
    .filter((target) => !removedJobUrlKeys.has(normalizeJobUrlKey(target.url)))
    .filter((target) => {
      // Hide suggestions whose package is already done (CV + motivation prepared):
      // they live in the Pipeline tab now, so a fresh search shouldn't re-list them.
      const job = jobsByUrl.get(normalizeJobUrlKey(target.url));
      if (!job) return true;
      const prepared = data.cvVersions.some((cv) => cv.jobId === job.id) && data.coverLetters.some((letter) => letter.jobId === job.id);
      return !prepared;
    })
    .map((target) => ({ ...target, fit: target.fit ?? localFit(target, splitCommaList(targetRoles)) }))
    .sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0)); // best fit first
  // Paginate the ranked results (20/page) so the best matches lead and the rest
  // are reachable via 1·2·3·4 instead of one long wall or a hard 8-cap.
  const RESULTS_PER_PAGE = 20;
  const resultsPageCount = Math.max(1, Math.ceil(searchTargets.length / RESULTS_PER_PAGE));
  const resultsPageSafe = Math.min(resultsPage, resultsPageCount - 1);
  const pagedTargets = searchTargets.slice(resultsPageSafe * RESULTS_PER_PAGE, resultsPageSafe * RESULTS_PER_PAGE + RESULTS_PER_PAGE);
  const selectedSearchTarget = searchTargets.find((target) => target.key === selectedTargetKey) ?? searchTargets[0];
  const modalSearchTarget = searchTargets.find((target) => target.key === targetModalKey);
  const selectedProvider = data.aiProviders.find((provider) => provider.selected);
  const selectedModelLabel = selectedProvider?.availableModels?.find((model) => model.id === selectedProvider.selectedModel)?.label ?? selectedProvider?.selectedModel ?? selectedProvider?.version ?? "default model";
  const enabledPortals = data.portals.filter((portal) => portal.enabled);
  const isSearching = busy === "Searching with AI";
  const isScanning = busy === "Scanning portals";
  // The "Jobs suchen" button runs under this exact busy label (see its onClick).
  // Track it so the button + its progress bar reflect that the search is live.
  const searchBusyLabel = isDe ? "Alle Quellen durchsuchen" : "Searching all sources";
  const isJobSearching = busy === searchBusyLabel;
  const searchStateLabel = isSearching ? (isDe ? "KI-Suche läuft" : "AI search running") : isScanning ? (isDe ? "Portal-Scan läuft" : "Portal scan running") : searchPlan?.status === "ran" ? (isDe ? "Letzte KI-Ausführung abgeschlossen" : "Last AI run complete") : searchPlan?.status === "failed" ? (isDe ? "Letzte KI-Ausführung fehlgeschlagen" : "Last AI run failed") : (isDe ? "Bereit" : "Ready");
  const scanTotals = scanResults.reduce(
    (total, result) => ({
      scanned: total.scanned + result.scanned,
      added: total.added + result.added,
      skipped: total.skipped + result.skipped,
      errors: total.errors + result.errors.length,
    }),
    { scanned: 0, added: 0, skipped: 0, errors: 0 },
  );
  const scanHasOnlyZeroes = scanResults.length > 0 && scanTotals.scanned === 0 && scanTotals.added === 0 && scanTotals.skipped === 0;
  const promptPreview = [
    `CLI: ${selectedProvider ? `${selectedProvider.label} (${selectedModelLabel})` : "No AI CLI selected"}`,
    `Roles: ${targetRoles || "not set"}`,
    `Where: ${searchIdea || "not set"}`,
    `Instruction: ${searchQuestion || "Find concrete fitting Swiss/remote jobs with company, title, location, URL, and why it fits."}`,
    `Use sources: ${enabledPortals.map((portal) => portal.name).join(", ") || "No enabled portals"}`,
    "Output contract: concrete job cards only. User decides add, dismiss, or build CV + Motivation.",
  ].join("\n");

  useEffect(() => {
    setTargetRoles(data.settings.search.targetRoles.length ? data.settings.search.targetRoles.join(", ") : data.profile.targetRoles.join(", "));
    setSearchIdea(data.settings.search.locations.length ? data.settings.search.locations.join(", ") : data.profile.workPreference || defaultSearchIdea(data.profile.location));
    setSearchText(searchPrefsToText(data.settings.search));
  }, [data.settings.search]);

  useEffect(() => {
    if (!searchTargets.length) {
      setSelectedTargetKey(null);
      return;
    }
    if (!selectedTargetKey || !searchTargets.some((target) => target.key === selectedTargetKey)) {
      setSelectedTargetKey(searchTargets[0].key);
    }
  }, [searchTargets, selectedTargetKey]);

  // Jump back to page 1 whenever a fresh search runs (new plan output).
  useEffect(() => {
    setResultsPage(0);
  }, [searchPlan?.id]);

  // Verify each suggested posting link so dead/expired URLs (the AI sometimes
  // guesses) are flagged before the user clicks. Skips Google search links and
  // anything already checked. Runs one at a time to stay gentle.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const target of searchTargets) {
        const url = target.url;
        if (!/^https?:\/\//i.test(url) || /google\.[a-z.]+\/search/i.test(url)) continue;
        if (checkedUrlsRef.current.has(url)) continue;
        checkedUrlsRef.current.add(url);
        setLinkChecks((prev) => ({ ...prev, [url]: "checking" }));
        try {
          const result = await jobCentral().checkLink(url);
          if (!cancelled) setLinkChecks((prev) => ({ ...prev, [url]: result }));
        } catch {
          // Let a transient failure be retried on a later search instead of
          // being cached as permanently unknown.
          checkedUrlsRef.current.delete(url);
          if (!cancelled) setLinkChecks((prev) => { const next = { ...prev }; delete next[url]; return next; });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [searchTargets]);

  const setSearchList = (key: keyof SearchPreferences, value: string) => {
    // Store raw text so commas/spaces are preserved while typing; we split on save.
    setSearchText((prev) => ({ ...prev, [key]: value }));
  };

  function currentSearchPreferences(): SearchPreferences {
    return {
      ...data.settings.search,
      targetRoles: splitCommaList(targetRoles),
      locations: splitCommaList(searchIdea),
      positiveKeywords: splitCommaList(searchText.positiveKeywords),
      negativeKeywords: splitCommaList(searchText.negativeKeywords),
      targetCompanies: splitCommaList(searchText.targetCompanies),
      excludedCompanies: splitCommaList(searchText.excludedCompanies),
    };
  }

  async function saveSearchPreferences() {
    const next = await jobCentral().updateSearchPreferences(currentSearchPreferences());
    setData(next);
    return next;
  }

  function archiveInputFromTarget(target: AiJobTarget): RemovedJobInput {
    return {
      url: target.url,
      title: target.title,
      company: target.company,
      location: target.location,
      reason: target.reason,
      score: target.fit,
      source: "search",
    };
  }

  async function dismissSearchTargets(targets: AiJobTarget[]) {
    const jobs = targets.map(archiveInputFromTarget).filter((job) => normalizeJobUrlKey(job.url));
    let next = data;
    if (jobs.length) {
      next = await jobCentral().dismissJobUrls(jobs);
      setData(next);
    }
    setDismissedTargetKeys((keys) => [...new Set([...keys, ...targets.map((target) => target.key)])]);
    return next;
  }

  async function restoreArchivedJob(url: string) {
    const next = await jobCentral().restoreRemovedJob(url);
    setDismissedTargetKeys([]);
    setData(next);
    return next;
  }

  async function restoreAllArchivedJobs() {
    const next = await jobCentral().restoreAllRemovedJobs();
    setDismissedTargetKeys([]);
    setData(next);
    return next;
  }

  // Toggle whether a source is used by the AI search, right from the search flow.
  // Persists immediately so the next search respects it (the prompt only lists
  // enabled sources).
  async function toggleSource(portal: JobPortal) {
    const next = await jobCentral().savePortal({ ...portal, enabled: !portal.enabled });
    setData(next);
    return next;
  }

  async function preparePackage() {
    if (!selectedApplication || !selectedJob) return data;
    const applicationId = selectedApplication.id;
    const freshData = await jobCentral().getState();
    const freshApplication = freshData.applications.find((item) => item.id === applicationId);
    const freshJob = freshApplication ? freshData.jobPosts.find((job) => job.id === freshApplication.jobPostId) : undefined;
    if (!freshApplication || !freshJob) return freshData;
    const language = freshData.settings.language;
    const freshCv = freshApplication.cvVersionId
      ? freshData.cvVersions.find((cv) => cv.id === freshApplication.cvVersionId)
      : freshData.cvVersions.find((cv) => cv.jobId === freshJob.id);
    const afterCv = freshCv
      ? freshData
      : await jobCentral().createCvVariant({
        jobId: freshJob.id,
        title: `${freshJob.company} - ${freshJob.title}`,
        notes: "Generated from master CV for this application.",
        reuseExisting: true,
      });
    const cv = freshCv ?? afterCv.cvVersions.find((item) => item.jobId === freshJob.id);
    const existingLetter = afterCv.coverLetters.find((letter) => letter.jobId === freshJob.id && letter.language === language);
    const afterLetter = existingLetter
      ? afterCv
      : await jobCentral().generateCoverLetter({
        jobId: freshJob.id,
        cvVersionId: cv?.id,
        language,
        instructions: `Write specifically for ${freshJob.company} ${freshJob.title}. Use the generated job CV and keep it credible, Swiss-market direct, and not generic.`,
      });
    const app = afterLetter.applications.find((item) => item.id === applicationId);
    const next = app
      ? await jobCentral().updateApplication({
        applicationId: app.id,
        status: "evaluating",
        cvVersionId: cv?.id,
        eventDetail: "Generated job-specific CV and motivation letter from master CV.",
      })
      : afterLetter;
    setData(next);
    return next;
  }

  async function generateMotivationOnly() {
    if (!selectedJob) return data;
    const next = await jobCentral().generateCoverLetter({
      jobId: selectedJob.id,
      cvVersionId: selectedCv?.id,
      language: data.settings.language,
      instructions: `Write specifically for ${selectedJob.company} ${selectedJob.title}. Use the selected job CV if available. Keep it concrete, concise, and Swiss-market direct.`,
    });
    setData(next);
    return next;
  }

  async function runJobSearch() {
    await saveSearchPreferences();
    // Clear any "Alle verwerfen" dismissals up front: a fresh search must always
    // show its results. Otherwise re-found jobs stay hidden behind stale dismissed
    // keys and the search button looks dead until a hard reload.
    setDismissedTargetKeys([]);
    // Refresh the source pool FIRST so the search runs over fresh jobs — this runs
    // the pipeline ingest (the configured ATS boards + the user's BYO-key Adzuna
    // feed for broad Swiss coverage), then the AI filters/ranks the result. Was a
    // portal "scan" that only touched the inert web-search portals, so the pool
    // never grew beyond the hardcoded boards and Adzuna never contributed.
    try {
      const synced = await jobCentral().pipelineSync();
      setData(synced);
    } catch {
      // Best-effort: if the pipeline/ingest is down the AI search still runs on
      // whatever is already in the pool.
    }
    // Conversational: if a previous search answered/asked questions, carry that
    // answer as context so the user's box input is treated as replies/refinements.
    const previous = data.aiPlans
      .find((item) => item.purpose === "portal_search" && item.status === "ran" && item.output?.trim())
      ?.output?.trim()
      .slice(0, 4000);
    const reply = searchQuestion.trim();
    const instructions = previous
      ? `Target roles: ${targetRoles}\nLocations: ${searchIdea}\n\nYour previous answer (including any questions you asked me):\n${previous}\n\nMy replies to your questions and extra refinements:\n${reply || "(no extra notes — just refine and surface more concrete, current roles with working URLs)"}\n\nUse my replies to refine. Return updated concrete job cards plus any new tips.`
      : `${targetRoles}\n${searchIdea}\n${reply || "Find concrete fitting Swiss/remote jobs with company, title, location, URL, and why it fits."}`;
    // Live search: the main process scrapes the enabled web-search portals in a
    // real (hidden) browser, then the AI turns that content into concrete cards.
    const ran = await jobCentral().liveSearch({ roles: targetRoles, location: searchIdea, instructions });
    const plan = newestPlan(ran.aiPlans, (item) => item.purpose === "portal_search" && item.title === `Job search: ${targetRoles || "target roles"}`);
    setSearchPlanId(plan?.id ?? null);
    setDismissedTargetKeys([]);
    setSelectedTargetKey(null);
    setData(ran);
    return ran;
  }

  // Paste-a-link / "Build everything": from an imported posting, create the job
  // and generate the tailored CV + cover letter in one pass, then open it.
  async function buildEverythingFromExtraction(extraction: JobExtraction) {
    await run(isDe ? "Bewerbung erstellen" : "Building application", async () => {
      const existing = findJobByUrlKey(data.jobPosts, extraction.url);
      const created = existing
        ? data
        : await jobCentral().createJob({
          company: extraction.company,
          title: extraction.title,
          location: extraction.location,
          url: extraction.url,
          description: extraction.description,
          fitReason: "Imported from a job link.",
          score: 8,
        });
      const job = findJobByUrlKey(created.jobPosts, extraction.url);
      const application = job ? created.applications.find((item) => item.jobPostId === job.id) : undefined;
      setData(created);
      if (!job || !application) return created;
      const afterCv = created.cvVersions.some((cv) => cv.jobId === job.id)
        ? created
        : await jobCentral().createCvVariant({
          jobId: job.id,
          title: `${job.company} - ${job.title}`,
          notes: "Generated from a pasted job link.",
          reuseExisting: true,
        });
      const cv = afterCv.cvVersions.find((item) => item.jobId === job.id);
      const afterLetter = afterCv.coverLetters.some((letter) => letter.jobId === job.id && letter.language === data.settings.language)
        ? afterCv
        : await jobCentral().generateCoverLetter({
          jobId: job.id,
          cvVersionId: cv?.id,
          language: data.settings.language,
          instructions: `Write specifically for ${extraction.company} ${extraction.title}, using the generated job CV and the real posting requirements.`,
        });
      const next = await jobCentral().updateApplication({
        applicationId: application.id,
        status: "evaluating",
        cvVersionId: afterLetter.cvVersions.find((item) => item.jobId === job.id)?.id ?? cv?.id,
        eventDetail: "Built tailored CV + motivation from a pasted job link.",
      });
      setData(next);
      onSelect(application.id);
      // Land the user on the freshly built job in the Pipeline board — otherwise the
      // build finishes off-screen and reads as "nothing happened" (same reason the
      // search-card flow below opens the pipeline).
      onOpenPipeline();
      return next;
    });
  }

  async function addSearchTarget(target: AiJobTarget, prepare: boolean) {
    const existing = findJobByUrlKey(data.jobPosts, target.url);
    const existingApplication = existing ? data.applications.find((application) => application.jobPostId === existing.id) : undefined;
    const nextData = existing && existingApplication
      ? data
      : await jobCentral().createJob({
        company: target.company,
        title: target.title,
        location: target.location || searchIdea,
        url: target.url,
        description: target.reason,
        fitReason: target.reason,
        score: 8,
      });
    const job = findJobByUrlKey(nextData.jobPosts, target.url) ?? existing;
    const application = job ? nextData.applications.find((item) => item.jobPostId === job.id) : undefined;
    setData(nextData);
    if (application) onSelect(application.id);
    if (application || job) {
      setDismissedTargetKeys((keys) => keys.includes(target.key) ? keys : [...keys, target.key]);
      setTargetModalKey(null);
      // Surface the new clip immediately — otherwise it lands in the pipeline while
      // the user is still looking at the search results and thinks nothing happened.
      onOpenPipeline();
    }
    if (!application || !prepare) return nextData;
    const existingCv = nextData.cvVersions.find((item) => item.jobId === application.jobPostId);
    const afterCv = existingCv
      ? nextData
      : await jobCentral().createCvVariant({
        jobId: application.jobPostId,
        title: `${job?.company ?? target.company} - ${job?.title ?? target.title}`,
        notes: "Generated from AI search card.",
        reuseExisting: true,
      });
    const cv = afterCv.cvVersions.find((item) => item.jobId === application.jobPostId);
    const existingLetter = afterCv.coverLetters.find((letter) => letter.jobId === application.jobPostId && letter.language === data.settings.language);
    const afterLetter = existingLetter
      ? afterCv
      : await jobCentral().generateCoverLetter({
        jobId: application.jobPostId,
        cvVersionId: cv?.id,
        language: data.settings.language,
        instructions: `Write specifically for the "${target.title}" role at ${target.company}. Base it on the generated job CV; the fit reason is: ${target.reason}`,
      });
    const next = await jobCentral().updateApplication({
      applicationId: application.id,
      status: "evaluating",
      cvVersionId: afterLetter.cvVersions.find((item) => item.jobId === application.jobPostId)?.id ?? cv?.id,
      eventDetail: "Generated CV and motivation from AI search result.",
    });
    setData(next);
    return next;
  }

  async function askAi(purpose: AiPlan["purpose"], title: string) {
    if (!selectedJob) return data;
    const prompt = aiMessage || (
      purpose === "tailor_cv"
        ? "Review the selected CV for this job and propose specific section changes. Do not apply them."
        : purpose === "interview_prep"
          ? "Prepare interview notes, risks, likely questions, and suggested positioning for this job."
          : "Evaluate this job with a fit score, risks, missing information, and a clear apply/watch/skip recommendation."
    );
    const next = await jobCentral().sendJobAiMessage({
      jobId: selectedJob.id,
      cvVersionId: selectedCv?.id,
      letterId: selectedLetter?.id,
      message: `${title}\n\n${prompt}`,
    });
    setData(next);
    setAiMessage("");
    setJobWorkspaceTab("ai");
    return next;
  }

  async function sendJobMessage() {
    if (!selectedJob || !aiMessage.trim()) return data;
    const next = await jobCentral().sendJobAiMessage({
      jobId: selectedJob.id,
      cvVersionId: selectedCv?.id,
      letterId: selectedLetter?.id,
      message: aiMessage,
    });
    setData(next);
    setAiMessage("");
    setJobWorkspaceTab("ai");
    return next;
  }

  async function resolveProposal(proposal: AiProposal, action: "accept" | "reject" | "edit") {
    const next = await jobCentral().resolveAiProposal({
      proposalId: proposal.id,
      action,
      edited: proposalEdits[proposal.id],
    });
    setData(next);
    setProposalEdits((current) => {
      const copy = { ...current };
      delete copy[proposal.id];
      return copy;
    });
    return next;
  }

  async function saveEvaluation(evaluation: JobEvaluation) {
    const next = await jobCentral().updateJobEvaluation(evaluation);
    setData(next);
    return next;
  }

  async function exportApplicationPackage() {
    if (!selectedCv && !selectedLetter) return { data, result: { pdfPath: "" } };
    let nextData = data;
    let cvPath = "";
    let letterPath = "";
    if (selectedCv) {
      const cvResult = await jobCentral().generateCvPdf(selectedCv.id);
      nextData = cvResult.data;
      cvPath = cvResult.result.pdfPath;
    }
    if (selectedLetter) {
      const letterResult = await jobCentral().generateCoverLetterPdf(selectedLetter.id);
      nextData = letterResult.data;
      letterPath = letterResult.result.pdfPath;
    }
    setData(nextData);
    return { data: nextData, result: { pdfPath: [cvPath, letterPath].filter(Boolean).join(" + ") || "PDFs generated" } };
  }

  return (
    <div className="cockpit-layout">
      <section className="cockpit-main">
        {studioTab === "search" ? (
        <article className="cockpit-card search-command">
          <div className="cockpit-card-head">
            <div>
              <span>{isDe ? "Jobs finden" : "Find jobs"}</span>
              <h2>{isDe ? "Suchen, prüfen, entscheiden" : "Search, inspect, then decide"}</h2>
            </div>
          </div>
          {showCriteria ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCriteria(false)}>
            <section className="detail-modal criteria-modal" role="dialog" aria-modal="true" aria-labelledby="criteria-modal-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h2 id="criteria-modal-title">{isDe ? "Kriterien anpassen" : "Adjust criteria"}</h2>
                  <p>{isDe ? "Rollen, Ort, Schlüsselwörter, Firmen & Quellen" : "Roles, location, keywords, companies & sources"}</p>
                </div>
                <button className="row-icon-button" onClick={() => setShowCriteria(false)} title={isDe ? "Schließen" : "Close"}><X size={18} /></button>
              </div>
            <div className="search-adjust-body">
              <div className="search-field-grid">
                <label>
                  {isDe ? "Rollen" : "Roles"}
                  <input value={targetRoles} onChange={(event) => setTargetRoles(event.target.value)} onBlur={() => void saveSearchPreferences()} placeholder={isDe ? "z. B. Staff Frontend Engineer, Engineering Manager" : "e.g. Staff Frontend Engineer, Engineering Manager"} />
                </label>
                <label>
                  {isDe ? "Wo" : "Where"}
                  <input value={searchIdea} onChange={(event) => setSearchIdea(event.target.value)} onBlur={() => void saveSearchPreferences()} placeholder={isDe ? "z. B. Zürich, Remote Schweiz" : "e.g. Zurich, Remote Switzerland"} />
                </label>
                <label>
                  {isDe ? "Muss passen / boosten" : "Must match / boost"}
                  <input value={searchText.positiveKeywords} onChange={(event) => setSearchList("positiveKeywords", event.target.value)} onBlur={() => void saveSearchPreferences()} placeholder={isDe ? "z. B. TypeScript, Leadership, Fintech" : "e.g. TypeScript, leadership, fintech"} />
                </label>
                <label>
                  {isDe ? "Immer ausschließen" : "Always exclude"}
                  <input value={searchText.negativeKeywords} onChange={(event) => setSearchList("negativeKeywords", event.target.value)} onBlur={() => void saveSearchPreferences()} placeholder={isDe ? "z. B. nur vor Ort, US-Vertrieb" : "e.g. on-site only, US sales"} />
                </label>
                <label>
                  {isDe ? "Zielfirmen" : "Focus companies"}
                  <input value={searchText.targetCompanies} onChange={(event) => setSearchList("targetCompanies", event.target.value)} onBlur={() => void saveSearchPreferences()} placeholder={isDe ? "z. B. Google, Roche, On — auch Karriereseiten" : "e.g. Google, Roche, On — careers pages too"} />
                </label>
                <label>
                  {isDe ? "Ausgeschlossene Firmen" : "Excluded companies"}
                  <input value={searchText.excludedCompanies} onChange={(event) => setSearchList("excludedCompanies", event.target.value)} onBlur={() => void saveSearchPreferences()} placeholder={isDe ? "Optional" : "Optional"} />
                </label>
              </div>
              <div className="search-sources">
                <div className="search-block-head">
                  <Globe2 size={15} />
                  <span>{isDe ? "Wo die KI sucht" : "Where the AI looks"}</span>
                  <small>{enabledPortals.length}/{data.portals.length} {isDe ? "aktiv" : "on"}</small>
                </div>
                <div className="search-source-chips">
                  {data.portals.map((portal) => (
                    <button
                      key={portal.id}
                      type="button"
                      className={`source-chip ${portal.enabled ? "on" : ""}`}
                      title={portal.enabled ? (isDe ? `${portal.name} — klicken zum Deaktivieren` : `${portal.name} — click to skip`) : (isDe ? `${portal.name} — klicken zum Aktivieren` : `${portal.name} — click to include`)}
                      onClick={() => run(portal.enabled ? (isDe ? `${portal.name} deaktivieren` : `Skipping ${portal.name}`) : (isDe ? `${portal.name} aktivieren` : `Adding ${portal.name}`), () => toggleSource(portal))}
                    >
                      {portal.enabled ? <Check size={13} /> : <Plus size={13} />}
                      {portal.name}
                    </button>
                  ))}
                </div>
                <small className="search-sources-hint">{isDe ? "Eigene Jobquellen unter Einstellungen → Portale hinzufügen oder bearbeiten." : "Add or edit custom job sources in Settings → Portals."}</small>
              </div>
              <div className="search-adjust-actions">
                <button className="primary" onClick={() => { void run(isDe ? "Kriterien speichern" : "Saving criteria", saveSearchPreferences); setShowCriteria(false); }}><Save size={16} /> {isDe ? "Kriterien speichern" : "Save criteria"}</button>
              </div>
            </div>
            </section>
          </div>
          ) : null}
          <div className="search-launch">
            <button type="button" className="search-adjust-bar" onClick={() => setShowCriteria(true)}>
              <span><Pencil size={15} /> {isDe ? "Kriterien anpassen" : "Adjust criteria"}</span>
              <small>{isDe ? "Rollen, Ort, Schlüsselwörter, Firmen & Quellen" : "roles, location, keywords, companies & sources"}</small>
            </button>
            <div className="search-block">
              <div className="search-block-head">
                <Bot size={15} />
                <span>{isDe ? "Der KI mehr sagen (optional)" : "Tell the AI more (optional)"}</span>
              </div>
              <textarea
                value={searchQuestion}
                onChange={(event) => setSearchQuestion(event.target.value)}
                placeholder={searchPlan?.output
                  ? (isDe ? "Beantworte die Fragen der KI oder verfeinere (z. B. 'Ich spreche Deutsch, React-fokussiert, lieber Startups, offen für Bern remote'), dann erneut Jobs suchen." : "Answer the AI's questions or refine (e.g. \"I speak German, React-focused, prefer startups, open to Bern remote\"), then Search jobs again.")
                  : (isDe ? "Was einschließen oder ausschließen: Gehalt, Pendelweg, Remote, Firmengröße, Branchen, zu vermeidende Rollen. Beispiel: nur CH-Stellen, kein US-Vertrieb, Zürich oder remote." : "What to include or exclude: salary, commute, remote, company size, industries, roles to avoid. Example: only CH roles, no US sales, Zurich or remote.")}
              />
            </div>
            <div className="search-launch-actions">
              <button className="primary" disabled={Boolean(busy)} onClick={() => run(searchBusyLabel, runJobSearch)}>
                {isJobSearching ? <Loader2 size={17} className="spin" /> : <Search size={17} />}
                {isJobSearching ? (isDe ? "Suche läuft…" : "Searching…") : (isDe ? "Jobs suchen" : "Search jobs")}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={Boolean(busy)}
                title={isDe ? "Neue Jobs aus deinen Quellen (Greenhouse, Lever, Personio, …) in die Pipeline holen" : "Pull fresh jobs from your aggregated sources (Greenhouse, Lever, Personio, …) into your pipeline"}
                onClick={() => run(
                  isDe ? "Jobquellen synchronisieren" : "Syncing job sources",
                  async () => {
                    const before = data.jobPosts.length;
                    const next = await jobCentral().pipelineSync();
                    setData(next);
                    return next.jobPosts.length - before;
                  },
                  (added) => added > 0
                    ? (isDe ? `${added} Job${added === 1 ? "" : "s"} aus deinen Quellen hinzugefügt.` : `Added ${added} job${added === 1 ? "" : "s"} from your sources.`)
                    : (isDe ? "Gerade keine neuen Jobs aus deinen Quellen." : "No new jobs from your sources right now."),
                )}
              >
                <RefreshCw size={16} /> {isDe ? "Quellen sync." : "Sync sources"}
              </button>
              <button type="button" className="link-like paste-link-toggle" onClick={() => setShowPasteLink((value) => !value)}>
                {showPasteLink ? <X size={15} /> : <Plus size={15} />} {isDe ? "Job-Link einfügen" : "Paste a job link"}
              </button>
            </div>
            {isJobSearching ? (
              <div className="search-progress" role="status" aria-live="polite">
                <div className="search-progress-bar" />
                <span>{isDe ? "Alle Quellen werden durchsucht — die KI wertet aus…" : "Searching all sources — the AI is evaluating…"}</span>
              </div>
            ) : null}
            {showPasteLink ? (
              <div className="paste-link-row">
                <input
                  value={pasteLink}
                  onChange={(event) => setPasteLink(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && pasteLink.trim()) { setBrowserUrl(pasteLink.trim()); setPasteLink(""); setShowPasteLink(false); } }}
                  placeholder={isDe ? "Stellenlink einfügen — KI importiert ihn und erstellt ein passendes Lebenslauf + Anschreiben" : "Paste a posting URL — AI imports it and builds a tailored CV + cover letter"}
                  spellCheck={false}
                  autoFocus
                />
                <button className="primary" disabled={!pasteLink.trim()} onClick={() => { setBrowserUrl(pasteLink.trim()); setPasteLink(""); setShowPasteLink(false); }}>
                  <ArrowRight size={16} /> {isDe ? "Öffnen & erstellen" : "Open & build"}
                </button>
              </div>
            ) : null}
          </div>

          <details className={`ai-search-console ${isSearching || isScanning ? "running" : ""}`} open={isSearching || isScanning || !searchTargets.length}>
            <summary className="ai-search-console-head">
              <div>
                <span>{isDe ? "KI-Ausführungsprotokoll" : "AI run log"}</span>
                <strong>{searchStateLabel}</strong>
              </div>
              <div className="ai-search-provider">
                {isSearching || isScanning ? <Loader2 className="spin" size={15} /> : <Bot size={15} />}
                <span>{selectedProvider ? `${selectedProvider.label} · ${selectedModelLabel}` : (isDe ? "Kein CLI ausgewählt" : "No CLI selected")}</span>
              </div>
            </summary>
            <div className="ai-search-console-body">
              <div className="ai-search-steps">
                <div className="ai-search-step done">
                  <strong>{isDe ? "1. Einstellungen" : "1. Preferences"}</strong>
                  <span>{targetRoles ? (isDe ? "Rollen gesetzt" : "roles set") : (isDe ? "Rollen fehlen" : "missing roles")}</span>
                </div>
                <div className={`ai-search-step ${isSearching ? "active" : searchPlan ? "done" : ""}`}>
                  <strong>{isDe ? "2. KI-Suche" : "2. AI search"}</strong>
                  <span>{isSearching ? (isDe ? "läuft" : "running") : searchPlan ? searchPlan.status : (isDe ? "nicht gestartet" : "not started")}</span>
                </div>
                <div className={`ai-search-step ${isScanning ? "active" : scanResults.length ? "done" : ""}`}>
                  <strong>{isDe ? "3. Live-Boards" : "3. Live boards"}</strong>
                  <span>{enabledPortals.length} {isDe ? "konfiguriert" : "configured"}</span>
                </div>
                <div className={`ai-search-step ${searchTargets.length ? "done" : ""}`}>
                  <strong>{isDe ? "4. Deine Entscheidung" : "4. Your decision"}</strong>
                  <span>{searchTargets.length ? `${searchTargets.length} ${isDe ? "Karten" : "cards"}` : (isDe ? "wartend" : "waiting")}</span>
                </div>
              </div>
              <pre className="ai-terminal">{promptPreview}
{isSearching ? (isDe ? "\n\n> Ausgewähltes CLI läuft. Nichts wird automatisch hinzugefügt." : "\n\n> Running selected CLI now. Nothing is added automatically.") : ""}
{isScanning ? (isDe ? "\n\n> Aktivierte Portale werden mit gespeicherten Sucheinstellungen gescannt." : "\n\n> Scanning enabled portals with saved search defaults.") : ""}
{!isSearching && !isScanning && searchTargets.length ? (isDe ? "\n\n> Karten prüfen. Gute Jobs hinzufügen, schwache verwerfen oder Lebenslauf + Anschreiben erstellen." : "\n\n> Review the cards below. Add good jobs, dismiss weak jobs, or build CV + Motivation.") : ""}
{!isSearching && !isScanning && !searchTargets.length && !searchPlan?.output ? (isDe ? "\n\n> Bereit. Klicke auf 'Jobs finden' um erklärbare Job-Karten zu erstellen." : "\n\n> Ready. Click Run onboarding search to create explainable job cards.") : ""}</pre>
              {searchPlan?.output ? (
                <div className={`ai-search-output inline ${looksLikeAiFailure(searchPlan) ? "failed" : ""}`}>
                  <strong>{looksLikeAiFailure(searchPlan) ? (isDe ? "KI-Problem" : "AI issue") : (isDe ? "Letzte KI-Antwort" : "Last AI answer")}</strong>
                  <span>{looksLikeAiFailure(searchPlan) ? summarizeAiFailure(searchPlan.output) : (isDe ? "In Karten umgewandelt, soweit möglich. Vollständige Antwort nur bei Bedarf öffnen." : "Parsed into cards when possible. Open the full answer only when you need the raw reasoning.")}</span>
                  {!looksLikeAiFailure(searchPlan) && searchTargets.length ? (
                    <details className="ai-output-details">
                      <summary>{isDe ? "Vollständige KI-Antwort anzeigen" : "Show full AI answer"}</summary>
                      <pre>{searchPlan.output}</pre>
                    </details>
                  ) : null}
                  {!looksLikeAiFailure(searchPlan) && !searchTargets.length ? <pre>{searchPlan.output}</pre> : null}
                </div>
              ) : null}
            </div>
          </details>
          {searchTargets.length ? (
            <div className="search-results">
              <div className="search-result-toolbar">
                <div>
                  <strong>{searchTargets.length} {isDe ? "KI-Vorschläge" : "AI suggestions"}{resultsPageCount > 1 ? ` · ${isDe ? "Seite" : "page"} ${resultsPageSafe + 1}/${resultsPageCount}` : ""}</strong>
                  <span>{isDe ? "Beste Passung zuerst — Ergebnis auswählen, um Passung, Quelle und nächsten Schritt zu prüfen." : "Best fit first — select a result to inspect the fit, source, and next action."}</span>
                </div>
                <div className="search-result-actions">
                  <button className="secondary small" onClick={() => void run(isDe ? "Vorschläge verwerfen" : "Clearing suggestions", () => dismissSearchTargets(searchTargets))}>
                    <Trash2 size={15} /> {isDe ? "Alle verwerfen" : "Clear"}
                  </button>
                  {archivedJobs.length ? (
                    <button className="secondary small" onClick={() => setArchiveOpen((value) => !value)}>
                      <Archive size={15} /> {isDe ? "Archiv" : "Archive"} <span>{archivedJobs.length}</span>
                    </button>
                  ) : null}
                </div>
              </div>
              {archiveOpen && archivedJobs.length ? (
                <div className="search-archive-panel">
                  <div className="search-archive-head">
                    <div>
                      <strong>{isDe ? "Verworfene Jobs" : "Archived jobs"}</strong>
                      <span>{isDe ? "Wiederherstellen entfernt die Sperre und legt Jobs mit gespeicherten Details zurück in die Pipeline." : "Restore removes the block and puts jobs with saved details back into the pipeline."}</span>
                    </div>
                    <button className="secondary small" onClick={() => void run(isDe ? "Archiv wiederherstellen" : "Restoring archive", restoreAllArchivedJobs)}>
                      <RefreshCw size={15} /> {isDe ? "Alle wiederherstellen" : "Restore all"}
                    </button>
                  </div>
                  <div className="search-archive-list">
                    {archivedJobs.map((job) => (
                      <div key={normalizeJobUrlKey(job.url)} className="search-archive-item">
                        <div>
                          <strong>{job.title || (isDe ? "Archivierter Job" : "Archived job")}</strong>
                          <span>{[job.company, job.location].filter(Boolean).join(" · ") || job.url}</span>
                          {job.reason ? <p>{job.reason}</p> : null}
                        </div>
                        <div className="search-archive-actions">
                          <button className="link-like" onClick={() => setBrowserUrl(job.url)}><Globe2 size={14} /> {isDe ? "Öffnen" : "Open"}</button>
                          <button className="secondary small" onClick={() => void run(isDe ? "Job wiederherstellen" : "Restoring job", () => restoreArchivedJob(job.url))}>
                            <RefreshCw size={14} /> {isDe ? "Wiederherstellen" : "Restore"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="search-review-layout">
              <div className="search-suggestions-grid search-result-list">
                {pagedTargets.map((target) => {
                  const sourceLabel = sourceLabelForTarget(target);
                  const check = linkChecks[target.url];
                  // Single source of truth: if this posting is already a tracked job
                  // with a CV + letter, don't offer "create" again — offer "open".
                  const existingJob = findJobByUrlKey(data.jobPosts, target.url);
                  const existingApp = existingJob ? data.applications.find((app) => app.jobPostId === existingJob.id) : undefined;
                  const targetPrepared = Boolean(
                    existingJob &&
                    data.cvVersions.some((cv) => cv.jobId === existingJob.id) &&
                    data.coverLetters.some((letter) => letter.jobId === existingJob.id),
                  );
                  return (
                  <article
                    key={target.key}
                    className={`ai-target-card ${selectedSearchTarget?.key === target.key ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedTargetKey(target.key);
                      setTargetModalKey(target.key);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTargetKey(target.key);
                        setTargetModalKey(target.key);
                      }
                    }}
                  >
                    <div className="ai-target-head">
                      <div>
                        <strong>{target.title}</strong>
                        <span>{target.company}</span>
                        <small>
                          {[target.location, sourceLabel].filter(Boolean).join(" · ")}
                          {check === "checking" ? <span className="link-badge checking">{isDe ? "Link wird geprüft…" : "checking link…"}</span>
                            : check ? (check.alive ? <span className="link-badge live">✓ live</span> : <span className="link-badge dead">{isDe ? "Link möglicherweise ungültig" : "link may be dead"}</span>)
                            : null}
                        </small>
                      </div>
                      <div className="ai-target-head-right">
                        {typeof target.fit === "number" ? <FitRing value={target.fit} onExplain={() => { setSelectedTargetKey(target.key); setTargetModalKey(target.key); }} isDe={isDe} /> : null}
                        <button
                          className="row-icon-button danger"
	                          title={isDe ? "Verwerfen" : "Dismiss"}
	                          onClick={(event) => {
	                            event.stopPropagation();
	                            void run(isDe ? "Job verwerfen" : "Dismissing job", () => dismissSearchTargets([target]));
	                          }}
	                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <p>{target.reason}</p>
                    <div className="ai-target-links">
                      <button className="link-like" onClick={(event) => { event.stopPropagation(); setBrowserUrl(target.url); }}><Globe2 size={15} /> {isDe ? "In App öffnen" : "Open in app"}</button>
                      <a href={target.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><ExternalLink size={15} /> {isDe ? "Extern öffnen" : "Open externally"}</a>
                    </div>
                    <div className="toolbar-row">
                      {targetPrepared ? (
                        <button className="primary" onClick={(event) => {
                          event.stopPropagation();
                          if (existingApp) onSelect(existingApp.id);
                          onOpenPipeline();
                        }}><Check size={16} /> {isDe ? "Paket fertig — öffnen" : "Package ready — open"}</button>
                      ) : (
                        <>
                          <button className="secondary" onClick={(event) => {
                            event.stopPropagation();
                            return run(isDe ? "Job hinzufügen" : "Adding job", () => addSearchTarget(target, false));
                          }}><Plus size={16} /> {existingJob ? (isDe ? "In Pipeline" : "In pipeline") : (isDe ? "Zur Pipeline" : "Add to pipeline")}</button>
                          <button className="primary" onClick={(event) => {
                            event.stopPropagation();
                            return run(isDe ? "Job vorbereiten" : "Preparing job", () => addSearchTarget(target, true));
                          }}><Sparkles size={16} /> CV + Motivation</button>
                        </>
                      )}
                    </div>
                  </article>
                  );
                })}
              </div>
              </div>
              {resultsPageCount > 1 ? (
                <div className="results-pagination">
                  <button className="page-btn" disabled={resultsPageSafe === 0} onClick={() => setResultsPage(resultsPageSafe - 1)} aria-label={isDe ? "Vorherige Seite" : "Previous page"}>‹</button>
                  {Array.from({ length: resultsPageCount }, (_, i) => (
                    <button key={i} className={`page-btn ${i === resultsPageSafe ? "active" : ""}`} onClick={() => setResultsPage(i)}>{i + 1}</button>
                  ))}
                  <button className="page-btn" disabled={resultsPageSafe >= resultsPageCount - 1} onClick={() => setResultsPage(resultsPageSafe + 1)} aria-label={isDe ? "Nächste Seite" : "Next page"}>›</button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-inline search-empty">
              <h3>{isDe ? "Noch keine Vorschläge" : "No suggestions yet"}</h3>
              <p>{isDe ? "Rollen und Ort eingeben, dann auf 'Jobs finden' klicken. Die KI durchsucht alle Quellen und liefert Karten mit Begründung, Quelle und Aktionen." : "Enter the roles and location, then click Find jobs. The AI searches all your sources and returns cards with reason, source and actions."}</p>
              {archivedJobs.length ? (
                <button className="secondary" onClick={() => setArchiveOpen((value) => !value)}>
                  <Archive size={16} /> {isDe ? `Archiv anzeigen (${archivedJobs.length})` : `Show archive (${archivedJobs.length})`}
                </button>
              ) : null}
            </div>
          )}
          {!searchTargets.length && archiveOpen && archivedJobs.length ? (
            <div className="search-archive-panel">
              <div className="search-archive-head">
                <div>
                  <strong>{isDe ? "Verworfene Jobs" : "Archived jobs"}</strong>
                  <span>{isDe ? "Wiederherstellen entfernt die Sperre und legt Jobs mit gespeicherten Details zurück in die Pipeline." : "Restore removes the block and puts jobs with saved details back into the pipeline."}</span>
                </div>
                <button className="secondary small" onClick={() => void run(isDe ? "Archiv wiederherstellen" : "Restoring archive", restoreAllArchivedJobs)}>
                  <RefreshCw size={15} /> {isDe ? "Alle wiederherstellen" : "Restore all"}
                </button>
              </div>
              <div className="search-archive-list">
                {archivedJobs.map((job) => (
                  <div key={normalizeJobUrlKey(job.url)} className="search-archive-item">
                    <div>
                      <strong>{job.title || (isDe ? "Archivierter Job" : "Archived job")}</strong>
                      <span>{[job.company, job.location].filter(Boolean).join(" · ") || job.url}</span>
                      {job.reason ? <p>{job.reason}</p> : null}
                    </div>
                    <div className="search-archive-actions">
                      <button className="link-like" onClick={() => setBrowserUrl(job.url)}><Globe2 size={14} /> {isDe ? "Öffnen" : "Open"}</button>
                      <button className="secondary small" onClick={() => void run(isDe ? "Job wiederherstellen" : "Restoring job", () => restoreArchivedJob(job.url))}>
                        <RefreshCw size={14} /> {isDe ? "Wiederherstellen" : "Restore"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {scanResults.length && scanTotals.scanned > 0 ? (
            <details className="scan-summary scan-summary-disclosure">
              <summary>
                <div>
                  <strong>{isDe ? "Live-Board-Prüfung" : "Live board check"}</strong>
                  <span>{scanTotals.scanned} {isDe ? "gescannt" : "scanned"} · {scanTotals.added} {isDe ? "hinzugefügt" : "added"} · {scanTotals.skipped} {isDe ? "übersprungen" : "skipped"}</span>
                </div>
                <small>{scanHasOnlyZeroes ? (isDe ? "Suchquellen sind nur KI-basiert, bis Live-Abruf hinzugefügt wird." : "Search sources are AI-only until live fetch is added.") : `${scanTotals.errors} ${isDe ? "Quellhinweise" : "source notes"}`}</small>
              </summary>
              {scanHasOnlyZeroes ? (
                <p className="scan-summary-note">
                  {isDe ? "SwissDevJobs, Jobs.ch, LinkedIn, Google und Indeed sind derzeit Suchquellen für den KI-Prompt. Live-Scanning ruft nur ATS-Boards mit öffentlichen APIs ab, wie Ashby, Greenhouse und Lever." : "SwissDevJobs, Jobs.ch, LinkedIn, Google and Indeed are currently search sources for the AI prompt. Live scanning only fetches ATS boards with public APIs like Ashby, Greenhouse and Lever."}
                </p>
              ) : (
                <div className="scan-summary-grid">
                  {scanResults.map((result) => (
                    <div key={result.portalId}>
                      <strong>{result.portalName}</strong>
                      <span>{result.scanned} {isDe ? "gescannt" : "scanned"} · {result.added} {isDe ? "hinzugefügt" : "added"} · {result.skipped} {isDe ? "übersprungen" : "skipped"}</span>
                      {result.errors.length ? <small>{result.errors[0]}</small> : null}
                    </div>
                  ))}
                </div>
              )}
            </details>
          ) : null}
        </article>
        ) : null}

        {studioTab === "pipeline" ? (
        <article className="cockpit-card studio-board">
          <div className="cockpit-card-head">
            <div>
              <span>{isDe ? "Pipeline-Board" : "Pipeline board"}</span>
              <h2>{isDe ? "Bewerbungen hier verfolgen" : "Track the same jobs here"}</h2>
            </div>
          </div>
          <div className="studio-board-grid">
            {statusOrder.map((status) => {
              const apps = data.applications.filter((application) => application.status === status && !application.archivedAt);
              return (
                <div
                  className={`studio-lane ${draggingAppId ? "drop-ready" : ""}`}
                  key={status}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const appId = draggingAppId;
                    setDraggingAppId(null);
                    if (!appId) return;
                    const app = data.applications.find((item) => item.id === appId);
                    if (!app || app.status === status) return;
                    void run(isDe ? "Status aktualisieren" : "Updating status", () =>
                      jobCentral().updateApplication({ applicationId: appId, status }).then((next) => (setData(next), next)),
                    );
                  }}
                >
                  <h3>
                    <span className="lane-title">{statusLabels[status]}</span>
                    <span className="lane-head-right">
                      {apps.length}
                      {apps.length && (status === "rejected" || status === "ghosted") ? (
                        <button
                          type="button"
                          className="lane-archive-all"
                          title={isDe ? `Alle ${apps.length} archivieren (wiederherstellbar)` : `Archive all ${apps.length} (recoverable)`}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!confirmDestructive(isDe
                              ? `Alle ${apps.length} Bewerbungen in „${statusLabels[status]}“ archivieren? Sie bleiben gespeichert und sind unten wiederherstellbar.`
                              : `Archive all ${apps.length} applications in "${statusLabels[status]}"? They stay saved and can be restored below.`)) return;
                            void run(isDe ? "Archivieren" : "Archiving", () => jobCentral().archiveApplicationsByStatus(status).then((next) => (setData(next), next)));
                          }}
                        >
                          <Archive size={12} />
                        </button>
                      ) : null}
                    </span>
                  </h3>
                  {apps.map((application) => {
                    const job = data.jobPosts.find((item) => item.id === application.jobPostId);
                    return (
                      <button
                        key={application.id}
                        draggable
                        className={selectedApplication?.id === application.id ? "selected" : ""}
                        onClick={() => {
                          onSelect(application.id);
                          setApplicationModalOpen(true);
                        }}
                        onDragStart={() => { setDraggingAppId(application.id); onSelect(application.id); }}
                        onDragEnd={() => setDraggingAppId(null)}
                      >
                        <GripVertical className="drag-dots" size={16} />
                        <div className="lane-card-text">
                          <strong>{job?.company ?? (isDe ? "Unbekannt" : "Unknown")}</strong>
                          <span>{job?.title ?? (isDe ? "Kein Titel" : "No title")}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {data.applications.some((application) => application.archivedAt) ? (
            <details className="archived-applications">
              <summary>
                <Archive size={14} /> {isDe ? "Archiviert" : "Archived"} <span className="archived-count">{data.applications.filter((application) => application.archivedAt).length}</span>
              </summary>
              <div className="archived-list">
                {data.applications
                  .filter((application) => application.archivedAt)
                  .map((application) => {
                    const job = data.jobPosts.find((item) => item.id === application.jobPostId);
                    return (
                      <div className="archived-row" key={application.id}>
                        <div className="archived-row-text">
                          <strong>{job?.company ?? (isDe ? "Unbekannt" : "Unknown")}</strong>
                          <span>{[job?.title, statusLabels[application.status], application.appliedAt ? `${isDe ? "beworben" : "applied"} ${new Date(application.appliedAt).toLocaleDateString(isDe ? "de-CH" : "en-GB")}` : ""].filter(Boolean).join(" · ")}</span>
                        </div>
                        <div className="archived-row-actions">
                          <button
                            className="secondary small"
                            onClick={() => void run(isDe ? "Wiederherstellen" : "Restoring", () => jobCentral().setApplicationArchived({ applicationId: application.id, archived: false }).then((next) => (setData(next), next)))}
                          >
                            <RefreshCw size={14} /> {isDe ? "Wiederherstellen" : "Restore"}
                          </button>
                          <button
                            className="row-icon-button danger"
                            title={isDe ? "Endgültig löschen" : "Delete permanently"}
                            onClick={() => {
                              if (!confirmDestructive(isDe ? "Diese Bewerbung endgültig löschen? Das kann nicht rückgängig gemacht werden." : "Permanently delete this application? This cannot be undone.")) return;
                              void run(isDe ? "Löschen" : "Deleting", () => jobCentral().deleteApplication(application.id).then((next) => (setData(next), next)));
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </details>
          ) : null}
        </article>
        ) : null}

        {applicationModalOpen && selectedApplication && selectedJob ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setApplicationModalOpen(false)}>
          <section className="detail-modal application-detail-modal" role="dialog" aria-modal="true" aria-labelledby="application-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <span>{isDe ? "Bewerbungspaket" : "Application package"}</span>
                <h2 id="application-detail-title">{selectedJob.company}</h2>
                <p>{selectedJob.title}</p>
              </div>
              <button className="secondary small" onClick={() => setApplicationModalOpen(false)}>{isDe ? "Schließen" : "Close"}</button>
            </div>
            <article className="cockpit-card job-command">
              <div className="job-command-head">
                <div>
                  <span>{statusLabels[selectedApplication.status]}</span>
                  <h2>{selectedJob.company}</h2>
                  <p>{selectedJob.title}</p>
                </div>
                {selectedJob.url ? <button className="link-like" onClick={() => setBrowserUrl(selectedJob.url)}><Globe2 size={16} /> {isDe ? "Öffnen & bewerben in App" : "Open & apply in app"}</button> : null}
                {(selectedCv || selectedLetter) ? (
                  <button
                    className="secondary small"
                    onClick={() =>
                      run(
                        isDe ? "Paket exportieren" : "Exporting package",
                        exportApplicationPackage,
                        packagePdfResultMessage,
                      )
                    }
                  >
                    <Download size={15} /> {isDe ? "Paket exportieren" : "Export package"}
                  </button>
                ) : null}
                {selectedApplication.status === "rejected" || selectedApplication.status === "ghosted" ? (
                  <button
                    className="secondary small"
                    title={isDe ? "Archivieren — bleibt gespeichert und ist wiederherstellbar" : "Archive — stays saved and is restorable"}
                    onClick={() => void run(isDe ? "Archivieren" : "Archiving", () =>
                      jobCentral().setApplicationArchived({ applicationId: selectedApplication.id, archived: true }).then((next) => {
                        setData(next);
                        onSelect(next.applications.find((application) => !application.archivedAt)?.id ?? "");
                        setApplicationModalOpen(false);
                        return next;
                      }),
                    )}
                  >
                    <Archive size={15} /> {isDe ? "Archivieren" : "Archive"}
                  </button>
                ) : null}
                <button
                  className="secondary small danger"
                  onClick={() =>
                    confirmDestructive(isDe ? `Bewerbung für ${selectedJob.company} - ${selectedJob.title} löschen?` : `Delete application for ${selectedJob.company} - ${selectedJob.title}?`)
                      ? run(isDe ? "Bewerbung löschen" : "Deleting application", () =>
                        jobCentral().deleteApplication(selectedApplication.id).then((next) => {
                        setData(next);
                        onSelect(next.applications[0]?.id ?? "");
                        setApplicationModalOpen(false);
                        return next;
                        }),
                      )
                      : undefined
                  }
                >
                  <Trash2 size={15} /> {isDe ? "Löschen" : "Delete"}
                </button>
              </div>
              <div className="job-command-grid">
                <label>{isDe ? "Status" : "Status"}
                  <select
                    value={selectedApplication.status}
                    onChange={(event) => {
                      const status = event.target.value as ApplicationStatus;
                      void run(isDe ? "Status aktualisieren" : "Updating status", () =>
                        jobCentral()
                          .updateApplication({ applicationId: selectedApplication.id, status })
                          .then((next) => (setData(next), next)),
                      );
                    }}
                  >
                    {statusOrder.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                  </select>
                </label>
                <label>{isDe ? "Nächste Aktion" : "Next action"}
                  <input
                    type="date"
                    value={selectedApplication.nextActionAt?.slice(0, 10) ?? ""}
                    onClick={(event) => { try { event.currentTarget.showPicker(); } catch { /* unsupported */ } }}
                    onChange={(event) => {
                      const nextActionAt = event.target.value;
                      void run(isDe ? "Nächste Aktion speichern" : "Saving next action", () =>
                        jobCentral()
                          .updateApplication({ applicationId: selectedApplication.id, nextActionAt })
                          .then((next) => (setData(next), next)),
                      );
                    }}
                  />
                </label>
                {selectedApplication.appliedAt || ["applied", "follow_up", "interview", "offer"].includes(selectedApplication.status) ? (
                  <label>{isDe ? "Beworben am" : "Applied on"}
                    <input
                      type="date"
                      value={selectedApplication.appliedAt?.slice(0, 10) ?? ""}
                      onClick={(event) => { try { event.currentTarget.showPicker(); } catch { /* unsupported */ } }}
                      onChange={(event) => {
                        const appliedAt = event.target.value;
                        void run(isDe ? "Bewerbungsdatum speichern" : "Saving applied date", () =>
                          jobCentral()
                            .updateApplication({ applicationId: selectedApplication.id, appliedAt })
                            .then((next) => (setData(next), next)),
                        );
                      }}
                    />
                  </label>
                ) : null}
              </div>
              <textarea
                value={selectedApplication.notes}
                onChange={(event) =>
                  setData({
                    ...data,
                    applications: data.applications.map((application) =>
                      application.id === selectedApplication.id ? { ...application, notes: event.target.value } : application,
                    ),
                  })
                }
                onBlur={(event) => {
                  const notes = event.currentTarget.value;
                  void run(isDe ? "Notizen speichern" : "Saving notes", () =>
                    jobCentral()
                      .updateApplication({ applicationId: selectedApplication.id, notes })
                      .then((next) => (setData(next), next)),
                  );
                }}
              />
              {selectedCv && selectedLetter ? (
                <div className="package-ready-row">
                  <button className="primary wide" onClick={() => setJobWorkspaceTab("package")}>
                    <Check size={18} /> {isDe ? "Paket fertig — öffnen" : "Package ready — open"}
                  </button>
                  <button className="link-like" onClick={() => run(isDe ? "Paket neu erstellen" : "Regenerating package", preparePackage)}>
                    {isDe ? "Neu erstellen" : "Regenerate"}
                  </button>
                </div>
              ) : (
                <button className="primary wide" onClick={() => run(isDe ? "Bewerbungspaket erstellen" : "Generating application package", preparePackage)}>
                  <Sparkles size={18} /> {selectedCv || selectedLetter
                    ? (isDe ? "Paket vervollständigen" : "Complete the package")
                    : (isDe ? "Lebenslauf + Anschreiben aus Master-CV erstellen" : "Generate CV + Motivation from master CV")}
                </button>
              )}
            </article>

            <article className="cockpit-card job-workspace">
              <div className="cockpit-card-head">
                <div>
                  <span>{isDe ? "Bewerbungs-Workspace" : "Application workspace"}</span>
                  <h2>{selectedJob.title}</h2>
                </div>
                <div className="workspace-score">
                  <strong>{selectedEvaluation?.fitScore ?? 0}</strong>
                  <span>{isDe ? "Passung" : "fit"}</span>
                </div>
              </div>
              <div className="workspace-tabs">
                {(["overview", "ai", "proposals", "package", "history"] as const).map((tab) => (
                  <button key={tab} className={jobWorkspaceTab === tab ? "active" : ""} onClick={() => setJobWorkspaceTab(tab)}>
                    {tab === "overview" ? (isDe ? "Übersicht" : "overview") : tab === "ai" ? (isDe ? "KI-Verlauf" : "AI memory") : tab === "proposals" ? (isDe ? "Vorschläge" : "proposals") : tab === "package" ? (isDe ? "Paket" : "package") : tab === "history" ? (isDe ? "Verlauf" : "history") : tab}
                    {tab === "proposals" && pendingProposals.length ? <span>{pendingProposals.length}</span> : null}
                  </button>
                ))}
              </div>

              {jobWorkspaceTab === "overview" && selectedEvaluation ? (
                <div className="workspace-overview">
                  <div className="rating-grid">
                    {(isDe
                      ? [["Passung", "fitScore"], ["Risiko", "riskScore"], ["Aufwand", "effortScore"], ["Priorität", "priorityScore"]]
                      : [["Fit", "fitScore"], ["Risk", "riskScore"], ["Effort", "effortScore"], ["Priority", "priorityScore"]]
                    ).map(([label, key]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={selectedEvaluation[key as keyof Pick<JobEvaluation, "fitScore" | "riskScore" | "effortScore" | "priorityScore">] as number}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            void saveEvaluation({
                              ...selectedEvaluation,
                              [key]: Number.isFinite(nextValue) ? Math.min(100, Math.max(0, nextValue)) : 0,
                            }).catch((error: unknown) => console.error(error));
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  {selectedJob.salaryEstimate ? (
                    <div className="salary-estimate">
                      <span>{isDe ? "Gehaltserwartung (Schätzung)" : "Salary expectation (est.)"}</span>
                      <strong>{formatSalaryRange(selectedJob.salaryEstimate, isDe)}</strong>
                      {selectedJob.salaryEstimate.basis ? <p>{selectedJob.salaryEstimate.basis}</p> : null}
                      <small>{isDe ? "KI-Schätzung — vor der Verhandlung prüfen." : "AI estimate — verify before negotiating."}</small>
                    </div>
                  ) : null}
                  <label>
                    {isDe ? "Entscheidungsnotizen" : "Decision notes"}
                    <textarea
                      value={selectedEvaluation.summary}
                      onChange={(event) =>
                        void saveEvaluation({ ...selectedEvaluation, summary: event.target.value }).catch((error: unknown) => console.error(error))
                      }
                    />
                  </label>
                  <div className="workspace-columns">
                    <div>
                      <strong>{isDe ? "Stärken" : "Strengths"}</strong>
                      {(selectedEvaluation.strengths.length ? selectedEvaluation.strengths : [selectedJob.fitReason || (isDe ? "Noch keine Stärken erfasst." : "No strengths captured yet.")]).map((item, index) => <p key={index}>{item}</p>)}
                    </div>
                    <div>
                      <strong>{isDe ? "Risiken" : "Risks"}</strong>
                      {(selectedEvaluation.risks.length ? selectedEvaluation.risks : [isDe ? "Noch keine Risiken erfasst." : "No risks captured yet."]).map((item, index) => <p key={index}>{item}</p>)}
                    </div>
                    <div>
                      <strong>{isDe ? "Fehlende Infos" : "Missing info"}</strong>
                      {(selectedEvaluation.missingInfo.length ? selectedEvaluation.missingInfo : [isDe ? "Noch nichts markiert." : "Nothing flagged yet."]).map((item, index) => <p key={index}>{item}</p>)}
                    </div>
                  </div>
                </div>
              ) : null}

              {jobWorkspaceTab === "proposals" ? (
                <div className="proposal-stack">
                  {selectedProposals.map((proposal) => (
                    <details key={proposal.id} open={proposal.status === "pending"}>
                      <summary>
                        <strong>{proposal.title}</strong>
                        <span>{proposal.status}</span>
                      </summary>
                      {proposal.rationale ? <p>{proposal.rationale}</p> : null}
                      {proposal.before ? (
                        <div className="proposal-diff">
                          <div><strong>{isDe ? "Vorher" : "Before"}</strong><pre>{proposal.before}</pre></div>
                          <div><strong>{isDe ? "Vorgeschlagen" : "Proposed"}</strong><pre>{proposalPreview(proposal)}</pre></div>
                        </div>
                      ) : <pre>{proposalPreview(proposal)}</pre>}
                      {proposal.status === "pending" ? (
                        <>
                          <textarea
                            value={proposalEdits[proposal.id] ?? proposal.proposed}
                            onChange={(event) => setProposalEdits({ ...proposalEdits, [proposal.id]: event.target.value })}
                          />
                          <div className="toolbar-row">
                            <button className="primary small" onClick={() => run(isDe ? "Vorschlag annehmen" : "Accepting proposal", () => resolveProposal(proposal, "accept"))}>{isDe ? "Annehmen" : "Accept"}</button>
                            <button
                              className="secondary small"
                              disabled={!(proposalEdits[proposal.id] ?? "").trim()}
                              onClick={() => run(isDe ? "Bearbeiteten Vorschlag übernehmen" : "Applying edited proposal", () => resolveProposal(proposal, "edit"))}
                            >
                              {isDe ? "Bearbeitung übernehmen" : "Apply edit"}
                            </button>
                            <button className="secondary small danger" onClick={() => run(isDe ? "Vorschlag ablehnen" : "Rejecting proposal", () => resolveProposal(proposal, "reject"))}>{isDe ? "Ablehnen" : "Reject"}</button>
                          </div>
                        </>
                      ) : null}
                    </details>
                  ))}
                  {!selectedProposals.length ? <div className="empty-inline"><p>{isDe ? "Noch keine KI-Vorschläge. Bitte die KI, Job, Lebenslauf oder Anschreiben zu prüfen." : "No AI proposals yet. Ask AI to review this job, CV, or motivation letter."}</p></div> : null}
                </div>
              ) : null}

              {jobWorkspaceTab === "package" ? (
                <div className="package-workspace">
                  <div className="checklist-grid">
                    {readiness.map((item) => (
                      <div key={item.label} className={item.ok ? "ok" : "warn"}>
                        <strong>{item.ok ? "OK" : (isDe ? "Prüfung nötig" : "Needs review")}</strong>
                        <span>{item.label}</span>
                        <p>{item.detail}</p>
                      </div>
                    ))}
                  </div>
                  <div className="toolbar-row">
                    <button className="primary" disabled={Boolean(selectedCv && selectedLetter)} onClick={() => run(isDe ? "Bewerbungspaket erstellen" : "Generating application package", preparePackage)}>
                      {selectedCv && selectedLetter ? <Check size={16} /> : <Sparkles size={16} />} {selectedCv && selectedLetter
                        ? (isDe ? "Paket vollständig" : "Package complete")
                        : (isDe ? "Fehlende Unterlagen erstellen" : "Build missing artifacts")}
                    </button>
                    <button className="secondary" disabled={!selectedCv && !selectedLetter} onClick={() => run(isDe ? "Paket exportieren" : "Exporting package", exportApplicationPackage, packagePdfResultMessage)}>
                      <Download size={16} /> {isDe ? "PDFs exportieren" : "Export PDFs"}
                    </button>
                    <button
                      className="secondary"
                      disabled={duplicateCvCount <= 1 && duplicateLetterCount <= 1}
                      onClick={() =>
                        confirmDestructive(isDe ? "Doppelte Lebensläufe und Anschreiben für diesen Job bereinigen?" : "Clean duplicate CVs and motivation letters for this job?")
                          ? run(isDe ? "Duplikate bereinigen" : "Cleaning duplicates", () => jobCentral().cleanupJobArtifacts(selectedJob.id).then((next) => (setData(next), next)))
                          : undefined
                      }
                    >
                      <Trash2 size={16} /> {isDe ? "Duplikate bereinigen" : "Clean duplicates"}
                    </button>
                  </div>
                </div>
              ) : null}

              {jobWorkspaceTab === "history" ? (
                <div className="workspace-history">
                  {[...selectedHistory.map((item) => ({ ...item, key: `artifact-${item.id}` })), ...(selectedApplication?.events ?? []).map((event) => ({
                    key: `event-${event.id}`,
                    title: event.title,
                    detail: event.detail,
                    createdAt: event.createdAt,
                  }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 24).map((item) => (
                    <div key={item.key}>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <small>{new Date(item.createdAt).toLocaleString()}</small>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>

            <div className="artifact-grid">
              <article className="cockpit-card artifact-card">
                <div className="cockpit-card-head">
                  <div>
                    <span>{isDe ? "Stellen-Lebenslauf" : "Job CV"}</span>
                    <h2>{selectedCv?.title ?? (isDe ? "Noch kein Lebenslauf" : "No CV yet")}</h2>
                  </div>
                  <div className="toolbar-row">
                    <button className="secondary small" onClick={onOpenCv}><Pencil size={15} /> {isDe ? "Anpassen" : "Adjust"}</button>
                    {selectedCv ? (
                      <>
                        <button
                          className="secondary small"
                          onClick={() =>
                            run(
                              isDe ? "Lebenslauf exportieren" : "Exporting CV",
                              () => jobCentral().generateCvPdf(selectedCv.id).then((result) => (setData(result.data), result)),
                              pdfResultMessage,
                            )
                          }
                        >
                          <Download size={15} /> PDF
                        </button>
                        <button
                          className="secondary small danger"
                          onClick={() =>
                            confirmDestructive(isDe ? `Lebenslauf '${selectedCv.title}' löschen?` : `Delete CV "${selectedCv.title}"?`)
                              ? run(isDe ? "Stellen-Lebenslauf löschen" : "Deleting job CV", () =>
                                jobCentral().deleteCvVersion(selectedCv.id).then((next) => (setData(next), next)),
                              )
                              : undefined
                          }
                        >
                          <Trash2 size={15} /> {isDe ? "Löschen" : "Delete"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {selectedCv ? <CvPreview profile={data.profile} cv={selectedCv} /> : <p>{isDe ? "Erstelle einen Stellen-Lebenslauf aus dem Master-CV, wenn diese Stelle es wert ist." : "Create a job CV from the master CV when this role is worth applying to."}</p>}
              </article>

              <article className="cockpit-card artifact-card">
                <div className="cockpit-card-head">
                  <div>
                    <span>{isDe ? "Anschreiben" : "Motivation"}</span>
                    <h2>{selectedLetter?.title ?? (isDe ? "Noch kein Anschreiben" : "No letter yet")}</h2>
                  </div>
                  <div className="toolbar-row">
                    <button className="secondary small" onClick={() => run(isDe ? "Anschreiben erstellen" : "Generating motivation", generateMotivationOnly)}>
                      <Sparkles size={15} /> {isDe ? "Erstellen" : "Generate"}
                    </button>
                    {selectedLetter ? (
                      <>
                        <button
                          className="primary small"
                          onClick={() =>
                            run(isDe ? "Anschreiben speichern" : "Saving motivation", () =>
                              jobCentral().saveCoverLetter(selectedLetter).then((next) => (setData(next), next)),
                            )
                          }
                        >
                          <Save size={15} /> {isDe ? "Speichern" : "Save"}
                        </button>
                        <button
                          className="secondary small"
                          onClick={() =>
                            run(
                              isDe ? "Anschreiben exportieren" : "Exporting motivation",
                              () => jobCentral().generateCoverLetterPdf(selectedLetter.id).then((result) => (setData(result.data), result)),
                              pdfResultMessage,
                            )
                          }
                        >
                          <Download size={15} /> PDF
                        </button>
                        <button
                          className="secondary small danger"
                          onClick={() =>
                            confirmDestructive(isDe ? `Anschreiben '${selectedLetter.title}' löschen?` : `Delete motivation letter "${selectedLetter.title}"?`)
                              ? run(isDe ? "Anschreiben löschen" : "Deleting motivation", () => jobCentral().deleteCoverLetter(selectedLetter.id).then((next) => (setData(next), next)))
                              : undefined
                          }
                        >
                          <Trash2 size={15} /> {isDe ? "Löschen" : "Delete"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {selectedLetter ? (
                  <textarea
                    className="motivation-editor"
                    value={selectedLetter.content}
                    onChange={(event) =>
                      setData({
                        ...data,
                        coverLetters: data.coverLetters.map((letter) =>
                          letter.id === selectedLetter.id ? { ...letter, content: event.target.value } : letter,
                        ),
                      })
                    }
                    onBlur={(event) =>
                      run(isDe ? "Anschreiben speichern" : "Saving motivation", () =>
                        jobCentral().saveCoverLetter({ ...selectedLetter, content: event.currentTarget.value }).then((next) => (setData(next), next)),
                      )
                    }
                  />
                ) : (
                  <div className="empty-inline">
                    <p>{isDe ? "Ersten Entwurf aus dem ausgewählten Job und Lebenslauf erstellen, dann hier bearbeiten." : "Generate a first draft from the selected job and CV, then edit it here."}</p>
                    <button className="primary" onClick={() => run(isDe ? "Anschreiben erstellen" : "Generating motivation", generateMotivationOnly)}>
                      <Sparkles size={16} /> {isDe ? "Anschreiben erstellen" : "Generate motivation"}
                    </button>
                  </div>
                )}
                {selectedLetter?.pdfPath ? <small className="file-path">{selectedLetter.pdfPath}</small> : null}
              </article>
            </div>

            {jobWorkspaceTab === "ai" ? (
            <article className="cockpit-card ai-thread">
              <div className="cockpit-card-head">
                <div>
                  <span>{isDe ? "Persistentes Job-Gedächtnis" : "Persistent job memory"}</span>
                  <h2>{isDe ? `KI-Thread für ${selectedJob.company}` : `AI thread for ${selectedJob.company}`}</h2>
                </div>
              </div>
              <div className="conversation-log">
                {(selectedConversation?.messages ?? []).map((message) => (
                  <div key={message.id} className={message.role}>
                    <strong>{message.role === "user" ? (isDe ? "Du" : "You") : "AI"}</strong>
                    <p>{message.content}</p>
                    <small>{new Date(message.createdAt).toLocaleString()}</small>
                  </div>
                ))}
                {!selectedConversation?.messages.length ? <div className="empty-inline"><p>{isDe ? "Noch kein jobspezifisches KI-Gedächtnis." : "No job-specific AI memory yet."}</p></div> : null}
              </div>
              <textarea
                value={aiMessage}
                onChange={(event) => setAiMessage(event.target.value)}
                placeholder={isDe ? "Frage, was schwach ist, wie du dich positionierst, was im Lebenslauf umgeschrieben werden soll oder was ins Anschreiben gehört." : "Ask what is weak, how to position this, what to rewrite in the CV, or what to say in the motivation letter."}
              />
              <div className="toolbar-row">
                <button className="primary" disabled={!aiMessage.trim()} onClick={() => run(isDe ? "Mit KI chatten" : "Chatting with AI", sendJobMessage)}><Bot size={16} /> {isDe ? "Senden" : "Send"}</button>
                <button className="secondary" onClick={() => run(isDe ? "KI fragen" : "Asking AI", () => askAi("evaluate_job", `Evaluate ${selectedJob.company}`))}><Bot size={16} /> {isDe ? "Passung erfragen" : "Ask about fit"}</button>
                <button className="secondary" onClick={() => run(isDe ? "KI fragen" : "Asking AI", () => askAi("tailor_cv", `Tailor CV for ${selectedJob.company}`))}><FileText size={16} /> {isDe ? "Lebenslauf-Tipps" : "CV advice"}</button>
                <button className="secondary" onClick={() => run(isDe ? "KI fragen" : "Asking AI", () => askAi("interview_prep", `Interview prep for ${selectedJob.company}`))}><Sparkles size={16} /> {isDe ? "Vorbereiten" : "Prep"}</button>
              </div>
              <div className="ai-plan-list">
                {jobPlans.map((plan) => (
                  <details key={plan.id} open={plan.id === jobPlans[0]?.id}>
                    <summary><strong>{plan.title}</strong><span>{[plan.status, plan.providerKey, plan.modelLabel].filter(Boolean).join(" · ")}</span></summary>
                    {plan.output ? <AiPlanOutput plan={plan} isDe={isDe} /> : <p>{isDe ? "Vorbereitet, aber noch nicht ausgeführt." : "Prepared but not run yet."}</p>}
                    {plan.status !== "ran" ? (
                      <button className="secondary small" onClick={() => run(isDe ? "KI ausführen" : "Running AI", () => jobCentral().runAiPlan(plan.id).then((next) => (setData(next), next)))}>
                        <Bot size={15} /> {isDe ? "Ausführen + Vorschläge erstellen" : "Run + create proposals"}
                      </button>
                    ) : null}
                  </details>
                ))}
              </div>
            </article>
            ) : null}
          </section>
          </div>
        ) : null}
        {modalSearchTarget ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setTargetModalKey(null)}>
            <section className="detail-modal target-modal" role="dialog" aria-modal="true" aria-labelledby="target-detail-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <span>{sourceLabelForTarget(modalSearchTarget)}</span>
                  <h2 id="target-detail-title">{modalSearchTarget.title}</h2>
                  <p>{modalSearchTarget.company}</p>
                </div>
                <button className="secondary small" onClick={() => setTargetModalKey(null)}>{isDe ? "Schließen" : "Close"}</button>
              </div>
              <div className="target-detail-body">
                <section className="target-detail-section">
                  <div className="target-detail-section-head">
                    <span>{isDe ? "Die Stelle" : "The role"}</span>
                    {typeof modalSearchTarget.fit === "number" ? <FitRing value={modalSearchTarget.fit} isDe={isDe} /> : null}
                  </div>
                  <dl className="target-facts">
                    <div><dt>{isDe ? "Position" : "Role"}</dt><dd>{modalSearchTarget.title}</dd></div>
                    <div><dt>{isDe ? "Unternehmen" : "Company"}</dt><dd>{modalSearchTarget.company || "—"}</dd></div>
                    <div><dt>{isDe ? "Ort" : "Location"}</dt><dd>{modalSearchTarget.location || (isDe ? "Nicht angegeben" : "Not specified")}</dd></div>
                    <div><dt>{isDe ? "Quelle" : "Source"}</dt><dd>{sourceLabelForTarget(modalSearchTarget)}</dd></div>
                  </dl>
                </section>
                <section className="target-detail-section">
                  <span>{typeof modalSearchTarget.fit === "number" ? (isDe ? `Warum dies ${Math.round(modalSearchTarget.fit)}% Passung ist` : `Why this is a ${Math.round(modalSearchTarget.fit)}% fit`) : (isDe ? "Warum es passt" : "Why it fits")}</span>
                  <p>{modalSearchTarget.reason}</p>
                </section>
              </div>
              <div className="toolbar-row modal-action-row">
                <button className="secondary" onClick={() => { setBrowserUrl(modalSearchTarget.url); setTargetModalKey(null); }}><Globe2 size={15} /> {isDe ? "Job öffnen" : "Open job"}</button>
                {(() => {
                  const mJob = findJobByUrlKey(data.jobPosts, modalSearchTarget.url);
                  const mApp = mJob ? data.applications.find((app) => app.jobPostId === mJob.id) : undefined;
                  const mPrepared = Boolean(mJob && data.cvVersions.some((cv) => cv.jobId === mJob.id) && data.coverLetters.some((letter) => letter.jobId === mJob.id));
                  if (mPrepared) {
                    return (
                      <button className="primary" onClick={() => { if (mApp) onSelect(mApp.id); onOpenPipeline(); setTargetModalKey(null); }}>
                        <Check size={16} /> {isDe ? "Paket fertig — öffnen" : "Package ready — open"}
                      </button>
                    );
                  }
                  return (
                    <>
                      <button className="secondary" onClick={() => run(isDe ? "Job hinzufügen" : "Adding job", () => addSearchTarget(modalSearchTarget, false))}><Plus size={16} /> {mJob ? (isDe ? "In Pipeline" : "In pipeline") : (isDe ? "Zur Pipeline" : "Add to pipeline")}</button>
                      <button className="primary" onClick={() => run(isDe ? "Job vorbereiten" : "Preparing job", () => addSearchTarget(modalSearchTarget, true))}><Sparkles size={16} /> CV + Motivation</button>
                    </>
                  );
                })()}
              </div>
              {searchPlan?.output ? (
                <details className="ai-output-details">
                  <summary>{isDe ? "Vollständige KI-Suchantwort" : "Full AI search answer"}</summary>
                  <pre>{searchPlan.output}</pre>
                </details>
              ) : null}
            </section>
          </div>
        ) : null}
      </section>
      {browserUrl ? (
        <JobBrowser
          url={browserUrl}
          profile={data.profile}
          language={data.settings.language}
          onImported={(next) => setData(next)}
          onBuildAll={buildEverythingFromExtraction}
          onClose={() => setBrowserUrl(null)}
          onAiSetupError={onAiSetupError}
          onJobsGrabbed={() => { setSearchPlanId(null); setDismissedTargetKeys([]); }}
        />
      ) : null}
    </div>
  );
}

function StartFlow({
  data,
  setData,
  run,
  onOpenJobs,
  onOpenCv,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  onOpenJobs: () => void;
  onOpenCv: () => void;
}) {
  const isDe = data.settings.language === "de";
  const [profileDraft, setProfileDraft] = useState(data.profile);
  const [cvText, setCvText] = useState("");
  const [targetRoles, setTargetRoles] = useState(data.profile.targetRoles.join(", "));
  const [searchIdea, setSearchIdea] = useState(data.profile.workPreference || "Switzerland, hybrid or remote");
  const [scanResults, setScanResults] = useState<PortalScanResult[]>([]);
  const [searchPlanId, setSearchPlanId] = useState<string | null>(null);
  const [searchQuestion, setSearchQuestion] = useState("");
  const todoApplications = data.applications.filter((application) => application.status === "watching");
  const readyApplications = data.applications.filter((application) => application.cvVersionId || data.coverLetters.some((letter) => letter.jobId === application.jobPostId));
  const searchPlan = searchPlanId ? data.aiPlans.find((plan) => plan.id === searchPlanId) : data.aiPlans.find((plan) => plan.purpose === "portal_search");
  const removedJobUrlKeys = new Set((data.settings.removedJobUrls ?? []).map(normalizeJobUrlKey).filter(Boolean));
  const aiTargets = parseAiJobTargets(searchPlan?.output, data.profile.location)
    .filter((target) => !removedJobUrlKeys.has(normalizeJobUrlKey(target.url)));
  const intakeReady = Boolean(profileDraft.fullName.trim() && profileDraft.email.trim() && (cvText.trim() || data.masterCv.sections.some((section) => section.content.trim())));
  const preferencesReady = Boolean(targetRoles.trim() && searchIdea.trim());

  useEffect(() => {
    setProfileDraft(data.profile);
    setTargetRoles(data.profile.targetRoles.join(", "));
    setSearchIdea(data.profile.workPreference || "Switzerland, hybrid or remote");
  }, [data.profile]);

  async function saveIntake() {
    const nextProfile = {
      ...profileFromImportedCvText(cvText, profileDraft),
      targetRoles: targetRoles.split(",").map((role) => role.trim()).filter(Boolean),
      workPreference: searchIdea,
    };
    await jobCentral().saveProfile(nextProfile);
    const nextCv = cvText.trim()
      ? {
        ...data.masterCv,
        sections: sectionsFromImportedCvText(cvText, data.masterCv.sections),
        updatedAt: new Date().toISOString(),
      }
      : data.masterCv;
    const next = await jobCentral().saveMasterCv(nextCv);
    setData(next);
    return next;
  }

  async function prepareApplication(application: JobApplication) {
    return prepareApplicationFromData(data, application);
  }

  async function prepareApplicationFromData(sourceData: AppData, application: JobApplication) {
    const freshData = await jobCentral().getState();
    const job = freshData.jobPosts.find((item) => item.id === application.jobPostId);
    if (!job) return sourceData;
    const previousData = data;
    setData(freshData);
    try {
      const existingCv = freshData.cvVersions.find((cv) => cv.jobId === job.id);
      const afterCv = existingCv
        ? freshData
        : await jobCentral().createCvVariant({
          jobId: job.id,
          title: `${job.company} - ${job.title}`,
          notes: "Prepared from Start flow",
          reuseExisting: true,
        });
      const createdCv = afterCv.cvVersions.find((cv) => cv.jobId === job.id);
      const existingLetter = afterCv.coverLetters.find((letter) => letter.jobId === job.id && letter.language === freshData.settings.language);
      const afterLetter = existingLetter
        ? afterCv
        : await jobCentral().generateCoverLetter({
          jobId: job.id,
          cvVersionId: createdCv?.id,
          language: freshData.settings.language,
          instructions: `Fit this to ${targetRoles || freshData.profile.headline}. ${searchIdea}. Motivation letter must be specific to ${job.company}, ${job.title}, and the shown fit reason.`,
        });
      const next = await jobCentral().updateApplication({
        applicationId: application.id,
        status: "evaluating",
        cvVersionId: afterLetter.cvVersions.find((cv) => cv.jobId === job.id)?.id ?? createdCv?.id,
        eventDetail: "CV and motivation letter prepared for review.",
      });
      setData(next);
      return next;
    } catch (error) {
      setData(previousData);
      throw error;
    }
  }

  async function addAiTarget(target: AiJobTarget, prepare: boolean) {
    const existing = findJobByUrlKey(data.jobPosts, target.url);
    const existingApplication = existing ? data.applications.find((application) => application.jobPostId === existing.id) : undefined;
    const nextData = existing && existingApplication
      ? data
      : await jobCentral().createJob({
        company: target.company || "AI target",
        title: target.title || "Target role",
        location: target.location || searchIdea,
        url: target.url,
        description: target.reason,
        fitReason: target.reason,
        score: 8,
      });
    const job = findJobByUrlKey(nextData.jobPosts, target.url) ?? existing;
    const application = job ? nextData.applications.find((item) => item.jobPostId === job.id) : undefined;
    if (application && application.status !== "watching" && !prepare) {
      const reactivated = await jobCentral().updateApplication({
        applicationId: application.id,
        status: "watching",
        eventDetail: "Moved back to todo from AI search card.",
      });
      setData(reactivated);
      return reactivated;
    }
    setData(nextData);
    if (prepare && application) return prepareApplicationFromData(nextData, application);
    return nextData;
  }

  async function askAiSearch() {
    await saveIntake();
    const next = await jobCentral().createAiPlan({
      purpose: "portal_search",
      title: `Job search: ${targetRoles || "target roles"}`,
      instructions: `${targetRoles}\n${searchIdea}\n${searchQuestion || "Find concrete fitting Swiss/remote jobs and explain why."}`,
    });
    const created = newestPlan(next.aiPlans, (item) => item.purpose === "portal_search" && item.title === `Job search: ${targetRoles || "target roles"}`);
    setSearchPlanId(created?.id ?? null);
    setData(next);
    if (!created) return next;
    const ran = await jobCentral().runAiPlan(created.id);
    setData(ran);
    return ran;
  }

  return (
    <div className="start-flow">
      <section className="flow-rail">
        <div className={`flow-step ${intakeReady ? "done" : "active"}`}><span>1</span><strong>{isDe ? "Profil + Lebenslauf" : "Profile + CV"}</strong><small>{intakeReady ? (isDe ? "Bereit" : "Ready") : (isDe ? "Vorhandenes einfügen oder hochladen" : "Paste or upload what already exists")}</small></div>
        <div className={`flow-step ${preferencesReady ? "done" : intakeReady ? "active" : ""}`}><span>2</span><strong>{isDe ? "Präferenzen" : "Preferences"}</strong><small>{preferencesReady ? (isDe ? "Suchrichtung festgelegt" : "Search direction set") : (isDe ? "Rollen, Ort, Jobidee" : "Roles, location, job idea")}</small></div>
        <div className={`flow-step ${todoApplications.length ? "done" : preferencesReady ? "active" : ""}`}><span>3</span><strong>{isDe ? "KI-Suche" : "AI search"}</strong><small>{todoApplications.length ? (isDe ? `${todoApplications.length} Jobs in Todo` : `${todoApplications.length} jobs in todo`) : (isDe ? "Jobs finden und annehmen" : "Find and accept jobs")}</small></div>
        <div className={`flow-step ${readyApplications.length ? "done" : todoApplications.length ? "active" : ""}`}><span>4</span><strong>{isDe ? "Bewerbungsloop" : "Apply loop"}</strong><small>{readyApplications.length ? (isDe ? `${readyApplications.length} Pakete vorbereitet` : `${readyApplications.length} packages prepared`) : (isDe ? "Lebenslauf, Anschreiben, Nachfassen, Angebot" : "CV, letter, follow-up, offer")}</small></div>
      </section>

      <section className="flow-main">
        <div className="flow-panel">
          <div className="flow-panel-title">
            <div>
              <h2>{isDe ? "Den ersten sauberen Lebenslauf erstellen" : "Build the first clean CV"}</h2>
              <p>{isDe ? "Mit Rohdaten beginnen. Die App hält den Master-Lebenslauf bearbeitbar und nutzt ihn für jobspezifische Versionen." : "Start with raw info. The app keeps the master CV editable and uses it for job-specific versions."}</p>
            </div>
            <button className="secondary" onClick={onOpenCv}><FileText size={17} /> {isDe ? "Lebenslauf öffnen" : "Open CV"}</button>
          </div>
          <div className="profile-field-grid">
            <input value={profileDraft.fullName} onChange={(event) => setProfileDraft({ ...profileDraft, fullName: event.target.value })} placeholder={isDe ? "Vollständiger Name" : "Full name"} />
            <input value={profileDraft.headline} onChange={(event) => setProfileDraft({ ...profileDraft, headline: event.target.value })} placeholder={isDe ? "Berufsbezeichnung" : "Headline"} />
            <input value={profileDraft.email} onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })} placeholder={isDe ? "E-Mail" : "Email"} />
            <input value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} placeholder={isDe ? "Telefon" : "Phone"} />
            <input value={profileDraft.location} onChange={(event) => setProfileDraft({ ...profileDraft, location: event.target.value })} placeholder={isDe ? "Ort" : "Location"} />
            <input value={profileDraft.website} onChange={(event) => setProfileDraft({ ...profileDraft, website: event.target.value })} placeholder="Website" />
          </div>
          <textarea
            className="cv-drop-text"
            value={cvText}
            onChange={(event) => setCvText(event.target.value)}
            placeholder={isDe ? "Vorhandenen Lebenslauf, LinkedIn-Export, Notizen oder Karriereverlauf hier einfügen." : "Paste an existing CV, LinkedIn export, notes, or raw career history here."}
          />
          <div className="toolbar-row">
            <button
              className="secondary"
              onClick={() =>
                run(isDe ? "Lebenslauf importieren" : "Importing CV", () =>
                  jobCentral().importCvDocument().then(async (result) => {
                    if (result.text) {
                      const cleanedText = normalizeImportedDocumentText(result.text);
                      const analyzedProfile = {
                        ...profileFromImportedCvText(cleanedText, profileDraft),
                        targetRoles: targetRoles.split(",").map((role) => role.trim()).filter(Boolean),
                        workPreference: searchIdea,
                      };
                      const analyzedCv = {
                        ...data.masterCv,
                        sections: sectionsFromImportedCvText(cleanedText, data.masterCv.sections),
                        updatedAt: new Date().toISOString(),
                      };
                      setCvText(cleanedText);
                      setProfileDraft(analyzedProfile);
                      await jobCentral().saveProfile(analyzedProfile);
                      const next = await jobCentral().saveMasterCv(analyzedCv);
                      setData(next);
                    }
                    return result;
                  }),
                  importCvDocumentMessage,
                )
              }
            >
              <FileText size={17} /> {isDe ? "PDF/DOCX/TXT importieren" : "Import PDF/DOCX/TXT"}
            </button>
            <button className="primary" onClick={() => run(isDe ? "Eingabe speichern" : "Saving intake", saveIntake)}><Sparkles size={18} /> {isDe ? "Master-Lebenslauf erstellen" : "Create master CV"}</button>
          </div>
        </div>

        <div className="flow-panel">
          <div className="flow-panel-title">
            <div>
              <h2>{isDe ? "Suchrichtung festlegen" : "Choose the search direction"}</h2>
              <p>{isDe ? "Zuerst festlegen, was du willst. KI plant die Suche und der Portal-Scanner füllt die Todo-Liste." : "Define what you want first. AI plans the search and the portal scanner fills the todo lane."}</p>
            </div>
          </div>
          <div className="field-grid">
            <input value={targetRoles} onChange={(event) => setTargetRoles(event.target.value)} placeholder={isDe ? "Zielrollen, kommagetrennt" : "Target roles, comma-separated"} />
            <input value={searchIdea} onChange={(event) => setSearchIdea(event.target.value)} placeholder={isDe ? "Wo, Arbeitsmodell, Gehalt, Branche" : "Where, working model, salary, industry"} />
          </div>
          <div className="toolbar-row">
            <button
              className="secondary"
              onClick={() => run(isDe ? "Suche planen" : "Planning search", askAiSearch)}
            >
              <Bot size={18} /> {isDe ? "KI-Suchplan" : "AI search plan"}
            </button>
            <button
              className="primary"
              onClick={() =>
                run(
                  isDe ? "Portale durchsuchen" : "Searching portals",
                  () => jobCentral().scanPortals().then((result) => {
                    setData(result.data);
                    setScanResults(result.results);
                    return result;
                  }),
                  scanResultMessage,
                )
              }
            >
              <RefreshCw size={18} /> {isDe ? "Jobs suchen" : "Search jobs"}
            </button>
          </div>
          <div className="ai-search-panel">
            <textarea
              value={searchQuestion}
              onChange={(event) => setSearchQuestion(event.target.value)}
              placeholder={isDe ? "KI bitten, die Suche zu verfeinern, passende Rollen zu erläutern, Branchen auszuschliessen, Fokus auf Zürich Remote, Gehalt, Deutsch/Englisch usw." : "Ask the AI to refine the search, explain why a role fits, exclude industries, focus on Zurich remote, salary, German/English, etc."}
            />
            {searchPlan ? (
              <div className="ai-search-output">
                <strong>{searchPlan.title}</strong>
                <span>{searchPlan.status} · {searchPlan.providerKey}</span>
                {searchPlan.output && aiTargets.length ? (
                  <details className="ai-raw-answer">
                    <summary>{isDe ? "KI-Begründung anzeigen" : "Show AI reasoning text"}</summary>
                    <pre>{searchPlan.output}</pre>
                  </details>
                ) : searchPlan.output ? (
                  <pre>{searchPlan.output}</pre>
                ) : (
                  <p>{isDe ? "KI-Plan bereit, aber noch keine Antwort. Ausführen oder KI-CLI in den Einstellungen erkennen/auswählen." : "AI plan is ready but has no answer yet. Run it or detect/select an AI CLI in Settings."}</p>
                )}
                <div className="toolbar-row">
                  <button
                    className="secondary"
                    onClick={() => run(isDe ? "KI-Suche ausführen" : "Running AI search", searchQuestion.trim() ? askAiSearch : () => jobCentral().runAiPlan(searchPlan.id).then((next) => (setData(next), next)))}
                  >
                    <Bot size={17} /> {searchQuestion.trim() ? (isDe ? "KI fragen" : "Ask AI") : (isDe ? "KI jetzt ausführen" : "Run AI now")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => run(isDe ? "CLIs erkennen" : "Detecting CLIs", () => jobCentral().detectAiProviders().then((next) => (setData(next), next)))}
                  >
                    <RefreshCw size={17} /> {isDe ? "KI-CLIs erkennen" : "Detect AI CLIs"}
                  </button>
                </div>
                <div className="ai-context">
                  <strong>{isDe ? "Was die KI verwendet" : "What the AI uses"}</strong>
                  <span>{targetRoles || (isDe ? "Zielrollen aus deinem Profil" : "Target roles from your profile")}</span>
                  <span>{searchIdea || (isDe ? "Schweiz-zuerst Ort und Arbeitspräferenzen" : "Swiss-first location and work preferences")}</span>
                  <span>{data.portals.filter((portal) => portal.enabled).length} {isDe ? "aktive Portale" : "enabled portals"} · {data.jobPosts.length} {isDe ? "bekannte Jobs" : "known jobs"}</span>
                </div>
                {aiTargets.length ? (
                  <div className="ai-target-grid">
                    {aiTargets.map((target) => (
                      <article className="ai-target-card" key={target.key}>
                        <div>
                          <strong>{target.company}</strong>
                          <span>{target.title}</span>
                          {target.location ? <small>{target.location}</small> : null}
                        </div>
                        <p>{target.reason}</p>
                        <a href={target.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> {isDe ? "Job öffnen" : "Open job"}</a>
                        <div className="toolbar-row">
                          <button
                            className="secondary"
                            onClick={() => run(isDe ? "KI-Ziel hinzufügen" : "Adding AI target", () => addAiTarget(target, false))}
                          >
                            <Plus size={16} /> {isDe ? "Zur Todo hinzufügen" : "Add to todo"}
                          </button>
                          <button
                            className="primary"
                            onClick={() => run(isDe ? "Paket vorbereiten" : "Preparing package", () => addAiTarget(target, true))}
                          >
                            <Sparkles size={16} /> {isDe ? "Lebenslauf + Anschreiben" : "CV + Motivation"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : searchPlan.output && searchPlan.status === "ran" ? (
                  <div className="ai-context">
                    <strong>{isDe ? "Keine Jobkarten extrahiert" : "No job cards extracted"}</strong>
                    <span>{isDe ? "KI nach konkreten Jobs mit Unternehmen, Titel, Ort und URL fragen, dann erscheinen die Karten hier." : "Ask the AI for concrete jobs with company, title, location, and URL, then cards will appear here."}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="ai-search-output muted">
                <strong>{isDe ? "Noch kein KI-Suchergebnis" : "No AI search result yet"}</strong>
                <span>{isDe ? "KI-Suchplan ausführen, um die Begründung hier zu sehen." : "Run AI search plan to see transparent reasoning here."}</span>
              </div>
            )}
          </div>
          {scanResults.length ? (
            <div className="scan-summary">
              {scanResults.map((result) => (
                <div key={result.portalId}>
                  <strong>{result.portalName}</strong>
                  <span>{result.scanned} {isDe ? "gescannt" : "scanned"} · {result.added} {isDe ? "hinzugefügt" : "added"} · {result.skipped} {isDe ? "übersprungen" : "skipped"}</span>
                  {result.errors[0] ? <small>{result.errors[0]}</small> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <aside className="flow-next">
        <div className="flow-panel">
          <h2>{isDe ? "Bewerbungswarteschlange" : "Application queue"}</h2>
          {todoApplications.length ? (
            <>
              <button
                className="secondary wide"
                onClick={() =>
                  run(isDe ? "Todo leeren" : "Clearing todo", () => jobCentral().clearWatchlist().then((next) => (setData(next), next)))
                }
              >
                <Trash2 size={16} /> {isDe ? "Todo leeren und neu suchen" : "Clear todo and search again"}
              </button>
              <div className="queue-list">
                {todoApplications.slice(0, 5).map((application) => {
                  const job = data.jobPosts.find((item) => item.id === application.jobPostId);
                  return (
                    <div className="queue-card" key={application.id}>
                      <strong>{job?.company ?? (isDe ? "Unbekannt" : "Unknown")}</strong>
                      <span>{job?.title}</span>
                      <small>{job?.location}</small>
                      {job?.fitReason ? <p>{job.fitReason}</p> : null}
                      {job?.url ? <a href={job.url} target="_blank" rel="noreferrer">{isDe ? "Job öffnen" : "Open job"}</a> : null}
                      <button className="primary wide" onClick={() => run(isDe ? "Paket vorbereiten" : "Preparing package", () => prepareApplication(application))}>
                        <Sparkles size={18} /> {isDe ? "Lebenslauf + Motivationsschreiben vorbereiten" : "Prepare CV + motivation letter"}
                      </button>
                      <button
                        className="secondary wide"
                        onClick={() =>
                          run(isDe ? "Job ablehnen" : "Rejecting job", () =>
                            jobCentral()
                              .updateApplication({ applicationId: application.id, status: "rejected", eventDetail: "Rejected from Start flow." })
                              .then((next) => (setData(next), next)),
                          )
                        }
                      >
                        <Trash2 size={16} /> {isDe ? "Ablehnen" : "Reject"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button className="secondary wide" onClick={onOpenJobs}><ClipboardList size={18} /> {isDe ? "Todo-Liste überprüfen" : "Review todo list"}</button>
            </>
          ) : (
            <>
              <p>{isDe ? "Noch keine Jobs in der Todo. Portale hinzufügen oder Suche starten, dann die Jobs annehmen, auf die es sich zu bewerben lohnt." : "No jobs in todo yet. Add portals or run a search, then accept the jobs worth applying to."}</p>
              <button className="secondary wide" onClick={onOpenJobs}><ClipboardList size={18} /> {isDe ? "Tracker öffnen" : "Open tracker"}</button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// Side-by-side compare/merge between the master CV and a tailored variant. Lets the
// user pull individual sections or entries from master into the variant, push them the
// other way onto master (guarded by a confirm — it changes the master), or promote the
// whole variant to become the new master. Parts are matched by their stable section /
// entry ids (a variant created from master shares them), so a swap replaces the matching
// part in place; a part that exists on only one side is offered as an add.
// "Add from your history" picker: surfaces the user's full role/project pool (cvProjects,
// the same list the onboarding wizard curates) inside the main editor so a relevant past
// role can be pulled into the CV being edited — master OR a tailored variant. Whether an
// item is already in the CV is read from the CV's experience/projects section TEXT, so it
// works identically for master and variants (variants have no per-item inclusion flag).
function CvHistoryPicker({
  data,
  setData,
  run,
  cvId,
  filterKind,
  isDe,
  onClose,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  cvId: string;
  filterKind?: "experience" | "projects";
  isDe: boolean;
  onClose: () => void;
}) {
  // A pool item is a "role" when it has both a role title and an organisation (mirrors the
  // backend's projectIsRole) — roles feed the Experience section, the rest feed Projects.
  const isRole = (project: CvProject) => Boolean(project.role?.trim() && project.organisation?.trim());
  const pool = (data.cvProjects ?? [])
    .filter((project) => !filterKind || (filterKind === "experience" ? isRole(project) : !isRole(project)))
    .slice()
    .sort((a, b) => a.order - b.order);
  const targetCv = cvId === "master" ? data.masterCv : data.cvVersions.find((cv) => cv.id === cvId);
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9äöü]+/gi, " ").trim();
  // Presence is checked PER ENTRY (org AND role must appear in the SAME entry), not as
  // independent substrings across the whole CV text — otherwise a "Google PM" entry plus a
  // "Microsoft Engineer" entry would wrongly flag an unrelated "Google Engineer" as present.
  const entryTexts = (targetCv?.sections ?? [])
    .filter((section) => section.kind === "experience" || section.kind === "projects")
    .flatMap((section) => cvEntriesForSection(section).map((entry) => norm([entry.title, entry.subtitle, entry.meta, entry.body].filter(Boolean).join(" "))));
  const isPresent = (project: CvProject) => {
    const org = norm(project.organisation || "");
    const role = norm(project.role || project.title || "");
    if (!org && !role) return false;
    return entryTexts.some((text) => (org ? text.includes(org) : true) && (role ? text.includes(role) : true));
  };
  const addable = pool.filter((project) => !isPresent(project));
  const cvTitle = cvId === "master" ? (isDe ? "Master-CV" : "Master CV") : (targetCv?.title ?? "");

  const add = (projectIds: string[]) => {
    if (!projectIds.length) return;
    void run(isDe ? "Hinzufügen" : "Adding", async () => {
      const next = await jobCentral().addHistoryItems({ cvId, projectIds });
      setData(next);
      return next;
    });
  };

  return (
    <div className="modal-backdrop cv-history-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="cv-history-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="cv-history-head">
          <div>
            <span><Plus size={15} /> {filterKind === "projects" ? (isDe ? "Projekte aus deinem Werdegang" : "Projects from your history") : filterKind === "experience" ? (isDe ? "Rollen aus deinem Werdegang" : "Roles from your history") : (isDe ? "Aus deinem Werdegang" : "From your history")}</span>
            <h2>{cvTitle}</h2>
            <p>{isDe
              ? `Frühere ${filterKind === "projects" ? "Projekte" : filterKind === "experience" ? "Rollen" : "Rollen und Projekte"}, die du auf Lager hast. Hol relevante in dieses CV — auch wenn sie nicht im Master sind.`
              : `Past ${filterKind === "projects" ? "projects" : filterKind === "experience" ? "roles" : "roles and projects"} you have on file. Pull the relevant ones into this CV — even ones that aren't in your master.`}</p>
          </div>
          <div className="cv-history-head-actions">
            <button className="primary" disabled={!addable.length} onClick={() => add(addable.map((project) => project.id))} title={isDe ? "Alle noch nicht enthaltenen hinzufügen" : "Add everything not already in this CV"}>
              <Plus size={15} /> {isDe ? `Alle (${addable.length})` : `Add all (${addable.length})`}
            </button>
            <button className="row-icon-button" onClick={onClose} title={isDe ? "Schließen" : "Close"}><X size={16} /></button>
          </div>
        </header>
        <div className="cv-history-body">
          {pool.length === 0 ? (
            <div className="cv-history-empty">{isDe ? "Noch nichts in deinem Werdegang." : "Nothing in your history yet."}</div>
          ) : (
            pool.map((project) => {
              const present = isPresent(project);
              const cited = Boolean(project.sourceQuote?.trim() && project.sourceDocId);
              return (
                <div className={`cv-history-row ${present ? "present" : ""}`} key={project.id}>
                  <div className="cv-history-row-text">
                    <strong>{[project.role || project.title, project.organisation].filter(Boolean).join(" — ") || project.title}</strong>
                    {project.summary ? <span>{project.summary}</span> : null}
                    {cited
                      ? <em className="cvw-cited"><ShieldCheck size={12} /> {isDe ? "belegt" : "cited"}</em>
                      : <em className="cvw-unsourced"><ShieldAlert size={12} /> {isDe ? "unbelegt — prüfen" : "unsourced — check"}</em>}
                  </div>
                  {present ? (
                    <span className="cv-history-present"><Check size={14} /> {isDe ? "im CV" : "in CV"}</span>
                  ) : (
                    <button className="secondary small" onClick={() => add([project.id])}>
                      <Plus size={14} /> {isDe ? "Hinzufügen" : "Add"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function CvCompareView({
  data,
  setData,
  run,
  versionId,
  isDe,
  onClose,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  versionId: string;
  isDe: boolean;
  onClose: () => void;
}) {
  const master = data.masterCv;
  const version = data.cvVersions.find((cv) => cv.id === versionId);
  // Accordion: one section open at a time so you can focus on it; the rest collapse to a
  // header bar. Defaults to the first section open. (Hook stays before the early return.)
  const [openSection, setOpenSection] = useState<string>(() => data.masterCv.sections[0]?.id ?? "");
  if (!version) return null;
  const toggleSection = (sectionId: string) => setOpenSection((current) => (current === sectionId ? "" : sectionId));

  const apply = (label: string, task: () => Promise<AppData>) =>
    void run(label, async () => {
      const next = await task();
      setData(next);
      return next;
    });
  const copyPart = (input: { targetCvId: string; sourceCvId: string; sectionId: string; entryId?: string; targetEntryId?: string }, label: string) =>
    apply(label, () => jobCentral().copyCvPart(input));
  const removePart = (input: { cvId: string; sectionId: string; entryId?: string }, label: string) =>
    apply(label, () => jobCentral().removeCvPart(input));

  // ── Whole-section moves ──
  const useMasterSection = (sectionId: string) =>
    copyPart({ targetCvId: versionId, sourceCvId: "master", sectionId }, isDe ? "Master-Abschnitt übernehmen" : "Using master section");
  const pushSectionToMaster = (sectionId: string) => {
    if (!confirmDestructive(isDe ? "Diesen Abschnitt im Master-CV überschreiben/hinzufügen? Das ändert deinen Master." : "Overwrite/add this section on your master CV? This changes your master.")) return;
    copyPart({ targetCvId: "master", sourceCvId: versionId, sectionId }, isDe ? "Abschnitt in Master schreiben" : "Pushing section to master");
  };
  const removeSection = (cvId: string, sectionId: string, fromMaster: boolean) => {
    if (!confirmDestructive(fromMaster
      ? (isDe ? "Diesen Abschnitt aus dem Master-CV löschen? Das ändert deinen Master." : "Delete this section from your master CV? This changes your master.")
      : (isDe ? "Diesen Abschnitt aus diesem CV löschen?" : "Delete this section from this CV?"))) return;
    removePart({ cvId, sectionId }, isDe ? "Abschnitt löschen" : "Removing section");
  };

  // ── Per-entry moves. Matched rows REPLACE in place (targetEntryId); one-sided rows ADD
  //    across (no targetEntryId → append) or REMOVE. Anything that writes/deletes on the
  //    master is confirmed. ──
  const replaceVariantEntry = (sectionId: string, masterEntryId: string, variantEntryId: string) =>
    copyPart({ targetCvId: versionId, sourceCvId: "master", sectionId, entryId: masterEntryId, targetEntryId: variantEntryId }, isDe ? "Master-Eintrag übernehmen" : "Using master entry");
  const replaceMasterEntry = (sectionId: string, variantEntryId: string, masterEntryId: string) => {
    if (!confirmDestructive(isDe ? "Diesen Eintrag im Master-CV überschreiben? Das ändert deinen Master." : "Overwrite this entry on your master CV? This changes your master.")) return;
    copyPart({ targetCvId: "master", sourceCvId: versionId, sectionId, entryId: variantEntryId, targetEntryId: masterEntryId }, isDe ? "Eintrag in Master schreiben" : "Pushing entry to master");
  };
  const addEntryToVariant = (sectionId: string, masterEntryId: string) =>
    copyPart({ targetCvId: versionId, sourceCvId: "master", sectionId, entryId: masterEntryId }, isDe ? "Eintrag hinzufügen" : "Adding entry");
  const addEntryToMaster = (sectionId: string, variantEntryId: string) => {
    if (!confirmDestructive(isDe ? "Diesen Eintrag zum Master-CV hinzufügen? Das ändert deinen Master." : "Add this entry to your master CV? This changes your master.")) return;
    copyPart({ targetCvId: "master", sourceCvId: versionId, sectionId, entryId: variantEntryId }, isDe ? "Eintrag in Master schreiben" : "Adding entry to master");
  };
  const removeEntry = (cvId: string, sectionId: string, entryId: string, fromMaster: boolean) => {
    if (!confirmDestructive(fromMaster
      ? (isDe ? "Diesen Eintrag aus dem Master-CV löschen? Das ändert deinen Master." : "Delete this entry from your master CV? This changes your master.")
      : (isDe ? "Diesen Eintrag aus diesem CV löschen?" : "Delete this entry from this CV?"))) return;
    removePart({ cvId, sectionId, entryId }, isDe ? "Eintrag löschen" : "Removing entry");
  };

  // Pair the SAME job across both CVs by content (org + dates), not by id — after AI
  // tailoring the variant's entry ids no longer line up with the master's, and pairing by
  // position would sit unrelated jobs side by side. Greedy: each master entry takes the
  // first still-unused variant entry with a matching key; leftovers on either side become
  // one-sided rows. Worst case (a reworded date) shows a job as two one-sided rows — it
  // never pairs two DIFFERENT jobs.
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9äöü]+/gi, " ").trim();
  const entryKey = (entry: CvEntryDraft) => {
    const title = norm(entry.title);
    const dates = norm(entry.meta);
    const sub = norm(entry.subtitle);
    return [title, dates].filter(Boolean).join("|") || [title, sub].filter(Boolean).join("|") || norm(entry.body).slice(0, 48) || entry.id;
  };
  const buildRows = (mEntries: CvEntryDraft[], vEntries: CvEntryDraft[]) => {
    const rows: Array<{ master?: CvEntryDraft; variant?: CvEntryDraft }> = [];
    const usedV = new Set<number>();
    for (const me of mEntries) {
      const key = entryKey(me);
      const vi = vEntries.findIndex((ve, index) => !usedV.has(index) && entryKey(ve) === key);
      if (vi >= 0) { usedV.add(vi); rows.push({ master: me, variant: vEntries[vi] }); }
      else rows.push({ master: me });
    }
    vEntries.forEach((ve, index) => { if (!usedV.has(index)) rows.push({ variant: ve }); });
    return rows;
  };
  const promote = () => {
    if (!confirmDestructive(isDe
      ? `"${version.title}" zum neuen Master-CV machen? Das überschreibt dein aktuelles Master-CV (Inhalt, Vorlage, Design).`
      : `Make "${version.title}" your new master CV? This overwrites your current master CV (content, template, style).`)) return;
    void run(isDe ? "Als Master übernehmen" : "Promoting to master", async () => {
      const next = await jobCentral().promoteCvToMaster({ cvVersionId: versionId });
      setData(next);
      onClose();
      return next;
    });
  };

  // Union of section ids: master order first, then any version-only sections.
  const sectionIds: string[] = [];
  for (const section of master.sections) sectionIds.push(section.id);
  for (const section of version.sections) if (!sectionIds.includes(section.id)) sectionIds.push(section.id);

  const entryPreview = (entry: CvEntryDraft) => (
    <div className="cv-compare-entry-preview">
      <strong>{entry.title || (isDe ? "(ohne Titel)" : "(untitled)")}</strong>
      {entry.subtitle || entry.meta ? <span className="cv-compare-entry-sub">{[entry.subtitle, entry.meta].filter(Boolean).join(" · ")}</span> : null}
      {entry.body ? <p>{entry.body}</p> : null}
    </div>
  );

  return (
    <div className="modal-backdrop cv-compare-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="cv-compare-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="cv-compare-head">
          <div>
            <span><Columns size={15} /> {isDe ? "Vergleichen & zusammenführen" : "Compare & merge"}</span>
            <h2>{version.title}</h2>
            <p>{isDe
              ? "Master-CV links, dieses CV rechts. Gleiche Stelle steht in einer Zeile: → ersetzt rechts mit dem Master, ← schreibt in den Master. Steht etwas nur auf einer Seite, ist die andere leer — hinzufügen oder entfernen. Alles Richtung Master wird bestätigt."
              : "Master CV on the left, this tailored CV on the right. The same job lines up in one row: → replaces the right with master’s, ← writes onto master. When something is on one side only, the other is empty — add it across or remove it. Anything onto master is confirmed."}</p>
          </div>
          <div className="cv-compare-head-actions">
            <button className="primary" onClick={promote} title={isDe ? "Dieses ganze CV zum Master machen" : "Make this whole CV the master"}>
              <Star size={15} /> {isDe ? "Als Master übernehmen" : "Promote to master"}
            </button>
            <button className="row-icon-button" onClick={onClose} title={isDe ? "Schließen" : "Close"}><X size={16} /></button>
          </div>
        </header>
        <div className="cv-compare-colhead">
          <span>{isDe ? "Master-CV" : "Master CV"}</span>
          <span />
          <span>{version.title}</span>
        </div>
        <div className="cv-compare-body">
          {sectionIds.map((sectionId) => {
            const m = master.sections.find((section) => section.id === sectionId);
            const v = version.sections.find((section) => section.id === sectionId);
            const title = (m ?? v)?.title ?? "";
            const onlyMaster = Boolean(m) && !v;
            const onlyVariant = !m && Boolean(v);
            const mEntries = m ? cvEntriesForSection(m) : [];
            const vEntries = v ? cvEntriesForSection(v) : [];
            const rows = buildRows(mEntries, vEntries);
            const isOpen = openSection === sectionId;
            // How many rows still differ between the two CVs (one-sided, or matched but
            // with different text) — a hint of what's left to reconcile while collapsed.
            const differing = rows.filter((row) => !row.master || !row.variant
              || `${row.master.title}${row.master.subtitle}${row.master.meta}${row.master.body}` !== `${row.variant.title}${row.variant.subtitle}${row.variant.meta}${row.variant.body}`).length;
            return (
              <div className="cv-compare-section" key={sectionId}>
                <div className="cv-compare-section-head">
                  <button type="button" className="cv-compare-section-toggle" onClick={() => toggleSection(sectionId)} aria-expanded={isOpen}>
                    <ChevronDown size={16} style={{ transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s", flexShrink: 0 }} />
                    <strong>{title}{onlyMaster ? ` ${isDe ? "(nur Master)" : "(master only)"}` : onlyVariant ? ` ${isDe ? "(nur dieses CV)" : "(this CV only)"}` : ""}</strong>
                    {differing > 0 ? <span className="cv-compare-section-count" title={isDe ? "Einträge, die sich unterscheiden" : "rows that differ"}>{differing}</span> : null}
                  </button>
                  <div className="cv-compare-section-actions">
                    {m && v ? (
                      <>
                        <button className="secondary small" onClick={() => useMasterSection(sectionId)} title={isDe ? "Ganzen Abschnitt aus dem Master übernehmen" : "Use the whole master section here"}>
                          <ArrowRight size={13} /> {isDe ? "Abschnitt aus Master" : "Section from master"}
                        </button>
                        <button className="secondary small danger" onClick={() => pushSectionToMaster(sectionId)} title={isDe ? "Ganzen Abschnitt in den Master schreiben" : "Write the whole section onto master"}>
                          <ArrowLeft size={13} /> {isDe ? "Abschnitt in Master" : "Section to master"}
                        </button>
                      </>
                    ) : onlyMaster ? (
                      <>
                        <button className="secondary small" onClick={() => useMasterSection(sectionId)} title={isDe ? "Diesen Abschnitt zu diesem CV hinzufügen" : "Add this section to this CV"}>
                          <ArrowRight size={13} /> {isDe ? "Zu diesem CV" : "Add to this CV"}
                        </button>
                        <button className="secondary small danger" onClick={() => removeSection("master", sectionId, true)} title={isDe ? "Abschnitt aus dem Master löschen" : "Remove this section from master"}>
                          <Trash2 size={13} /> {isDe ? "Aus Master entfernen" : "Remove from master"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="secondary small danger" onClick={() => pushSectionToMaster(sectionId)} title={isDe ? "Diesen Abschnitt zum Master hinzufügen" : "Add this section to master"}>
                          <ArrowLeft size={13} /> {isDe ? "Zum Master" : "Add to master"}
                        </button>
                        <button className="secondary small" onClick={() => removeSection(versionId, sectionId, false)} title={isDe ? "Abschnitt aus diesem CV löschen" : "Remove this section from this CV"}>
                          <Trash2 size={13} /> {isDe ? "Aus diesem CV" : "Remove from this CV"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isOpen ? rows.map((row, index) => {
                  const me = row.master;
                  const ve = row.variant;
                  return (
                    <div className="cv-compare-entry-row" key={me?.id ?? ve?.id ?? index}>
                      <div className="cv-compare-cell">{me ? entryPreview(me) : <span className="cv-compare-empty">—</span>}</div>
                      <div className="cv-compare-entry-actions">
                        {me && ve ? (
                          // Matched job: replace in place, either direction.
                          <>
                            <button className="row-icon-button" title={isDe ? "Diesen Master-Eintrag hier übernehmen" : "Use this master entry here"} onClick={() => replaceVariantEntry(sectionId, me.id, ve.id)}>
                              <ArrowRight size={15} />
                            </button>
                            <button className="row-icon-button danger" title={isDe ? "Diesen Eintrag in den Master schreiben" : "Push this entry to master"} onClick={() => replaceMasterEntry(sectionId, ve.id, me.id)}>
                              <ArrowLeft size={15} />
                            </button>
                          </>
                        ) : me ? (
                          // Only on master: add it across to the variant, or delete from master.
                          <>
                            <button className="row-icon-button" title={isDe ? "Diesen Eintrag zu diesem CV hinzufügen" : "Add this entry to this CV"} onClick={() => addEntryToVariant(sectionId, me.id)}>
                              <ArrowRight size={15} />
                            </button>
                            <button className="row-icon-button danger" title={isDe ? "Eintrag aus dem Master löschen" : "Remove from master"} onClick={() => removeEntry("master", sectionId, me.id, true)}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : ve ? (
                          // Only on this CV: add it across to master, or delete from this CV.
                          <>
                            <button className="row-icon-button danger" title={isDe ? "Diesen Eintrag zum Master hinzufügen" : "Add this entry to master"} onClick={() => addEntryToMaster(sectionId, ve.id)}>
                              <ArrowLeft size={15} />
                            </button>
                            <button className="row-icon-button" title={isDe ? "Eintrag aus diesem CV löschen" : "Remove from this CV"} onClick={() => removeEntry(versionId, sectionId, ve.id, false)}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : null}
                      </div>
                      <div className="cv-compare-cell">{ve ? entryPreview(ve) : <span className="cv-compare-empty">—</span>}</div>
                    </div>
                  );
                }) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CvStudio({
  data,
  setData,
  run,
  onOpenJobStudio,
  initialCvId,
  onCvOpened,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  onOpenJobStudio: () => void;
  initialCvId?: string | null;
  onCvOpened?: () => void;
}) {
  const isDe = data.settings.language === "de";
  const [draft, setDraft] = useState<CvDocument>({ ...data.masterCv, sections: hydrateCvSections(data.masterCv.sections) });
  const [profileDraft, setProfileDraft] = useState<Profile>(data.profile);
  const [variantTitle, setVariantTitle] = useState("Targeted CV");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [mode, setMode] = useState<"overview" | "content" | "customize" | "ai">("content");
  const [selectedSectionId, setSelectedSectionId] = useState(data.masterCv.sections[0]?.id ?? "");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(null);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [aiInstructions, setAiInstructions] = useState("");
  const [cvReview, setCvReview] = useState<CvReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [cvCoachMessage, setCvCoachMessage] = useState("");
  const [coachBusy, setCoachBusy] = useState(false);
  const [aiSubTab, setAiSubTab] = useState<"berater" | "coach" | "check" | "zeugnisse">("coach");
  const [careerMessage, setCareerMessage] = useState("");
  const [careerBusy, setCareerBusy] = useState(false);
  const [zeugnisseDocs, setZeugnisseDocs] = useState<Array<{ name: string; words: number }>>([]);
  const [zeugnisseText, setZeugnisseText] = useState("");
  const [zeugnisseMode, setZeugnisseMode] = useState<"curate" | "trim">("curate");
  const [zeugnisseBusy, setZeugnisseBusy] = useState<"import" | "build" | null>(null);
  const [entryTip, setEntryTip] = useState("");
  const [showHeaderEditor, setShowHeaderEditor] = useState(false);
  const [showAddContent, setShowAddContent] = useState(false);
  const [importReview, setImportReview] = useState<CvImportAnalysis | null>(null);
  const [importingCv, setImportingCv] = useState(false);
  const [cvUndoSnapshot, setCvUndoSnapshot] = useState<{ label: string; profile: Profile; cv: CvDocument } | null>(null);
  const [systemFonts, setSystemFonts] = useState<string[]>(fontPresets);
  const [previewCvId, setPreviewCvId] = useState("master");
  // Per-variant professional title being edited. For a variant the header title box
  // edits THIS (custom, saved onto the variant), not the global profile.headline; for
  // the master it is unused (the master uses profileDraft.headline). Synced on CV switch.
  const [variantHeadline, setVariantHeadline] = useState("");
  // Opens the master ↔ tailored compare/merge overlay for the selected variant.
  const [compareOpen, setCompareOpen] = useState(false);
  // Opens the "add from your history" picker (pull roles/projects from the cvProjects
  // pool) — scoped to the section it was opened from (experience → roles, projects → projects).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKind, setHistoryKind] = useState<"experience" | "projects">("experience");
  // Which language of the MASTER CV the editor is showing. The master's other-language
  // sibling lives in masterCvTranslation; versions' siblings are separate cvVersions.
  const [editLang, setEditLang] = useState<"en" | "de">(data.masterCv.language);
  const [cvProposalEdits, setCvProposalEdits] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState<boolean>(() => localStorage.getItem("cvShowPreview") !== "0");
  // When the Library asks to edit a specific CV, jump straight into its editor.
  useEffect(() => {
    if (!initialCvId) return;
    setPreviewCvId(initialCvId);
    setMode("content");
    onCvOpened?.();
  }, [initialCvId, onCvOpened]);
  useEffect(() => {
    localStorage.setItem("cvShowPreview", showPreview ? "1" : "0");
  }, [showPreview]);
  const previewRef = useRef<HTMLElement>(null);
  const coachLogRef = useRef<HTMLDivElement>(null);
  const careerLogRef = useRef<HTMLDivElement>(null);
  const cvCoachConversation = data.aiConversations.find((conversation) => conversation.cvId === previewCvId);
  const careerConversation = data.aiConversations.find((conversation) => conversation.cvId === "__career_advisor__");
  const latestCareerPlanId = [...(careerConversation?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.aiPlanId)?.aiPlanId;
  const latestCareerPlan = latestCareerPlanId
    ? data.aiPlans.find((plan) => plan.id === latestCareerPlanId && plan.purpose === "career_advice" && plan.status === "ran" && plan.output)
    : undefined;
  const latestCareerAdvice = parseCareerAdviceOutput(latestCareerPlan?.output);
  // Keep the newest coach message in view so the answer isn't stranded above the fold.
  useEffect(() => {
    const el = coachLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cvCoachConversation?.messages.length, coachBusy]);
  useEffect(() => {
    const el = careerLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [careerConversation?.messages.length, careerBusy]);
  async function sendCvCoachMessage(text?: string) {
    const message = (text ?? cvCoachMessage).trim();
    if (!message || coachBusy) return;
    setCoachBusy(true);
    setCvCoachMessage("");
    try {
      const next = await jobCentral().sendCvAiMessage({ cvId: previewCvId, message });
      setData(next);
    } finally {
      setCoachBusy(false);
    }
  }
  async function clearCvCoach() {
    if (coachBusy || !cvCoachConversation?.messages.length) return;
    setData(await jobCentral().clearCvChat(previewCvId));
  }
  async function sendCareerAdvisorMessage(text?: string) {
    const message = (text ?? careerMessage).trim();
    if (!message || careerBusy) return;
    setCareerBusy(true);
    setCareerMessage("");
    try {
      const next = await jobCentral().sendCareerAdvisorMessage({ message });
      setData(next);
    } finally {
      setCareerBusy(false);
    }
  }
  async function applyCareerSearch(search?: Partial<SearchPreferences>, direction?: CareerAdviceDirection) {
    const toList = (incoming: unknown): string[] => {
      if (Array.isArray(incoming)) return incoming.map((item) => String(item).trim()).filter(Boolean);
      if (typeof incoming === "string") return [incoming.trim()].filter(Boolean);
      return [];
    };
    const mergeList = (current: string[], incoming: unknown) => [...new Set([...current, ...toList(incoming)])];
    const nextSearch: SearchPreferences = {
      ...data.settings.search,
      targetRoles: mergeList(data.settings.search.targetRoles, search?.targetRoles ?? (direction?.title ? [direction.title] : [])),
      locations: mergeList(data.settings.search.locations, search?.locations),
      positiveKeywords: mergeList(data.settings.search.positiveKeywords, [...toList(search?.positiveKeywords), ...toList(direction?.keywords)]),
      negativeKeywords: mergeList(data.settings.search.negativeKeywords, search?.negativeKeywords),
      targetCompanies: mergeList(data.settings.search.targetCompanies, [...toList(search?.targetCompanies), ...toList(direction?.companies)]),
      excludedCompanies: data.settings.search.excludedCompanies,
    };
    const next = await jobCentral().updateSearchPreferences(nextSearch);
    setData(next);
    return next;
  }
  // Fit-to-width by default so the A4 paper never gets clipped by a narrow panel.
  const [fitMode, setFitMode] = useState(true);
  const [fitZoom, setFitZoom] = useState(1);
  const [manualZoom, setManualZoom] = useState(1);
  const previewZoom = fitMode ? fitZoom : manualZoom;
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const compute = () => {
      const available = el.clientWidth - 28; // account for padding/scrollbar
      setFitZoom(Math.min(1, Math.max(0.35, Math.round((available / PAPER_WIDTH) * 100) / 100)));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const adjustZoom = (delta: number) => {
    setManualZoom(Math.min(1.2, Math.max(0.35, Math.round((previewZoom + delta) * 100) / 100)));
    setFitMode(false);
  };
  // User-resizable split: drag the divider to dictate the preview width yourself.
  const [previewWidth, setPreviewWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem("cvPreviewWidth"));
    return stored >= 320 && stored <= 1100 ? stored : 460;
  });
  useEffect(() => {
    localStorage.setItem("cvPreviewWidth", String(previewWidth));
  }, [previewWidth]);
  function startPreviewResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = previewWidth;
    const onMove = (moveEvent: MouseEvent) => {
      // Dragging left widens the preview, right narrows it.
      const delta = startX - moveEvent.clientX;
      setPreviewWidth(Math.min(1100, Math.max(320, startWidth + delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
  const selectedJob = data.jobPosts.find((job) => job.id === selectedJobId);
  const selectedStoredCv = previewCvId === "master" ? undefined : data.cvVersions.find((cv) => cv.id === previewCvId);
  const masterOtherLang: "en" | "de" = data.masterCv.language === "de" ? "en" : "de";
  const showingMasterTranslation = previewCvId === "master" && editLang !== data.masterCv.language && data.masterCvTranslation?.language === editLang;
  // The translation is stale when the primary master was edited after it was translated.
  const masterTranslationStale = Boolean(
    showingMasterTranslation &&
    data.masterCvTranslation?.translationSourceUpdatedAt &&
    data.masterCv.updatedAt > data.masterCvTranslation.translationSourceUpdatedAt,
  );
  // Toggle the master between languages; generate the sibling on demand if missing.
  // Apply a language DETERMINISTICALLY — set the toggle AND the preview draft together,
  // from the given data — so the preview never lags a render behind the toggle (the
  // effect below recomputes the same src, but doing it here closes the render-timing
  // window where EN is active while the German master is still on screen).
  async function switchMasterLang(lang: "en" | "de") {
    const applyLang = (source: AppData) => {
      const sibling = source.masterCvTranslation;
      const showTr = lang !== source.masterCv.language && sibling?.language === lang;
      const src = showTr && sibling ? sibling : source.masterCv;
      setEditLang(lang);
      setDraft({ ...src, sections: hydrateCvSections(src.sections) });
    };
    if (lang === data.masterCv.language || data.masterCvTranslation?.language === lang) {
      applyLang(data);
      return;
    }
    const tr = await run("Translating CV", async () => {
      const result = await jobCentral().translateCv({ cvId: "master", targetLang: lang });
      setData(result.data);
      return result;
    }, (result) => result.summary);
    // Only flip once a sibling in the target language actually exists; otherwise the
    // editor would show the primary-language text under the other label (e.g. when no
    // AI engine is detected or the translation failed to parse).
    if (tr && tr.data.masterCvTranslation?.language === lang) applyLang(tr.data);
  }
  async function retranslateMaster() {
    await run("Updating translation", async () => {
      const result = await jobCentral().translateCv({ cvId: "master", targetLang: editLang });
      setData(result.data);
      return result;
    }, (result) => result.summary);
  }
  const cvProposalTargetId = previewCvId === "master" ? data.masterCv.id : previewCvId;
  const cvProposals = data.aiProposals.filter((proposal) => proposal.type === "cv_section" && proposal.cvVersionId === cvProposalTargetId);
  const activeSection = draft.sections.find((section) => section.id === selectedSectionId) ?? draft.sections[0];
  const selectedSection = showHeaderEditor ? undefined : activeSection;
  const selectedEntries = selectedSection ? cvEntriesForSection(selectedSection) : [];
  const selectedEntry = selectedEntries.find((entry) => entry.id === selectedEntryId) ?? selectedEntries[0];
  const labels = uiText[data.settings.language];

  // Reset the language toggle to the master's primary language when switching CVs.
  useEffect(() => { setEditLang(data.masterCv.language); }, [previewCvId, data.masterCv.language]);
  useEffect(() => {
    if (previewCvId === "master") {
      // Show the translation sidecar when the toggle points at the other language and it exists.
      const showTranslation = editLang !== data.masterCv.language && data.masterCvTranslation?.language === editLang;
      const src = showTranslation && data.masterCvTranslation ? data.masterCvTranslation : data.masterCv;
      setDraft({ ...src, sections: hydrateCvSections(src.sections) });
      setVariantHeadline("");
      return;
    }
    const cv = data.cvVersions.find((item) => item.id === previewCvId);
    if (!cv) return;
    setDraft({
      id: cv.id,
      title: cv.title,
      language: data.masterCv.language,
      template: cv.template,
      style: cv.style,
      sections: hydrateCvSections(cv.sections),
      updatedAt: cv.createdAt,
    });
    setVariantHeadline(cv.headline ?? "");
  }, [data.masterCv, data.masterCvTranslation, data.cvVersions, previewCvId, editLang]);
  // Keep the KI-Tools "Target job" in step with the CV shown in the header: the master
  // has no target (AI refines the master), a job-variant targets its own job.
  useEffect(() => {
    if (previewCvId === "master") {
      setSelectedJobId("");
      return;
    }
    const cv = data.cvVersions.find((item) => item.id === previewCvId);
    setSelectedJobId(cv?.jobId ?? "");
  }, [previewCvId, data.cvVersions]);
  useEffect(() => setProfileDraft(data.profile), [data.profile]);
  useEffect(() => {
    void jobCentral()
      .listSystemFonts()
      .then((fonts) => setSystemFonts(Array.from(new Set([...fontPresets, ...fonts]))))
      .catch(() => setSystemFonts(fontPresets));
  }, []);
  useEffect(() => {
    const entries = selectedSection ? cvEntriesForSection(selectedSection) : [];
    if (!entries.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(entries[0]?.id ?? null);
    }
  }, [selectedSection?.id, selectedSection?.content, selectedEntryId]);

  function updateSelectedEntry(patch: Partial<CvEntryDraft>) {
    if (!selectedSection || !selectedEntry) return;
    setDraft({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === selectedSection.id ? updateCvEntry(section, selectedEntry.id, patch) : section,
      ),
    });
  }

  function addEntry() {
    if (!selectedSection) return;
    const next = addCvEntry(selectedSection);
    setDraft({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === selectedSection.id ? next.section : section,
      ),
    });
    setSelectedEntryId(next.entry.id);
  }

  function addSectionFromTemplate(kind: CvSection["kind"], title: string) {
    const existing = draft.sections.find((section) => section.kind === kind && section.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      const next = addCvEntry(existing);
      setDraft({
        ...draft,
        sections: draft.sections.map((section) =>
          section.id === existing.id ? setCvSectionVisibility(next.section, true) : section,
        ),
      });
      setSelectedSectionId(existing.id);
      setSelectedEntryId(next.entry.id);
      setShowAddContent(false);
      return;
    }

    const section: CvSection = {
      id: `section_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      kind,
      content: "",
      enabled: true,
    };
    const next = hydrateCvSection({ ...section, content: serializeStructuredCvEntries(section, [defaultEntryForKind(section)]) }, draft.sections.length);
    setDraft({ ...draft, sections: [...draft.sections, next] });
    setSelectedSectionId(next.id);
    setSelectedEntryId(cvEntriesForSection(next)[0]?.id ?? null);
    setShowAddContent(false);
  }

  async function importMasterCv() {
    const result = await jobCentral().importCvDocument();
    if (!result.text) return data;
    setCvUndoSnapshot({ label: isDe ? "Import rückgängig" : "Undo import", profile: profileDraft, cv: draft });
    setImportingCv(true);
    try {
      // Prefer AI structuring (handles messy PDF layout); fall back to the deterministic
      // parser when no engine is detected or the model output isn't usable.
      const structured = await jobCentral().structureCvImport({ text: result.text }).catch(() => null);
      const analysis = analyzeImportedCvDocument(result.text, profileDraft, draft, structured?.sections);
      setProfileDraft(analysis.profile);
      setDraft(analysis.cv);
      setImportReview(analysis);
      setMode("content");
      const firstImported = analysis.cv.sections.find((section) => section.enabled && section.content.trim());
      setSelectedSectionId(firstImported?.id ?? analysis.cv.sections[0]?.id ?? "");
      setSelectedEntryId(firstImported ? cvEntriesForSection(firstImported)[0]?.id ?? null : null);
      return data;
    } finally {
      setImportingCv(false);
    }
  }

  async function restoreCvSnapshot() {
    if (!cvUndoSnapshot) return data;
    setProfileDraft(cvUndoSnapshot.profile);
    setDraft(cvUndoSnapshot.cv);
    const savedProfile = await jobCentral().saveProfile(cvUndoSnapshot.profile);
    const savedCv = await jobCentral().saveMasterCv(cvUndoSnapshot.cv);
    setData(savedCv);
    setImportReview(null);
    setCvUndoSnapshot(null);
    return savedProfile && savedCv;
  }

  function duplicateEntry() {
    if (!selectedSection || !selectedEntry) return;
    const next = duplicateCvEntry(selectedSection, selectedEntry.id);
    setDraft({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === selectedSection.id ? next.section : section,
      ),
    });
    setSelectedEntryId(next.entry?.id ?? selectedEntry.id);
  }

  function deleteEntry() {
    if (!selectedSection || !selectedEntry || selectedEntries.length <= 1) return;
    if (!confirmDestructive(isDe ? `Eintrag '${selectedEntry.title}' aus '${selectedSection.title}' löschen?` : `Delete entry "${selectedEntry.title}" from ${selectedSection.title}?`)) return;
    const entries = selectedEntries.filter((entry) => entry.id !== selectedEntry.id);
    setDraft({
      ...draft,
      sections: draft.sections.map((section) =>
        section.id === selectedSection.id ? deleteCvEntry(section, selectedEntry.id) : section,
      ),
    });
    setSelectedEntryId(entries[0]?.id ?? null);
  }

  async function runEntryAi(kind: "tips" | "improve" | "grammar" | "shorter") {
    if (!selectedSection || !selectedEntry) return data;
    const instruction =
      kind === "tips"
        ? `Give 3 concise improvement tips for this ${selectedSection.title} CV entry. Do not rewrite it.\n\n${selectedEntry.body}`
        : kind === "grammar"
          ? `Fix grammar and wording only. Preserve meaning and facts.\n\n${selectedEntry.body}`
          : kind === "shorter"
            ? `Make this CV entry shorter and stronger. Preserve concrete proof points.\n\n${selectedEntry.body}`
            : `Improve this CV entry for clarity, impact, and ATS readability. Preserve facts.\n\n${selectedEntry.body}`;
    const next = await jobCentral().createAiPlan({
      purpose: "cv_entry",
      title: `${kind === "tips" ? "Tips" : "Rewrite"}: ${selectedSection.title}`,
      instructions: instruction,
    });
    const plan = newestPlan(next.aiPlans, (item) => item.purpose === "cv_entry" && item.title === `${kind === "tips" ? "Tips" : "Rewrite"}: ${selectedSection.title}`);
    setData(next);
    if (!plan) return next;
    const ran = await jobCentral().runAiPlan(plan.id);
    setData(ran);
    const output = ran.aiPlans.find((item) => item.id === plan.id)?.output?.trim();
    if (!output || /quota|exhausted|not detected|error/i.test(output)) return ran;
    if (kind === "tips") setEntryTip(output);
    else updateSelectedEntry({ body: output });
    return ran;
  }

  async function exportSelectedCv() {
    let exportId = previewCvId;
    await jobCentral().saveProfile(profileDraft);
    if (previewCvId === "master") {
      const saved = await jobCentral().saveMasterCv({ ...draft, sections: hydrateCvSections(draft.sections) });
      setData(saved);
      exportId = saved.masterCv.id;
    } else if (selectedStoredCv) {
      const saved = await jobCentral().saveCvVersion({
        ...selectedStoredCv,
        title: draft.title,
        template: draft.template,
        style: draft.style,
        sections: hydrateCvSections(draft.sections),
      });
      setData(saved);
    }
    const result = await jobCentral().generateCvPdf(exportId);
    setData(result.data);
    return result;
  }

  async function resolveCvProposal(proposal: AiProposal, action: "accept" | "reject" | "edit") {
    const next = await jobCentral().resolveAiProposal({
      proposalId: proposal.id,
      action,
      edited: cvProposalEdits[proposal.id],
    });
    setData(next);
    if (previewCvId === "master") {
      setDraft({ ...next.masterCv, sections: hydrateCvSections(next.masterCv.sections) });
    } else {
      const cv = next.cvVersions.find((item) => item.id === previewCvId);
      if (cv) {
        setDraft({
          id: cv.id,
          title: cv.title,
          language: next.masterCv.language,
          template: cv.template,
          style: cv.style,
          sections: hydrateCvSections(cv.sections),
          updatedAt: cv.createdAt,
        });
      }
    }
    setCvProposalEdits((current) => {
      const copy = { ...current };
      delete copy[proposal.id];
      return copy;
    });
    return next;
  }

  async function saveCurrentCv() {
    await jobCentral().saveProfile(profileDraft);
    if (previewCvId === "master") {
      const next = await jobCentral().saveMasterCv({ ...draft, sections: hydrateCvSections(draft.sections) });
      setData(next);
      return next;
    }
    const original = data.cvVersions.find((cv) => cv.id === previewCvId);
    if (!original) return data;
    const next = await jobCentral().saveCvVersion({
      ...original,
      title: draft.title,
      // Custom per-variant title: save what the user typed (empty → drop it so the CV
      // falls back to the global profile.headline).
      headline: variantHeadline.trim() || undefined,
      template: draft.template,
      style: draft.style,
      sections: hydrateCvSections(draft.sections),
    });
    setData(next);
    return next;
  }

  // The preview must always reflect the SELECTED language. `draft` is the live edit
  // buffer; a mirror effect loads the selected-language doc into it, but that load can
  // lag a render behind the toggle — leaving a German `draft` while EN is selected. So
  // derive the preview source here: use `draft` only when it already holds the selected
  // language; otherwise fall back to the correct stored source, so the preview never
  // shows the wrong language. (Edits still flow through `draft` once the buffer syncs.)
  const masterLangSource: CvDocument = showingMasterTranslation && data.masterCvTranslation
    ? data.masterCvTranslation
    : data.masterCv;
  const previewBase: CvDocument = previewCvId === "master" && draft.language !== masterLangSource.language
    ? masterLangSource
    : draft;
  const previewVersion: CvVersion = {
    id: "preview",
    title: previewBase.title,
    // Carry the selected variant's tailored title into the preview so the CV Builder
    // shows the role-fit headline (e.g. "Senior Frontend Engineer") and updates LIVE as
    // the user edits it. Master has none → falls back to profile.headline (the global).
    headline: previewCvId === "master" ? undefined : (variantHeadline.trim() || undefined),
    sourceCvId: previewCvId === "master" ? data.masterCv.id : selectedStoredCv?.sourceCvId ?? data.masterCv.id,
    jobId: selectedStoredCv?.jobId,
    template: previewBase.template,
    style: previewBase.style,
    sections: previewBase.sections,
    notes: selectedStoredCv?.notes ?? "",
    createdAt: selectedStoredCv?.createdAt ?? draft.updatedAt,
  };
  const selectedPreviewCv = previewVersion;
  const changedSections = cvUndoSnapshot
    ? draft.sections
      .filter((section) => {
        const before = cvUndoSnapshot.cv.sections.find((item) => item.id === section.id || item.kind === section.kind);
        return !before || before.title !== section.title || before.content !== section.content || before.enabled !== section.enabled;
      })
      .map((section) => section.title)
    : [];
  const headerCard = (
    <div
      role="button"
      tabIndex={0}
      className={`flow-section-row header-row ${showHeaderEditor ? "selected" : ""}`}
      onClick={() => {
        setShowHeaderEditor(true);
        setSelectedSectionId("");
        setSelectedEntryId(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setShowHeaderEditor(true);
          setSelectedSectionId("");
          setSelectedEntryId(null);
        }
      }}
    >
      <Pencil className="drag-dots" size={18} />
      <span>
        <strong>{data.settings.language === "de" ? "Header" : "Header"}</strong>
        <small>{profileDraft.fullName} · {draft.style.showPhoto ? (isDe ? "Foto an" : "Photo on") : (isDe ? "Foto aus" : "Photo off")}</small>
      </span>
      <div className="section-row-actions">
        <button
          type="button"
          className="visibility-button"
          onClick={(event) => {
            event.stopPropagation();
            setDraft({ ...draft, style: { ...draft.style, showPhoto: !draft.style.showPhoto } });
          }}
        >
          {draft.style.showPhoto ? (isDe ? "Foto an" : "Photo on") : (isDe ? "Foto aus" : "Photo off")}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`cv-workspace${showPreview ? "" : " no-preview"}`}
      style={showPreview ? { gridTemplateColumns: `minmax(0, 1fr) 16px ${previewWidth}px`, columnGap: 0 } : undefined}
    >
      <div className="cv-mode-tabs">
          <div className="cv-tabs-primary">
            <button className={mode === "overview" ? "active" : ""} onClick={() => setMode("overview")}>{labels.overview}</button>
            <button className={mode === "content" ? "active" : ""} onClick={() => setMode("content")}>{labels.content}</button>
            <button className={mode === "customize" ? "active" : ""} onClick={() => setMode("customize")}>{labels.customize}</button>
            <button className={mode === "ai" ? "active" : ""} onClick={() => setMode("ai")}>{labels.aiTools}</button>
          </div>
          <div className="cv-document-actions">
            <details className="cv-actions-menu">
              <summary>
                <FileText size={16} />
                <span>{isDe ? "CV Aktionen" : "CV actions"}</span>
                <ChevronDown size={15} />
              </summary>
              <div className="cv-actions-popover">
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => run("Importing CV", importMasterCv, () => isDe ? "Import zur Kontrolle bereit" : "Import staged for review")}
                >
                  <FileText size={16} />
                  {isDe ? "PDF/DOCX importieren" : "Import PDF/DOCX"}
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    run("Proposing CV changes", () => {
                      setCvUndoSnapshot({ label: isDe ? "Vorschlag rückgängig" : "Undo proposal", profile: profileDraft, cv: draft });
                      return jobCentral().proposeMasterCvOptimization({ instructions: aiInstructions }).then((next) => {
                        setData(next);
                        setDraft({ ...next.masterCv, sections: hydrateCvSections(next.masterCv.sections) });
                        setPreviewCvId("master");
                        return next;
                      });
                    })
                  }
                >
                  <Sparkles size={16} />
                  {isDe ? "CV-Vorschläge" : "Propose CV changes"}
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() =>
                    run(
                      "Exporting CV",
                      exportSelectedCv,
                      pdfResultMessage,
                    )
                  }
                >
                  <Download size={16} />
                  {isDe ? "PDF exportieren" : "Export PDF"}
                </button>
                {previewCvId !== "master" ? (
                  <button
                    type="button"
                    className="secondary small danger"
                    onClick={() =>
                      confirmDestructive(isDe ? "Diese CV-Version löschen?" : "Delete this CV version?")
                        ? run("Deleting CV version", () =>
                          jobCentral().deleteCvVersion(previewCvId).then((next) => {
                            setData(next);
                            setPreviewCvId("master");
                            return next;
                          }),
                        )
                        : undefined
                    }
                  >
                    <Trash2 size={16} />
                    {isDe ? "CV löschen" : "Delete CV"}
                  </button>
                ) : null}
              </div>
            </details>
            <select className="cv-version-select" value={previewCvId} onChange={(event) => setPreviewCvId(event.target.value)}>
              <option value="master">{isDe ? "Master-CV" : "Master CV"}</option>
              {data.cvVersions.map((cv) => (
                <option key={cv.id} value={cv.id}>{cv.title}</option>
              ))}
            </select>
            {previewCvId === "master" ? (
              <div className="cv-lang-toggle" title={isDe ? "Sprache des Master-CV" : "Master CV language"}>
                {(["en", "de"] as const).map((lang) => {
                  const exists = lang === data.masterCv.language || data.masterCvTranslation?.language === lang;
                  return (
                    <button
                      key={lang}
                      className={editLang === lang ? "active" : ""}
                      onClick={() => void switchMasterLang(lang)}
                      title={exists
                        ? (lang === "de" ? "Deutsch" : "English")
                        : (isDe ? `Auf ${lang === "de" ? "Deutsch" : "Englisch"} übersetzen` : `Translate to ${lang === "de" ? "German" : "English"}`)}
                    >
                      {lang === "en" ? "EN" : "DE"}{exists ? "" : " +"}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {masterTranslationStale ? (
              <button className="secondary small" onClick={() => void retranslateMaster()} title={isDe ? "Original wurde geändert" : "Source changed since translation"}>
                <Sparkles size={14} /> {isDe ? "Übersetzung aktualisieren" : "Update translation"}
              </button>
            ) : null}
            {selectedStoredCv ? (
              <button
                className="secondary small"
                // Persist the live draft first: compare/merge reads saved data, and a
                // copy/promote reloads the draft — saving here keeps in-progress edits.
                onClick={() => void run(isDe ? "CV speichern" : "Saving CV", async () => {
                  const next = await saveCurrentCv();
                  setCompareOpen(true);
                  return next;
                })}
                title={isDe ? "Teile mit dem Master-CV vergleichen und zusammenführen" : "Compare parts with your master CV and merge"}
              >
                <Columns size={14} /> {isDe ? "Mit Master vergleichen" : "Compare with master"}
              </button>
            ) : null}
            <button
              className="primary small"
              title={labels.save}
              onClick={() =>
                run("Saving CV", async () => {
                  const next = await saveCurrentCv();
                  setImportReview(null);
                  return next;
                })
              }
            >
              <Save size={16} /> {labels.save}
            </button>
            <button
              className="secondary small"
              onClick={() => setShowPreview((value) => !value)}
              title={showPreview ? (isDe ? "Vorschau ausblenden" : "Hide preview") : (isDe ? "Vorschau anzeigen" : "Show preview")}
            >
              {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
              <span>{isDe ? "Vorschau" : "Preview"}</span>
            </button>
          </div>
        </div>

      {importingCv ? (
        <div className="modal-backdrop import-progress-backdrop" role="presentation">
          <div className="import-progress-card" role="status" aria-live="polite">
            <Loader2 className="spin" size={30} />
            <strong>{isDe ? "CV wird importiert" : "Importing your CV"}</strong>
            <p>
              {(() => {
                const engine = data.aiProviders.find((provider) => provider.key === data.settings.activeAiProvider && provider.detected)?.label;
                return engine
                  ? (isDe
                    ? `${engine} liest deinen Lebenslauf und baut die Abschnitte sauber neu auf…`
                    : `${engine} is reading your CV and rebuilding the sections cleanly…`)
                  : (isDe
                    ? "Dein Lebenslauf wird analysiert und neu strukturiert…"
                    : "Analyzing and restructuring your CV…");
              })()}
            </p>
            <small>{isDe ? "Das kann bis zu einer Minute dauern. Fenster offen lassen." : "This can take up to a minute. Keep the window open."}</small>
          </div>
        </div>
      ) : null}

      <section className="cv-editor">
        {importReview ? (
          <div className="import-review">
            <div>
              <strong>{isDe ? "Import bereit zur Kontrolle" : "Import ready to review"}</strong>
              <span>
                {importReview.sectionCounts.map((item) => `${item.title}: ${item.entries}`).join(" · ")}
              </span>
              {changedSections.length ? <small>{isDe ? "Geändert" : "Changed"}: {changedSections.join(", ")}</small> : null}
            </div>
            <button className="secondary small" onClick={() => setImportReview(null)}>
              <X size={15} /> {isDe ? "Ausblenden" : "Dismiss"}
            </button>
            {cvUndoSnapshot ? (
              <button className="secondary small" onClick={() => run(cvUndoSnapshot.label, restoreCvSnapshot)}>
                {cvUndoSnapshot.label}
              </button>
            ) : null}
          </div>
        ) : null}
        {!importReview && cvUndoSnapshot ? (
          <div className="import-review">
            <div>
              <strong>{cvUndoSnapshot.label}</strong>
              <span>{isDe ? "Die letzte CV-Änderung kann wiederhergestellt werden." : "The last CV change can be restored."}</span>
              {changedSections.length ? <small>{isDe ? "Geändert" : "Changed"}: {changedSections.join(", ")}</small> : null}
            </div>
            <div className="import-review-actions">
              <button className="secondary small" onClick={() => run(cvUndoSnapshot.label, restoreCvSnapshot)}>
                {cvUndoSnapshot.label}
              </button>
              <button
                className="row-icon-button"
                title={isDe ? "Hinweis schließen" : "Dismiss"}
                onClick={() => setCvUndoSnapshot(null)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ) : null}

        {mode === "overview" ? (
          <div className="cv-section-stack">
            <article className="cv-overview-hero">
              <ProfileCard profile={profileDraft} />
              <div className="cv-overview-actions">
                <button
                  className="secondary"
                  onClick={() => {
                    setMode("content");
                    setShowHeaderEditor(true);
                    setSelectedSectionId("");
                    setSelectedEntryId(null);
                  }}
                >
                  <Pencil size={16} /> {isDe ? "Header bearbeiten" : "Edit header"}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setMode("content");
                    setShowHeaderEditor(false);
                    setSelectedSectionId(draft.sections[0]?.id ?? "");
                  }}
                >
                  <FileText size={16} /> {isDe ? "Inhalt bearbeiten" : "Edit content"}
                </button>
                <button className="primary" onClick={() => run("Exporting CV", exportSelectedCv, pdfResultMessage)}>
                  <Download size={16} /> PDF
                </button>
              </div>
            </article>
            <div className="overview-grid">
              <div><strong>{draft.sections.filter((section) => section.enabled).length}</strong><span>{isDe ? "sichtbare Abschnitte" : "visible sections"}</span></div>
              <div><strong>{data.cvVersions.filter((cv) => cv.jobId).length}</strong><span>{isDe ? "Job-CVs" : "job CVs"}</span></div>
              <div><strong>{data.coverLetters.length}</strong><span>{isDe ? "Anschreiben" : "letters"}</span></div>
            </div>
            <article className="cv-overview-packages">
              <div>
                <span>{isDe ? "Job-Pakete" : "Job packages"}</span>
                <h2>{isDe ? "Motivation und Bewerbungen sind im Job Studio" : "Motivation letters and applications live in Job Studio"}</h2>
                <p>{isDe ? "Wähle dort einen Job, generiere CV und Motivationsschreiben, exportiere beide PDFs und verschiebe den Status." : "Pick a job there, generate the CV and motivation letter, export both PDFs, and move the status."}</p>
              </div>
              <button className="primary" onClick={onOpenJobStudio}>
                <LayoutDashboard size={16} /> {isDe ? "Job Studio öffnen" : "Open Job Studio"}
              </button>
            </article>
          </div>
        ) : null}

        {mode === "content" ? (
          <div className="cv-content-layout">
            <div className="cv-section-stack">
              {headerCard}
              {draft.sections.map((section) => (
                <div
                  key={section.id}
                  role="button"
                  tabIndex={0}
                  draggable
                  className={`flow-section-row ${selectedSection?.id === section.id ? "selected" : ""} ${section.enabled ? "" : "disabled"}`}
                  onClick={() => {
                    setShowHeaderEditor(false);
                    setSelectedSectionId(section.id);
                  }}
                  onDragStart={() => setDraggingSectionId(section.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggingSectionId) return;
                    setDraft({ ...draft, sections: reorderCvSections(draft.sections, draggingSectionId, section.id) });
                    setDraggingSectionId(null);
                  }}
                  onDragEnd={() => setDraggingSectionId(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setShowHeaderEditor(false);
                      setSelectedSectionId(section.id);
                    }
                  }}
                >
                  <GripVertical className="drag-dots" size={18} />
                  <strong>{section.title}</strong>
                  <div className="section-row-actions">
                    <button
                      type="button"
                      className="visibility-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDraft({
                          ...draft,
                          sections: draft.sections.map((item) => (item.id === section.id ? setCvSectionVisibility(item, !item.enabled) : item)),
                        });
                      }}
                    >
                      {section.enabled ? (isDe ? "Sichtbar" : "Show") : (isDe ? "Aus" : "Hide")}
                    </button>
                    <button
                      type="button"
                      className="row-icon-button"
                      title={isDe ? "Abschnitt duplizieren" : "Duplicate section"}
                      onClick={(event) => {
                        event.stopPropagation();
                        const next = duplicateCvSection(draft.sections, section.id);
                        setDraft({ ...draft, sections: next.sections });
                        if (next.section) setSelectedSectionId(next.section.id);
                      }}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      className="row-icon-button danger"
                      title={isDe ? "Abschnitt löschen" : "Delete section"}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!confirmDestructive(isDe ? `Abschnitt '${section.title}' und alle Einträge löschen?` : `Delete section "${section.title}" and all its entries?`)) return;
                        const nextSections = deleteCvSection(draft.sections, section.id);
                        if (!nextSections.length) return;
                        setDraft({ ...draft, sections: nextSections });
                        if (selectedSectionId === section.id) {
                          setSelectedSectionId(nextSections[Math.max(0, draft.sections.findIndex((item) => item.id === section.id) - 1)]?.id ?? nextSections[0].id);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="secondary wide"
                onClick={() => setShowAddContent(true)}
              >
                <Plus size={18} /> {isDe ? "Abschnitt hinzufügen" : "Add Content"}
              </button>
            </div>
            <div className="section-editor-panel">
              {showHeaderEditor ? (
              <div className="profile-editor-inline">
                <div className="editor-heading">
                  <span><Pencil size={15} /> Header</span>
                  <div className="toolbar-row">
                    <label className="check-row inline">
                      <input
                        type="checkbox"
                        checked={draft.style.showPhoto}
                        onChange={(event) => setDraft({ ...draft, style: { ...draft.style, showPhoto: event.target.checked } })}
                      />
                      {isDe ? "Foto anzeigen" : "Show photo"}
                    </label>
                    <label className="check-row inline">
                      <input
                        type="checkbox"
                        checked={draft.style.showContactIcons !== false}
                        onChange={(event) => setDraft({ ...draft, style: { ...draft.style, showContactIcons: event.target.checked } })}
                      />
                      {labels.contactIcons}
                    </label>
                    <button
                      className="secondary small"
                      onClick={() => run("Saving header", saveCurrentCv)}
                    >
                      <Save size={15} /> {labels.save}
                    </button>
                  </div>
                </div>
                <div className="profile-header-editor personal-details-editor">
                  <div className="profile-field-grid personal-details-grid">
                    <label className="wide">
                      {isDe ? "Vollständiger Name" : "Full name"}
                      <input value={profileDraft.fullName} onChange={(event) => setProfileDraft({ ...profileDraft, fullName: event.target.value })} placeholder={isDe ? "Name" : "Name"} />
                    </label>
                    <label className="wide">
                      {previewCvId === "master"
                        ? (isDe ? "Berufsbezeichnung" : "Professional title")
                        : (isDe ? "Berufsbezeichnung (nur dieses CV)" : "Professional title (this CV only)")}
                      {previewCvId === "master" ? (
                        <input value={profileDraft.headline} onChange={(event) => setProfileDraft({ ...profileDraft, headline: event.target.value })} placeholder={isDe ? "Titel" : "Headline"} />
                      ) : (
                        <input value={variantHeadline} onChange={(event) => setVariantHeadline(event.target.value)} placeholder={data.profile.headline?.trim() || (isDe ? "Titel" : "Headline")} />
                      )}
                    </label>
                    <label>
                      <Mail size={15} /> {isDe ? "E-Mail" : "Email"}
                      <input value={profileDraft.email} onChange={(event) => setProfileDraft({ ...profileDraft, email: event.target.value })} placeholder={isDe ? "E-Mail" : "Email"} />
                    </label>
                    <label>
                      <Phone size={15} /> {isDe ? "Telefon" : "Phone"}
                      <input value={profileDraft.phone} onChange={(event) => setProfileDraft({ ...profileDraft, phone: event.target.value })} placeholder={isDe ? "Telefon" : "Phone"} />
                    </label>
                    <label>
                      <MapPin size={15} /> {isDe ? "Ort" : "Location"}
                      <input value={profileDraft.location} onChange={(event) => setProfileDraft({ ...profileDraft, location: event.target.value })} placeholder={isDe ? "Ort" : "Location"} />
                    </label>
                    <label>
                      <Link size={15} /> LinkedIn
                      <input value={profileDraft.linkedin ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, linkedin: event.target.value })} placeholder="LinkedIn" />
                    </label>
                    <label>
                      <Link size={15} /> Website
                      <input value={profileDraft.website ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, website: event.target.value })} placeholder="Website" />
                    </label>
                    <label>
                      <Link size={15} /> GitHub
                      <input value={profileDraft.github ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, github: event.target.value })} placeholder="GitHub" />
                    </label>
                    <label>
                      <Globe2 size={15} /> {isDe ? "Nationalität" : "Nationality"}
                      <input value={profileDraft.nationality ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, nationality: event.target.value })} placeholder={isDe ? "z.B. Schweizer, Deutsch" : "e.g. Swiss, German"} />
                    </label>
                    <label>
                      <Check size={15} /> {isDe ? "Aufenthaltsbewilligung" : "Work permit"}
                      <input value={profileDraft.workPermit ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, workPermit: event.target.value })} placeholder={isDe ? "z.B. Schweizer Bürger, C-Ausweis, EU" : "e.g. Swiss citizen, C permit, EU"} />
                    </label>
                    <label>
                      <CalendarClock size={15} /> {isDe ? "Geburtsdatum" : "Date of birth"}
                      <input value={profileDraft.dateOfBirth ?? ""} onChange={(event) => setProfileDraft({ ...profileDraft, dateOfBirth: event.target.value })} placeholder={isDe ? "TT.MM.JJJJ (optional)" : "DD.MM.YYYY (optional)"} />
                    </label>
                  </div>
                  <label className="photo-drop">
                    <span className="portrait">
                      {profileDraft.photoDataUrl ? <img src={profileDraft.photoDataUrl} alt="" /> : profileDraft.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                    </span>
                    <strong>{isDe ? "Foto wählen" : "Choose photo"}</strong>
                    <small>{isDe ? "Gilt für dein Profil, jedes CV kann es ein-/ausblenden." : "Saved on your profile; each CV can show or hide it."}</small>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setProfileDraft({ ...profileDraft, photoDataUrl: String(reader.result) });
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
                <div className="header-done-row">
                  <button
                    className="primary"
                    onClick={() =>
                      run("Saving header", async () => {
                        await jobCentral().saveProfile(profileDraft);
                        const next = await jobCentral().saveMasterCv({ ...draft, sections: hydrateCvSections(draft.sections) });
                        setData(next);
                        setShowHeaderEditor(false);
                        return next;
                      })
                    }
                  >
                    <Check size={18} /> {isDe ? "Fertig" : "Done"}
                  </button>
                </div>
              </div>
              ) : null}
              {!showHeaderEditor && selectedSection ? (
                <>
                  <div className="editor-heading section-editor-title">
                    <input
                      className="section-title-input"
                      value={selectedSection.title}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          sections: draft.sections.map((section) => section.id === selectedSection.id ? { ...section, title: event.target.value } : section),
                        })
                      }
                    />
                    <span className="editor-context-label">{isDe ? "Abschnitt" : "Section"}</span>
                  </div>
                  <div className="entry-workbench">
                    <div className="entry-list">
                      {selectedEntries.map((entry) => (
                        <button
                          key={entry.id}
                          draggable
                          className={`${selectedEntry?.id === entry.id ? "selected" : ""} ${entry.visible === false ? "disabled" : ""}`}
                          onClick={() => setSelectedEntryId(entry.id)}
                          onDragStart={() => setDraggingEntryId(entry.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            if (!selectedSection || !draggingEntryId) return;
                            setDraft({
                              ...draft,
                              sections: draft.sections.map((section) =>
                                section.id === selectedSection.id ? reorderCvEntries(section, draggingEntryId, entry.id) : section,
                              ),
                            });
                            setDraggingEntryId(null);
                          }}
                          onDragEnd={() => setDraggingEntryId(null)}
                        >
                          <GripVertical size={16} />
                          <span>
                            <strong>{entry.title}</strong>
                            {entry.subtitle || entry.meta ? <small>{[entry.subtitle, entry.meta].filter(Boolean).join(" · ")}</small> : null}
                          </span>
                        </button>
                      ))}
                      <div className="entry-list-actions">
                        <button className="secondary" onClick={addEntry}><Plus size={16} /> {isDe ? "Eintrag hinzufügen" : "Add Entry"}</button>
                        {(selectedSection.kind === "experience" || selectedSection.kind === "projects") && (data.cvProjects?.length ?? 0) > 0 ? (
                          <button
                            className="secondary"
                            title={isDe ? "Frühere Einträge aus deinem Werdegang holen" : "Pull past entries from your history"}
                            // Save the live draft first: the picker reads saved data and adding reloads the draft.
                            onClick={() => void run(isDe ? "CV speichern" : "Saving CV", async () => {
                              const next = await saveCurrentCv();
                              setHistoryKind(selectedSection.kind === "projects" ? "projects" : "experience");
                              setHistoryOpen(true);
                              return next;
                            })}
                          >
                            <Plus size={16} /> {isDe ? "Aus Werdegang" : "From history"}
                          </button>
                        ) : null}
                        <button className="secondary" onClick={duplicateEntry}><Copy size={16} /> {isDe ? "Duplizieren" : "Duplicate"}</button>
                        <button className="secondary danger" onClick={deleteEntry} disabled={selectedEntries.length <= 1}><Trash2 size={16} /> {isDe ? "Löschen" : "Delete"}</button>
                      </div>
                    </div>
                    {selectedEntry ? (
                      <div className="entry-editor-card">
                        <div className="entry-editor-head">
                          <div>
                            <h2>{isDe ? "Eintrag bearbeiten" : "Edit Entry"}</h2>
                            <span>{selectedSection.title}</span>
                          </div>
                          <div className="entry-editor-tools">
                            <button className="secondary small" onClick={() => run("Getting entry tips", () => runEntryAi("tips"))}><Sparkles size={15} /> {isDe ? "Tipps holen" : "Get Tips"}</button>
                            <button
                              className="row-icon-button"
                              title={selectedEntry.visible === false ? (isDe ? "Eintrag anzeigen" : "Show entry") : (isDe ? "Eintrag ausblenden" : "Hide entry")}
                              onClick={() => {
                                setDraft({
                                  ...draft,
                                  sections: draft.sections.map((section) =>
                                    section.id === selectedSection.id ? setCvEntryVisibility(section, selectedEntry.id, selectedEntry.visible === false) : section,
                                  ),
                                });
                              }}
                            >
                              {selectedEntry.visible === false ? <Eye size={15} /> : <EyeOff size={15} />}
                            </button>
                          </div>
                        </div>

                        {selectedSection.kind === "experience" || selectedSection.kind === "education" || selectedSection.kind === "speaking" ? (
                          <div className="entry-field-grid">
                            <label>
                              {selectedSection.kind === "experience" ? (isDe ? "Arbeitgeber" : "Employer") : (isDe ? "Titel" : "Title")}
                              <input value={selectedEntry.title} onChange={(event) => updateSelectedEntry({ title: event.target.value })} />
                            </label>
                            <label>
                              {selectedSection.kind === "experience" ? (isDe ? "Berufsbezeichnung" : "Job Title") : (isDe ? "Details" : "Details")}
                              <input value={selectedEntry.subtitle} onChange={(event) => updateSelectedEntry({ subtitle: event.target.value })} />
                            </label>
                            <label>
                              {isDe ? "Zeitraum" : "Dates"}
                              <input value={selectedEntry.meta} onChange={(event) => updateSelectedEntry({ meta: event.target.value })} />
                            </label>
                          </div>
                        ) : selectedSection.kind === "languages" ? (
                          <div className="entry-field-grid">
                            <label>
                              {isDe ? "Sprache" : "Language"}
                              <input value={selectedEntry.title} onChange={(event) => updateSelectedEntry({ title: event.target.value })} />
                            </label>
                            <label>
                              {isDe ? "Sprachniveau" : "Language level"}
                              <input value={selectedEntry.subtitle} onChange={(event) => updateSelectedEntry({ subtitle: event.target.value })} placeholder={isDe ? "Muttersprache, fließend, B2…" : "Native, Fluent, B2..."} />
                            </label>
                          </div>
                        ) : selectedSection.kind === "skills" || selectedSection.kind === "projects" ? (
                          <div className="entry-field-grid compact">
                            <label>
                              {selectedSection.kind === "skills" ? (isDe ? "Kompetenz" : "Skill") : (isDe ? "Titel" : "Title")}
                              <input value={selectedEntry.title} onChange={(event) => updateSelectedEntry({ title: event.target.value })} />
                            </label>
                            <label>
                              {selectedSection.kind === "skills" ? (isDe ? "Kompetenzniveau" : "Skill level") : (isDe ? "Details" : "Details")}
                              <input value={selectedEntry.subtitle} onChange={(event) => updateSelectedEntry({ subtitle: event.target.value })} />
                            </label>
                          </div>
                        ) : (
                          <label className="entry-label">
                            {isDe ? "Berufliches Profil" : "Professional Summary"}
                            <input value={selectedEntry.title} onChange={(event) => updateSelectedEntry({ title: event.target.value })} />
                          </label>
                        )}

                        <label className="entry-label">
                          {selectedSection.kind === "profile"
                            ? (isDe ? "Zusammenfassung" : "Summary")
                            : selectedSection.kind === "skills"
                              ? (isDe ? "Informationen / Teilkompetenzen" : "Information / Sub-skills")
                              : selectedSection.kind === "languages"
                                ? (isDe ? "Zusätzliche Informationen" : "Additional information")
                                : (isDe ? "Beschreibung" : "Description")}
                          <RichTextEditor value={selectedEntry.body} onChange={(body) => updateSelectedEntry({ body })} isDe={isDe} />
                        </label>
                        {entryTip ? <pre className="entry-tip">{entryTip}</pre> : null}
                        <div className="entry-ai-actions">
                          <button className="secondary" onClick={() => run("Improving entry", () => runEntryAi("improve"))}><Sparkles size={15} /> {isDe ? "Text verbessern" : "Improve Writing"}</button>
                          <button className="secondary" onClick={() => run("Checking grammar", () => runEntryAi("grammar"))}>{isDe ? "Grammatik prüfen" : "Grammar Check"}</button>
                          <button className="secondary" onClick={() => run("Shortening entry", () => runEntryAi("shorter"))}>{isDe ? "Kürzen" : "Shorter"}</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "customize" ? (
          <div className="customize-panel">
            <div className="template-picker">
              {cvTemplateOptions.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className={draft.template === template.key ? "selected" : ""}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      template: template.key,
                      style: { ...draft.style, ...templateDefaults[template.key] },
                    })
                  }
                >
                  <span className={`template-swatch swatch-${template.key}`} />
                  <strong>
                    {template.label}
                    <span className={`template-ats-badge ${template.atsSafe ? "safe" : "risk"}`}>
                      {template.atsSafe ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
                      {template.atsSafe ? "ATS-safe" : "ATS risk"}
                    </span>
                  </strong>
                  <small>{template.description}</small>
                </button>
              ))}
            </div>
            <label>{isDe ? "Akzentfarbe" : "Accent"}
              <input type="color" value={draft.style.accentColor} onChange={(event) => setDraft({ ...draft, style: { ...draft.style, accentColor: event.target.value } })} />
            </label>
            <label>{isDe ? "Dichte" : "Density"}
              <select value={draft.style.density} onChange={(event) => setDraft({ ...draft, style: { ...draft.style, density: event.target.value as CvDocument["style"]["density"] } })}>
                <option value="comfortable">{isDe ? "Komfortabel" : "Comfortable"}</option>
                <option value="compact">{isDe ? "Kompakt" : "Compact"}</option>
              </select>
            </label>
            {/* Promotion path at one employer: keep the entries separate (each repeats the
                company) or draw them as one company block with the roles nested. */}
            <label
              title={isDe
                ? "Mehrere Stellen beim gleichen Arbeitgeber: getrennt auflisten oder als einen Firmen-Block mit verschachtelten Rollen darstellen"
                : "Several roles at the same employer: list them separately or draw one company block with the roles nested"}
            >
              {isDe ? "Gleicher Arbeitgeber" : "Same employer"}
              <select
                value={draft.style.groupSameEmployer ? "grouped" : "separate"}
                onChange={(event) => setDraft({ ...draft, style: { ...draft.style, groupSameEmployer: event.target.value === "grouped" } })}
              >
                <option value="separate">{isDe ? "Getrennte Einträge" : "Separate entries"}</option>
                <option value="grouped">{isDe ? "Als ein Block gruppieren" : "Group into one block"}</option>
              </select>
            </label>
            {previewCvId !== "master" ? (
              <button
                className="secondary small"
                title={isDe ? "Template, Dichte, Schriftart und Akzentfarbe vom Master-CV auf dieses Job-CV übernehmen" : "Copy template, density, font and accent colour from the master CV onto this job-CV"}
                onClick={() =>
                  run(isDe ? "Master-Design übernehmen" : "Applying master design", async () => {
                    const m = data.masterCv;
                    setDraft((current) => ({ ...current, template: m.template, style: { ...m.style } }));
                    const original = data.cvVersions.find((cv) => cv.id === previewCvId);
                    if (!original) return data;
                    const next = await jobCentral().saveCvVersion({ ...original, template: m.template, style: { ...m.style } });
                    setData(next);
                    return next;
                  })
                }
              >
                <Sparkles size={15} /> {isDe ? "Master-Design übernehmen" : "Apply master design"}
              </button>
            ) : null}
            <label>{isDe ? "Schriftart" : "Font"}
              <select value={draft.style.font} onChange={(event) => setDraft({ ...draft, style: { ...draft.style, font: event.target.value } })}>
                {systemFonts.map((font) => (
                  <option key={font} value={font}>{font === "system" ? (isDe ? "System" : "System") : font}</option>
                ))}
              </select>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.style.showPhoto} onChange={(event) => setDraft({ ...draft, style: { ...draft.style, showPhoto: event.target.checked } })} />
              {labels.photo}
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.style.showContactIcons !== false}
                onChange={(event) => setDraft({ ...draft, style: { ...draft.style, showContactIcons: event.target.checked } })}
              />
              {labels.contactIcons}
            </label>
            <label className="photo-upload">
              {isDe ? "Foto hochladen" : "Upload photo"}
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const nextProfile = { ...data.profile, photoDataUrl: String(reader.result) };
                    void run("Saving photo", () => jobCentral().saveProfile(nextProfile).then((next) => (setData(next), next)));
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>
        ) : null}

        {mode === "ai" ? (
          <div className="ai-cv-panel">
            <div className="ai-subtabs" role="tablist">
              <button type="button" role="tab" aria-selected={aiSubTab === "coach"} className={aiSubTab === "coach" ? "active" : ""} onClick={() => setAiSubTab("coach")}><Bot size={15} /> {isDe ? "Coach" : "Coach"}</button>
              <button type="button" role="tab" aria-selected={aiSubTab === "check"} className={aiSubTab === "check" ? "active" : ""} onClick={() => setAiSubTab("check")}><Sparkles size={15} /> {isDe ? "Check" : "Check"}</button>
              <button type="button" role="tab" aria-selected={aiSubTab === "berater"} className={aiSubTab === "berater" ? "active" : ""} onClick={() => setAiSubTab("berater")}><BriefcaseBusiness size={15} /> {isDe ? "Berufsberater" : "Career advisor"}</button>
              <button type="button" role="tab" aria-selected={aiSubTab === "zeugnisse"} className={aiSubTab === "zeugnisse" ? "active" : ""} onClick={() => setAiSubTab("zeugnisse")}><Upload size={15} /> Zeugnisse</button>
            </div>
            {aiSubTab === "berater" ? (
            <div className="career-advisor">
              <div className="cv-coach-head cv-coach-head-row">
                <div>
                  <strong>{isDe ? "Berufsberater — IT-Rollen verstehen" : "Career advisor — understand IT roles"}</strong>
                  <span>{isDe ? "Vergleicht normale IT-Berufsrichtungen wie Software Engineer, Solution Architect, Product Owner, DevOps oder AI Engineer und ordnet sie optional mit CV-Kontext ein." : "Compares normal IT career directions like software engineer, solution architect, product owner, DevOps, or AI engineer and optionally maps them to the CV context."}</span>
                </div>
                {careerConversation?.messages.length ? (
                  <button
                    className="secondary small"
                    disabled={careerBusy}
                    onClick={() => void run(isDe ? "Berufsberater zurücksetzen" : "Clearing advisor", () => jobCentral().clearCvChat("__career_advisor__").then((next) => (setData(next), next)))}
                  >
                    <Trash2 size={15} /> {isDe ? "Neu starten" : "Clear"}
                  </button>
                ) : null}
              </div>
              {careerConversation?.messages.length || careerBusy ? (
                <div className="conversation-log career-advisor-log" ref={careerLogRef}>
                  {(careerConversation?.messages ?? []).map((message) => (
                    <div key={message.id} className={message.role === "user" ? "user" : "assistant"}>
                      <strong>{message.role === "user" ? (isDe ? "Du" : "You") : (isDe ? "Berufsberater" : "Advisor")}</strong>
                      <p>{message.content}</p>
                      <small>{new Date(message.createdAt).toLocaleTimeString()}</small>
                    </div>
                  ))}
                  {careerBusy ? <div className="assistant"><strong>{isDe ? "Berufsberater" : "Advisor"}</strong><p className="cv-coach-typing"><Loader2 size={14} className="spin" /> {isDe ? "Analysiert…" : "Thinking…"}</p></div> : null}
                </div>
              ) : (
                <p className="cv-coach-hint">{isDe ? "Beispiele: \"Welche normalen IT-Rollen gibt es?\", \"Erklär Product Owner vs Solution Architect\", \"Welche Rollen sind weniger coding-lastig?\"" : "Examples: \"Which normal IT roles exist?\", \"Explain product owner vs solution architect\", \"Which roles are less coding-heavy?\""}</p>
              )}
              <div className="cv-coach-chips">
                {(isDe
                  ? ["Normale IT-Rollen zeigen", "Product Owner vs Architect", "Weniger Coding, mehr Beratung", "Mach daraus Suchbegriffe"]
                  : ["Show normal IT roles", "Product owner vs architect", "Less coding, more consulting", "Turn this into search terms"]
                ).map((quick) => (
                  <button key={quick} type="button" className="cv-coach-chip" disabled={careerBusy} onClick={() => void sendCareerAdvisorMessage(quick)}>{quick}</button>
                ))}
              </div>
              <div className="cv-coach-composer">
                <textarea
                  value={careerMessage}
                  onChange={(event) => setCareerMessage(event.target.value)}
                  placeholder={isDe ? "z.B. Welche normalen IT-Rollen gibt es und was macht man dort? (⌘/Ctrl+Enter)" : "e.g. Which normal IT roles exist and what do people do there? (⌘/Ctrl+Enter)"}
                  onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendCareerAdvisorMessage(); } }}
                />
                <button className="primary" disabled={careerBusy || !careerMessage.trim()} onClick={() => void sendCareerAdvisorMessage()}>
                  {careerBusy ? <Loader2 size={16} className="spin" /> : <BriefcaseBusiness size={16} />} {isDe ? "Fragen" : "Ask"}
                </button>
              </div>
              {latestCareerAdvice?.directions?.length ? (
                <div className="career-direction-grid">
                  {latestCareerAdvice.directions.slice(0, 6).map((direction, index) => (
                    <article className="career-direction-card" key={`${direction.title ?? "direction"}-${index}`}>
                      <div className="career-direction-head">
                        <strong>{direction.title || (isDe ? "Richtung" : "Direction")}</strong>
                        {typeof direction.fit === "number" ? <span>{Math.round(direction.fit)}%</span> : null}
                      </div>
                      {direction.why ? <p>{direction.why}</p> : null}
                      {direction.watchOut ? <small>{isDe ? "Achtung: " : "Watch: "}{direction.watchOut}</small> : null}
                      {direction.keywords?.length ? <div className="career-tags">{direction.keywords.slice(0, 8).map((keyword) => <span key={keyword}>{keyword}</span>)}</div> : null}
                      {direction.nextStep ? <p className="career-next">{direction.nextStep}</p> : null}
                      <button className="secondary small" onClick={() => void run(isDe ? "Suchrichtung übernehmen" : "Applying search direction", () => applyCareerSearch(latestCareerAdvice.search, direction))}>
                        <Search size={15} /> {isDe ? "Für Jobsuche nutzen" : "Use for job search"}
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
              {latestCareerAdvice?.questions?.length ? (
                <div className="career-questions">
                  <strong>{isDe ? "Offene Fragen" : "Open questions"}</strong>
                  {latestCareerAdvice.questions.map((question, index) => <button key={index} className="link-like" onClick={() => setCareerMessage(question)}>{question}</button>)}
                </div>
              ) : null}
            </div>
            ) : null}
            {aiSubTab === "coach" ? (
            <div className="cv-coach">
              <div className="cv-coach-head cv-coach-head-row">
                <div>
                  <strong>{isDe ? "CV-Coach — fragen, einfügen, verbessern" : "CV coach — ask, paste, improve"}</strong>
                  <span>{isDe ? `Frag zum ${previewCvId === "master" ? "Master-CV" : "diesem CV"}, füge ein, was du getan hast, oder bitte um Änderungen. Er prüft und schlägt Bearbeitungen vor, die du unten annehmen kannst.` : `Ask about ${previewCvId === "master" ? "your master CV" : "this CV"}, paste what you do, or request changes. It checks and proposes edits you can accept below — no CLI needed.`}</span>
                </div>
                {cvCoachConversation?.messages.length ? (
                  <div className="cv-coach-head-actions">
                    <button
                      className="secondary small"
                      disabled={coachBusy}
                      title={isDe ? "Fakten aus diesem Chat ins Profil übernehmen (mit Prüfung)" : "Capture facts from this chat into your profile (you review them)"}
                      onClick={() => {
                        const conversationId = cvCoachConversation.id;
                        void run(isDe ? "Fakten erfassen" : "Capturing facts", () =>
                          jobCentral().extractProfileFacts({ conversationId }).then((next) => (setData(next), next)),
                        );
                      }}
                    >
                      <Sparkles size={15} /> {isDe ? "Fakten ins Profil" : "Save facts"}
                    </button>
                    <button
                      className="secondary small"
                      disabled={coachBusy}
                      title={isDe ? "Chat löschen und Kontext zurücksetzen" : "Clear chat and reset the coach's context"}
                      onClick={() => void clearCvCoach()}
                    >
                      <Trash2 size={15} /> {isDe ? "Neu starten" : "Clear"}
                    </button>
                  </div>
                ) : null}
              </div>
              {/* Target-job + generate (moved here from the old "Anpassen" tab). Pick a job to
                  build a tailored variant, or leave empty to improve the master CV directly. */}
              <div className="cv-coach-target">
                <label>{isDe ? "Ziel-Job" : "Target job"}
                  <select value={selectedJobId} onChange={(event) => setSelectedJobId(event.target.value)}>
                    <option value="">{isDe ? "Kein Ziel — Master-CV verbessern" : "No target — improve master CV"}</option>
                    {data.jobPosts.map((job) => (
                      <option key={job.id} value={job.id}>{job.title} - {job.company}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  onClick={() =>
                    selectedJobId
                      ? run(isDe ? "Job-CV wird erstellt" : "Creating tailored CV", () =>
                          jobCentral()
                            .createCvVariant({ jobId: selectedJobId, title: selectedJob ? `${selectedJob.company} – ${variantTitle}` : variantTitle, notes: aiInstructions || "Tailored from master CV" })
                            .then((next) => {
                              setData(next);
                              const variant = next.cvVersions.find((cv) => cv.jobId === selectedJobId);
                              if (variant) setPreviewCvId(variant.id);
                              return next;
                            }),
                        )
                      : run(isDe ? "Master-CV wird verbessert" : "Improving master CV", () =>
                          jobCentral().proposeMasterCvOptimization({ instructions: aiInstructions }).then((next) => (setData(next), next)),
                        )
                  }
                >
                  <Sparkles size={16} /> {selectedJobId ? (isDe ? "Job-CV erstellen" : "Generate tailored CV") : (isDe ? "Master-CV verbessern" : "Improve master CV")}
                </button>
              </div>
              {cvCoachConversation?.messages.length || coachBusy ? (
                <div className="conversation-log cv-coach-log" ref={coachLogRef}>
                  {(cvCoachConversation?.messages ?? []).map((message) => (
                    <div key={message.id} className={message.role}>
                      <strong>
                        {message.role === "user" ? (isDe ? "Du" : "You") : "Coach"}
                        {typeof message.cvScore === "number" ? <span className="cv-coach-score">{message.cvScore}/100</span> : null}
                      </strong>
                      <p>{message.content}</p>
                      {message.proposalIds && message.proposalIds.length
                        ? <small className="cv-coach-applied"><Sparkles size={12} /> {isDe ? `${message.proposalIds.length} Änderung${message.proposalIds.length === 1 ? "" : "en"} vorgeschlagen — unten prüfen` : `Proposed ${message.proposalIds.length} change${message.proposalIds.length === 1 ? "" : "s"} — review in proposals below`}</small>
                        : <small>{new Date(message.createdAt).toLocaleTimeString()}</small>}
                    </div>
                  ))}
                  {coachBusy ? <div className="assistant"><strong>Coach</strong><p className="cv-coach-typing"><Loader2 size={14} className="spin" /> {isDe ? "Denkt…" : "Thinking…"}</p></div> : null}
                </div>
              ) : (
                <p className="cv-coach-hint">{isDe ? "Frag alles zu deinem CV, füge eine neue Stelle ein oder tippe unten auf einen Vorschlag." : "Ask anything about your CV, paste a new role you did, or tap a suggestion below."}</p>
              )}
              <div className="cv-coach-chips">
                {["How strong is this CV?", "Make it more concise", "Stronger impact bullets", "Improve my summary"].map((quick) => (
                  <button key={quick} type="button" className="cv-coach-chip" disabled={coachBusy} onClick={() => void sendCvCoachMessage(quick)}>{quick}</button>
                ))}
              </div>
              <div className="cv-coach-composer">
                <textarea
                  value={cvCoachMessage}
                  onChange={(event) => setCvCoachMessage(event.target.value)}
                  placeholder={isDe ? "z.B. Ich habe gerade eine Next.js-Migration für 2 Mio. Nutzer geleitet — füge das hinzu und straf den Rest. (⌘/Ctrl+Enter zum Senden)" : "e.g. I just led a Next.js migration for 2M users — add that and tighten the rest. (⌘/Ctrl+Enter to send)"}
                  onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void sendCvCoachMessage(); } }}
                />
                <button className="primary" disabled={coachBusy || !cvCoachMessage.trim()} onClick={() => void sendCvCoachMessage()}>
                  {coachBusy ? <Loader2 size={16} className="spin" /> : <Bot size={16} />} {isDe ? "Senden" : "Send"}
                </button>
              </div>
            </div>
            ) : null}
            {aiSubTab === "check" ? (
            <div className="cv-check-card">
              <div className="cv-check-head">
                <div>
                  <strong>{isDe ? "CV-Check — ATS + Recruiter" : "CV check — ATS + recruiter"}</strong>
                  <span>{isDe ? "Bewertet dein gespeichertes Master-CV wie ein ATS-Scanner und ein Schweizer Recruiter, mit konkreten Verbesserungen." : "Scores your saved master CV like an ATS scanner and a Swiss recruiter would, with concrete fixes."}</span>
                </div>
                <button
                  className="primary"
                  disabled={reviewing}
                  onClick={() => {
                    setReviewing(true);
                    setCvReview(null);
                    void jobCentral().reviewCv({})
                      .then((review) => setCvReview(review))
                      .catch((error) => setCvReview({ overall: 0, verdict: error instanceof Error ? error.message : (isDe ? "Prüfung fehlgeschlagen." : "Review failed."), categories: [], strengths: [], fixes: [], missingKeywords: [] }))
                      .finally(() => setReviewing(false));
                  }}
                >
                  {reviewing ? <><Loader2 size={16} className="spin" /> {isDe ? "Prüfe…" : "Checking…"}</> : <><Sparkles size={16} /> {isDe ? "CV prüfen" : "Check my CV"}</>}
                </button>
              </div>
              {cvReview ? (
                <div className="cv-check-result">
                  <div className="cv-check-summary">
                    {cvReview.categories.length ? <FitRing value={cvReview.overall} isDe={isDe} /> : null}
                    <p>{cvReview.verdict}</p>
                  </div>
                  {cvReview.categories.length ? (
                    <div className="cv-check-categories">
                      {cvReview.categories.map((category) => (
                        <div className="cv-check-cat" key={category.name}>
                          <div className="cv-check-cat-head">
                            <span>{category.name}</span>
                            <strong>{category.score}</strong>
                          </div>
                          <div className="cv-check-bar"><i style={{ width: `${category.score}%`, background: category.score >= 80 ? "#22c55e" : category.score >= 65 ? "#f59e0b" : "#ef4444" }} /></div>
                          {category.note ? <small>{category.note}</small> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {cvReview.fixes.length ? (
                    <div className="cv-check-list">
                      <strong>{isDe ? "Wichtigste Verbesserungen" : "Highest-impact fixes"}</strong>
                      <ul>{cvReview.fixes.map((fix, index) => <li key={index}>{fix}</li>)}</ul>
                    </div>
                  ) : null}
                  {cvReview.missingKeywords.length ? (
                    <div className="cv-check-list">
                      <strong>{isDe ? "Fehlende Keywords" : "Missing keywords"} {cvReview.jobTitle ? <small>{isDe ? `aus ${cvReview.jobTitle}` : `from ${cvReview.jobTitle}`}</small> : null}</strong>
                      <div className="cv-check-keywords">
                        {cvReview.missingKeywords.map((keyword, index) => <span key={index} className="cv-check-keyword">{keyword}</span>)}
                      </div>
                    </div>
                  ) : null}
                  {cvReview.strengths.length ? (
                    <div className="cv-check-list muted">
                      <strong>{isDe ? "Stärken" : "Strengths"}</strong>
                      <ul>{cvReview.strengths.map((strength, index) => <li key={index}>{strength}</li>)}</ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            ) : null}
            {aiSubTab === "zeugnisse" ? (
            <div className="zeugnisse-panel">
              <div className="cv-coach-head">
                <strong>{isDe ? "Erfahrung aus Zeugnissen aufbauen" : "Build experience from Zeugnisse"}</strong>
                <span>{isDe ? "Importiere deine Arbeitszeugnisse, Diplome oder alten CVs (PDF/DOCX — mehrere auswählen). Die KI extrahiert jede Stelle und erstellt eine saubere, umgekehrt chronologische Erfahrungssektion, die du unten prüfen kannst." : "Import your Arbeitszeugnisse, diplomas, or old CVs (PDF/DOCX — pick several). The AI extracts every role and builds one clean reverse-chronological experience section, proposed below for review."}</span>
              </div>
              <div className="toolbar-row">
                <button
                  className="secondary"
                  disabled={zeugnisseBusy !== null}
                  onClick={() => {
                    setZeugnisseBusy("import");
                    void jobCentral().importZeugnisse()
                      .then((res) => { if (res.documents.length) { setZeugnisseDocs(res.documents); setZeugnisseText(res.text); } })
                      .finally(() => setZeugnisseBusy(null));
                  }}
                >
                  {zeugnisseBusy === "import" ? <><Loader2 size={16} className="spin" /> {isDe ? "Lese…" : "Reading…"}</> : <><Upload size={16} /> {isDe ? "Dateien importieren" : "Import files"}</>}
                </button>
                {zeugnisseDocs.length ? <span className="panel-help">{zeugnisseDocs.length} {isDe ? `Dokument${zeugnisseDocs.length === 1 ? "" : "e"}` : `document${zeugnisseDocs.length === 1 ? "" : "s"}`} · {zeugnisseDocs.reduce((sum, doc) => sum + doc.words, 0).toLocaleString()} {isDe ? "Wörter" : "words"}</span> : null}
              </div>
              {zeugnisseDocs.length ? (
                <>
                  <ul className="zeugnisse-list">
                    {zeugnisseDocs.map((doc) => <li key={doc.name}><FileText size={14} /> <span>{doc.name}</span> <small>{doc.words.toLocaleString()} {isDe ? "Wörter" : "words"}</small></li>)}
                  </ul>
                  <div className="zeugnisse-mode">
                    <span>{isDe ? "Wie sollen ältere / weniger relevante Stellen behandelt werden?" : "How should older / less-relevant roles be handled?"}</span>
                    <div className="seg">
                      <button type="button" className={zeugnisseMode === "curate" ? "active" : ""} onClick={() => setZeugnisseMode("curate")}>{isDe ? "Kuratieren — alle behalten, alte komprimieren" : "Curate — keep all, compress old"}</button>
                      <button type="button" className={zeugnisseMode === "trim" ? "active" : ""} onClick={() => setZeugnisseMode("trim")}>{isDe ? "Kürzen — Irrelevantes entfernen (~2 Seiten)" : "Trim — drop irrelevant (~2 pages)"}</button>
                    </div>
                  </div>
                  <button
                    className="primary"
                    disabled={zeugnisseBusy !== null || !zeugnisseText.trim()}
                    onClick={() => {
                      setZeugnisseBusy("build");
                      void run("Building experience from Zeugnisse", () => jobCentral().buildExperienceFromDocs({ text: zeugnisseText, mode: zeugnisseMode, cvId: previewCvId }).then((next) => (setData(next), next)))
                        .finally(() => setZeugnisseBusy(null));
                    }}
                  >
                    {zeugnisseBusy === "build" ? <><Loader2 size={16} className="spin" /> {isDe ? "Erstelle…" : "Building…"}</> : <><Sparkles size={16} /> {isDe ? "Erfahrung aufbauen" : "Build experience"}</>}
                  </button>
                </>
              ) : <div className="empty-inline"><p>{isDe ? "Importiere ein paar Zeugnisse zum Starten — die KI verwandelt sie in eine saubere Zeitleiste, die du unten prüfen kannst." : "Import a few Zeugnisse to start — the AI turns them into a clean timeline you review below."}</p></div>}
            </div>
            ) : null}
            <div className="proposal-stack">
              <div className="proposal-stack-head">
                <h3>{isDe ? "CV-Vorschläge" : "CV proposals"}</h3>
                {cvProposals.some((proposal) => proposal.status !== "pending") ? (
                  <button className="link-like" onClick={() => run("Clearing resolved proposals", () => jobCentral().clearResolvedProposals().then((next) => (setData(next), next)))}>
                    <Trash2 size={14} /> {isDe ? `${cvProposals.filter((proposal) => proposal.status !== "pending").length} erledigte löschen` : `Clear ${cvProposals.filter((proposal) => proposal.status !== "pending").length} resolved`}
                  </button>
                ) : null}
              </div>
              {cvProposals.filter((proposal) => proposal.status === "pending").map((proposal) => (
                <details key={proposal.id} open>
                  <summary>
                    <strong>{proposal.title}</strong>
                    <span>{proposal.status}</span>
                  </summary>
                  {proposal.rationale ? <p>{proposal.rationale}</p> : null}
                  <div className="proposal-diff">
                    <div><strong>{isDe ? "Vorher" : "Before"}</strong><pre>{proposal.before ? proposal.before : (isDe ? "(neuer Abschnitt)" : "(new section)")}</pre></div>
                    <div><strong>{isDe ? "Vorschlag" : "Proposed"}</strong><pre>{proposalPreview(proposal)}</pre></div>
                  </div>
                  <textarea
                    value={cvProposalEdits[proposal.id] ?? proposal.proposed}
                    onChange={(event) => setCvProposalEdits({ ...cvProposalEdits, [proposal.id]: event.target.value })}
                  />
                  <div className="toolbar-row">
                    <button className="primary small" onClick={() => run("Accepting CV proposal", () => resolveCvProposal(proposal, "accept"))}>{isDe ? "Annehmen" : "Accept"}</button>
                    <button
                      className="secondary small"
                      disabled={!(cvProposalEdits[proposal.id] ?? "").trim()}
                      onClick={() => run("Applying edited CV proposal", () => resolveCvProposal(proposal, "edit"))}
                    >
                      {isDe ? "Bearbeitung anwenden" : "Apply edit"}
                    </button>
                    <button className="secondary small danger" onClick={() => run("Rejecting CV proposal", () => resolveCvProposal(proposal, "reject"))}>{isDe ? "Ablehnen" : "Reject"}</button>
                  </div>
                </details>
              ))}
              {!cvProposals.some((proposal) => proposal.status === "pending") ? <div className="empty-inline"><p>{isDe ? "Starte ein KI-Rewrite, um prüfbare Abschnittsvorschläge zu erstellen." : "Run an AI rewrite to create reviewable section proposals."}</p></div> : null}
            </div>
          </div>
        ) : null}

      </section>

      {showPreview ? (
      <div className="cv-resizer" onMouseDown={startPreviewResize} title={isDe ? "Ziehen zum Vergrößern der Vorschau" : "Drag to resize the preview"} role="separator" aria-orientation="vertical" />
      ) : null}
      {showPreview ? (
      <section className="preview-zone" ref={previewRef}>
        <div className="preview-zoom">
          <button onClick={() => adjustZoom(-0.1)} disabled={previewZoom <= 0.35} aria-label={isDe ? "Verkleinern" : "Zoom out"}>−</button>
          <span>{Math.round(previewZoom * 100)}%</span>
          <button onClick={() => adjustZoom(0.1)} disabled={previewZoom >= 1.2} aria-label={isDe ? "Vergrößern" : "Zoom in"}>+</button>
          <button
            className={`preview-zoom-reset${fitMode ? " active" : ""}`}
            onClick={() => setFitMode(true)}
            aria-pressed={fitMode}
          >
            {isDe ? "Anpassen" : "Fit"}
          </button>
        </div>
        <CvPreview profile={profileDraft} cv={selectedPreviewCv} zoom={previewZoom} paged master={previewCvId === "master" ? undefined : data.masterCv} isDe={isDe} />
      </section>
      ) : null}
      {showAddContent ? (
        <AddContentModal
          onClose={() => setShowAddContent(false)}
          onSelect={(template) => addSectionFromTemplate(template.kind, template.title)}
          isDe={isDe}
        />
      ) : null}
      {compareOpen && selectedStoredCv ? (
        <CvCompareView
          data={data}
          setData={setData}
          run={run}
          versionId={selectedStoredCv.id}
          isDe={isDe}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
      {historyOpen ? (
        <CvHistoryPicker
          data={data}
          setData={setData}
          run={run}
          cvId={previewCvId}
          filterKind={historyKind}
          isDe={isDe}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ProfileCard({ profile }: { profile: Profile }) {
  return (
    <article className="profile-card">
      <div>
        <h2>{profile.fullName}</h2>
        <p>{profile.headline}</p>
        <div className="contact-grid">
          <span>{profile.email}</span>
          <span>{profile.phone}</span>
          <span>{profile.location}</span>
        </div>
      </div>
      <div className="portrait">
        {profile.photoDataUrl ? <img src={profile.photoDataUrl} alt="" /> : profile.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
      </div>
    </article>
  );
}

const contentTemplatesDE: Array<{ kind: CvSection["kind"]; title: string; description: string }> = [
  { kind: "education", title: "Ausbildung", description: "Abschlüsse, Schulen, Schwerpunkte, Auszeichnungen, Auslandssemester." },
  { kind: "experience", title: "Berufserfahrung", description: "Stellen, Arbeitgeber, Zeitraum, Standort und messbare Erfolge." },
  { kind: "skills", title: "Kompetenzen", description: "Kompetenzgruppen, Tools, Methoden und Erfahrungsstufen." },
  { kind: "languages", title: "Sprachen", description: "Sprachen, Sprachniveaus und weitere Kommunikationsdetails." },
  { kind: "certificates", title: "Zertifikate", description: "Zertifizierungen, Lizenzen, Aussteller und Abschlussdaten." },
  { kind: "interests", title: "Interessen", description: "Relevante persönliche Interessen, die die Karrieregeschichte ergänzen." },
  { kind: "projects", title: "Projekte", description: "Projekte, Open-Source-Arbeit, Rolle, Stack und Ergebnis." },
  { kind: "courses", title: "Kurse", description: "Online- oder Präsenzkurse und abgeschlossene Weiterbildungen." },
  { kind: "awards", title: "Auszeichnungen", description: "Anerkennungen aus der Branche, von Wettbewerben oder der Wissenschaft." },
  { kind: "organisations", title: "Organisationen", description: "Mitgliedschaften oder Ehrenamt mit Rolle und Zeitraum." },
  { kind: "publications", title: "Publikationen", description: "Artikel, Bücher, Papers, Podcasts oder Vorträge." },
  { kind: "references", title: "Referenzen", description: "Referenzpersonen, Beziehung und Kontaktdaten." },
  { kind: "declaration", title: "Erklärung", description: "Persönliche Erklärung, Unterschrift oder Schlussstatement." },
  { kind: "speaking", title: "Lehre & Vorträge", description: "Lehrtätigkeiten, Workshops, Konferenzpräsentation und Gastvorlesungen." },
  { kind: "custom", title: "Benutzerdefiniert", description: "Ein leerer benutzerdefinierter Abschnitt für alles andere." },
];

function AddContentModal({
  onClose,
  onSelect,
  isDe,
}: {
  onClose: () => void;
  onSelect: (template: (typeof contentTemplates)[number]) => void;
  isDe: boolean;
}) {
  const templates = isDe ? contentTemplatesDE : contentTemplates;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="add-content-modal" role="dialog" aria-modal="true" aria-labelledby="add-content-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 id="add-content-title">{isDe ? "Abschnitt hinzufügen" : "Add content"}</h2>
            <p>{isDe ? "Wähle einen Abschnittstyp. Bestehende Kernabschnitte erhalten einen neuen Eintrag statt eines doppelten Abschnitts." : "Choose a section type. Existing core sections get a new logical entry instead of a duplicate section."}</p>
          </div>
          <button className="row-icon-button" onClick={onClose} title={isDe ? "Schließen" : "Close"}>
            <X size={18} />
          </button>
        </div>
        <div className="content-template-grid">
          {templates.map((template) => (
            <button key={`${template.kind}-${template.title}`} type="button" className="content-template-card" onClick={() => onSelect(contentTemplates.find((t) => t.kind === template.kind)!)}>
              <FileText size={18} />
              <span>
                <strong>{template.title}</strong>
                <small>{template.description}</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdownToHtml(value: string) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function plainishToHtml(value: string) {
  const lines = value.split(/\n/);
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      const nextList = bullet ? "ul" : "ol";
      if (list !== nextList) {
        closeList();
        html.push(`<${nextList}>`);
        list = nextList;
      }
      html.push(`<li>${inlineMarkdownToHtml((bullet ?? numbered)?.[1] ?? line)}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  }
  closeList();
  return html.join("") || "<p></p>";
}

function tiptapNodeText(node: JSONContent): string {
  if (node.type === "text") {
    let text = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") text = `**${text}**`;
      if (mark.type === "italic") text = `*${text}*`;
    }
    return text;
  }
  return (node.content ?? []).map(tiptapNodeText).join("");
}

function tiptapToPlainish(node: JSONContent): string {
  if (node.type === "doc") return (node.content ?? []).map(tiptapToPlainish).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (node.type === "paragraph") return tiptapNodeText(node);
  if (node.type === "bulletList") return (node.content ?? []).map((item) => `- ${tiptapNodeText(item).trim()}`).join("\n");
  if (node.type === "orderedList") return (node.content ?? []).map((item, index) => `${index + 1}. ${tiptapNodeText(item).trim()}`).join("\n");
  if (node.type === "listItem") return tiptapNodeText(node);
  return tiptapNodeText(node);
}

function RichTextEditor({ value, onChange, isDe }: { value: string; onChange: (value: string) => void; isDe: boolean }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: plainishToHtml(value),
    editorProps: {
      attributes: {
        class: "rich-editor-content",
      },
    },
    onUpdate: ({ editor }) => onChange(tiptapToPlainish(editor.getJSON())),
  });

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = tiptapToPlainish(editor.getJSON());
    if (current !== value.trim()) {
      editor.commands.setContent(plainishToHtml(value), { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return null;

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar" aria-label={isDe ? "Textformatierung" : "Text formatting"}>
        <button type="button" className={editor.isActive("bold") ? "active" : ""} onClick={() => editor.chain().focus().toggleBold().run()} title={isDe ? "Fett" : "Bold"}>
          <strong>B</strong>
        </button>
        <button type="button" className={editor.isActive("italic") ? "active" : ""} onClick={() => editor.chain().focus().toggleItalic().run()} title={isDe ? "Kursiv" : "Italic"}>
          <em>I</em>
        </button>
        <span />
        <button type="button" className={editor.isActive("bulletList") ? "active" : ""} onClick={() => editor.chain().focus().toggleBulletList().run()} title={isDe ? "Aufzählungsliste" : "Bullet list"}>
          {isDe ? "• Liste" : "• List"}
        </button>
        <button type="button" className={editor.isActive("orderedList") ? "active" : ""} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={isDe ? "Nummerierte Liste" : "Numbered list"}>
          {isDe ? "1. Liste" : "1. List"}
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

interface CvEntryDraft {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  body: string;
}

function dateLine(line: string) {
  return /^(\d{2}\/\d{4}|\d{4})\s*[–-]\s*(Present|\d{2}\/\d{4}|\d{4}|Heute|Aktuell)/i.test(line);
}

function splitDateTitle(line: string) {
  const match = line.match(/^((?:\d{2}\/\d{4}|\d{4})\s*[–-]\s*(?:Present|\d{2}\/\d{4}|\d{4}|Heute|Aktuell))\s+(.+)$/i);
  return { meta: match?.[1] ?? "", title: match?.[2] ?? line };
}

function titleish(line: string) {
  return line.length <= 72 && !line.startsWith("-") && !/[.!?]$/.test(line) && !/,\s*(and|or)\s+/i.test(line);
}

function splitTitleSubtitle(value: string) {
  const [title, ...rest] = value.split(",").map((part) => part.trim()).filter(Boolean);
  return { title: title || value, subtitle: rest.join(", ") };
}

function defaultEntryForKind(section: CvSection): CvEntryDraft {
  const id = `${section.id}_entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  if (section.kind === "experience") return { id, title: "New employer", subtitle: "Job title", meta: "MM/YYYY - Present", body: "- Add impact, scope, and proof points." };
  if (section.kind === "languages") return { id, title: "New language", subtitle: "Fluent", meta: "", body: "" };
  if (section.kind === "skills") return { id, title: "New skill group", subtitle: "Expert", meta: "", body: "Add tools, strengths, and keywords." };
  if (section.kind === "education") return { id, title: "Degree or program", subtitle: "School", meta: "MM/YYYY - MM/YYYY", body: "" };
  if (section.kind === "speaking") return { id, title: "Talk or course", subtitle: "Host", meta: "MM/YYYY", body: "Describe topic, audience, and outcome." };
  if (section.kind === "projects") return { id, title: "Project name", subtitle: "Role / stack / link", meta: "", body: "Describe the problem, your role, and the result." };
  if (section.kind === "certificates") return { id, title: "Certificate name", subtitle: "Issuer", meta: "YYYY", body: "" };
  if (section.kind === "courses") return { id, title: "Course name", subtitle: "Provider", meta: "YYYY", body: "" };
  if (section.kind === "awards") return { id, title: "Award name", subtitle: "Issuer", meta: "YYYY", body: "Why it matters." };
  if (section.kind === "organisations") return { id, title: "Organisation", subtitle: "Role", meta: "YYYY - Present", body: "" };
  if (section.kind === "publications") return { id, title: "Publication title", subtitle: "Publisher / link", meta: "YYYY", body: "Short context." };
  if (section.kind === "references") return { id, title: "Reference name", subtitle: "Relationship", meta: "", body: "Contact details or available on request." };
  if (section.kind === "declaration") return { id, title: "Declaration", subtitle: "", meta: "", body: "I confirm that the information provided is accurate." };
  if (section.kind === "profile") return { id, title: "Professional Summary", subtitle: "", meta: "", body: "Add another professional summary paragraph." };
  return { id, title: "New entry", subtitle: "", meta: "", body: "" };
}

function defaultSectionContent(section: CvSection) {
  return serializeCvEntries(section, [defaultEntryForKind(section)]);
}

function parseCvEntries(section: CvSection): CvEntryDraft[] {
  const lines = section.content.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [{ ...defaultEntryForKind(section), id: `${section.id}_entry_0` }];

  if (section.kind === "profile") {
    const blocks = section.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return (blocks.length ? blocks : [section.content.trim()]).map((block, index) => ({
      id: `${section.id}_entry_${index}`,
      title: index === 0 ? "Professional Summary" : `Professional Summary ${index + 1}`,
      subtitle: "",
      meta: "",
      body: block,
    }));
  }

  if (section.kind === "experience") {
    const chunks: string[][] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (dateLine(line) && current.length) {
        chunks.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length) chunks.push(current);
    return chunks.map((chunk, index) => {
      const first = splitDateTitle(chunk[0]);
      const split = splitTitleSubtitle(first.title);
      return {
        id: `${section.id}_entry_${index}`,
        title: split.title,
        subtitle: split.subtitle,
        meta: first.meta,
        body: chunk.slice(1).join("\n"),
      };
    });
  }

  if (section.kind === "skills") {
    const entries: CvEntryDraft[] = [];
    let current: CvEntryDraft | undefined;
    lines.forEach((line) => {
      if (titleish(line) && (!current || current.body.trim())) {
        if (current) entries.push(current);
        current = { id: `${section.id}_entry_${entries.length}`, title: line, subtitle: "", meta: "", body: "" };
      } else if (current) {
        current.body = [current.body, line].filter(Boolean).join("\n");
      }
    });
    if (current) entries.push(current);
    return entries.length ? entries : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim() }];
  }

  if (section.kind === "languages") {
    const blocks = section.content
      .split(/\n{2,}/)
      .map((block) => block.split(/\n/).map((line) => line.trim()).filter(Boolean))
      .filter((block) => block.length);
    const sourceBlocks = blocks.length > 1 ? blocks : [];
    if (!sourceBlocks.length) {
      for (let index = 0; index < lines.length; index += 2) {
        sourceBlocks.push(lines.slice(index, index + 2));
      }
    }
    const entries = sourceBlocks.map((block, index) => ({
      id: `${section.id}_entry_${index}`,
      title: block[0] ?? section.title,
      subtitle: block[1] ?? "",
      meta: "",
      body: block.slice(2).join("\n"),
    }));
    return entries.length ? entries : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim() }];
  }

  if (section.kind === "education" || section.kind === "speaking") {
    const entries = lines.map((line, index) => {
      const first = splitDateTitle(line);
      const split = splitTitleSubtitle(first.title);
      return { id: `${section.id}_entry_${index}`, title: split.title, subtitle: split.subtitle, meta: first.meta, body: "" };
    });
    return entries.length ? entries : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim() }];
  }

  if (section.kind === "projects") {
    const entries: CvEntryDraft[] = [];
    let current: CvEntryDraft | undefined;
    lines.forEach((line) => {
      if (/open source|github\.com/i.test(line) && titleish(line)) {
        if (current) entries.push(current);
        const split = splitTitleSubtitle(line);
        current = { id: `${section.id}_entry_${entries.length}`, title: split.title, subtitle: split.subtitle, meta: "", body: "" };
      } else if (current) {
        current.body = [current.body, line].filter(Boolean).join("\n");
      }
    });
    if (current) entries.push(current);
    return entries.length ? entries : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim() }];
  }

  return [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim() }];
}

function serializeCvEntries(section: CvSection, entries: CvEntryDraft[]) {
  if (section.kind === "profile") return entries.map((entry) => entry.body.trim()).filter(Boolean).join("\n\n");
  if (section.kind === "skills") return entries.map((entry) => `${entry.title}\n${entry.body}`.trim()).join("\n");
  if (section.kind === "languages") return entries.map((entry) => [entry.title, entry.subtitle, entry.body].filter(Boolean).join("\n").trim()).join("\n\n");
  return entries.map((entry) => {
    const title = [entry.title, entry.subtitle].filter(Boolean).join(", ");
    return [entry.meta ? `${entry.meta} ${title}` : title, entry.body].filter(Boolean).join("\n").trim();
  }).join("\n");
}

// Thin wrapper over the shared SSOT so the preview font matches the PDF font exactly.
function cvFontFamily(font: string) {
  return cvFontStack(font);
}

function inlineFormatted(text: string) {
  const nodes: Array<string | ReactElement> = [];
  const pattern = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const value = match[0];
    const link = value.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) nodes.push(<a key={`a-${index}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>);
    else if (value.startsWith("**")) nodes.push(<strong key={`b-${index}`}>{value.slice(2, -2)}</strong>);
    else nodes.push(<em key={`i-${index}`}>{value.slice(1, -1)}</em>);
    last = match.index + value.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderCvContent(content: string) {
  const elements: ReactElement[] = [];
  const lines = content.split(/\n/);
  let listItems: string[] = [];
  const flushList = () => {
    if (!listItems.length) return;
    elements.push(<ul key={`ul-${elements.length}`}>{listItems.map((item, index) => <li key={index}>{inlineFormatted(item)}</li>)}</ul>);
    listItems = [];
  };

  lines.forEach((line, index) => {
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.+)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }
    flushList();
    if (!line.trim()) return;
    elements.push(<p key={`p-${index}`}>{inlineFormatted(line)}</p>);
  });
  flushList();
  return elements;
}

function renderCvSectionContent(section: CvSection, style?: CvDocument["style"]) {
  return <div dangerouslySetInnerHTML={{ __html: cvSectionContentHtml(section, { groupSameEmployer: style?.groupSameEmployer }) }} />;
}

function ContactLine({ icon: Icon, value, showIcons }: { icon: LucideIcon; value?: string; showIcons: boolean }) {
  if (!value) return null;
  return (
    <span>
      {showIcons ? <Icon size={13} strokeWidth={2.4} /> : null}
      {value}
    </span>
  );
}

function CvHeaderBlock({ profile, cv, innerRef }: { profile: Profile; cv: CvDocument | CvVersion; innerRef?: (node: HTMLElement | null) => void }) {
  const showContactIcons = cv.style.showContactIcons !== false;
  const personalDataItems = cvPersonalDataItems(profile);
  const personalIcon = { nationality: Flag, workPermit: BadgeCheck, dateOfBirth: Calendar } as const;
  return (
    <header className="cv-header" ref={innerRef}>
      {cv.style.showPhoto ? (
        <div className="portrait large">
          {profile.photoDataUrl ? <img src={profile.photoDataUrl} alt="" /> : profile.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2)}
        </div>
      ) : null}
      <div>
        <h2>{profile.fullName}</h2>
        <p>{("headline" in cv && cv.headline?.trim()) ? cv.headline : profile.headline}</p>
        <div className="cv-contact">
          <ContactLine icon={Mail} value={profile.email} showIcons={showContactIcons} />
          <ContactLine icon={Phone} value={profile.phone} showIcons={showContactIcons} />
          <ContactLine icon={MapPin} value={profile.location} showIcons={showContactIcons} />
          <ContactLine icon={Linkedin} value={profile.linkedin} showIcons={showContactIcons} />
          <ContactLine icon={Github} value={profile.github} showIcons={showContactIcons} />
          <ContactLine icon={Globe2} value={profile.website} showIcons={showContactIcons} />
        </div>
        {personalDataItems.length ? (
          <div className="personal-data">
            {personalDataItems.map((item) => (
              <ContactLine key={item.key} icon={personalIcon[item.key]} value={item.value} showIcons={showContactIcons} />
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}

// Decode base64 PDF bytes (from the cv:preview-pdf IPC) into the Uint8Array pdf.js expects.
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// A content fingerprint of everything that changes the rendered PDF. selectedPreviewCv is rebuilt
// as a fresh object on EVERY render (see previewVersion), so keying the regen effect on object
// identity would re-render the PDF on every keystroke/zoom. We key on this signature instead. The
// portrait is fingerprinted by length (not its full base64) to keep the per-render cost trivial.
function cvPreviewSignature(profile: Profile, cv: CvDocument | CvVersion, master?: CvDocument | CvVersion | null): string {
  const photo = profile.photoDataUrl ? `len:${profile.photoDataUrl.length}` : "";
  return JSON.stringify([
    { ...profile, photoDataUrl: photo },
    cv.template,
    cv.style,
    cv.sections,
    master ? [master.id, master.template, master.style, master.sections] : null,
  ]);
}

// Chromium-as-truth preview: render the LIVE draft through the SAME printToPDF path as the export
// (cv:preview-pdf), then paint each PDF page to a supersampled canvas via pdf.js. The preview IS
// the export — identical pagination, identical fit-to-target scaling, no drift. Regeneration is
// debounced; the last good pages stay on screen while a newer render is in flight.
function PdfCvPreview({ profile, cv, zoom, master, isDe = false }: { profile: Profile; cv: CvDocument | CvVersion; zoom: number; master?: CvDocument | CvVersion; isDe?: boolean }) {
  const [pages, setPages] = useState<{ src: string; w: number; h: number }[]>([]);
  const [status, setStatus] = useState<"busy" | "idle" | "error">("busy");
  const [errMsg, setErrMsg] = useState<string>("");
  const reqRef = useRef(0);
  const sig = cvPreviewSignature(profile, cv, master);

  useEffect(() => {
    const req = (reqRef.current += 1);
    setStatus("busy");
    const timer = setTimeout(async () => {
      try {
        const { pdfBase64 } = await jobCentral().previewCvPdf({ profile, cv, master: master ?? null });
        if (req !== reqRef.current) return; // a newer edit superseded this render
        const loadingTask = pdfjsLib.getDocument({ data: base64ToBytes(pdfBase64) });
        const doc = await loadingTask.promise;
        const rendered: { src: string; w: number; h: number }[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          if (req !== reqRef.current) { void loadingTask.destroy(); return; }
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const cssScale = PAPER_WIDTH / base.width;        // display each page at the app's 794px A4 width
          const viewport = page.getViewport({ scale: cssScale * 2 }); // 2× supersample for crisp text
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          rendered.push({ src: canvas.toDataURL("image/png"), w: base.width * cssScale, h: base.height * cssScale });
        }
        void loadingTask.destroy();
        if (req !== reqRef.current) return;
        setPages(rendered);
        setStatus("idle");
      } catch (error) {
        if (req !== reqRef.current) return;
        console.error("CV PDF preview failed", error);
        setErrMsg(error instanceof Error ? error.message : String(error));
        setStatus("error");
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content signature, not object identity
  }, [sig]);

  return (
    <>
      {/* Small spinner pill while a debounced regen is in flight. Kept mounted (not remounted) once
          pages exist so it can FADE in/out via opacity; its negative margin reclaims its own height
          so the pages never shift. The current pages stay crisp underneath — no flicker. */}
      {pages.length ? (
        <div className={`cv-pdf-spinner-pill${status === "busy" ? " is-on" : ""}`} aria-hidden={status !== "busy"}>
          <span className="cv-pdf-spinner" />
          {isDe ? "Aktualisiere…" : "Updating…"}
        </div>
      ) : null}
      {status === "error" ? <div className="cv-pdf-banner cv-pdf-banner--error" title={errMsg}>{(isDe ? "Vorschau fehlgeschlagen: " : "Preview failed: ") + (errMsg || (isDe ? "unbekannter Fehler" : "unknown error"))}</div> : null}
      <div className="cv-page-stack" style={{ zoom: zoom !== 1 ? zoom : undefined }}>
        {!pages.length && status === "busy" ? <div className="cv-pdf-skeleton" style={{ width: PAPER_WIDTH, height: Math.round(PAPER_WIDTH * 1.414) }} /> : null}
        {pages.map((page, index) => (
          <div key={index} className="cv-pdf-page" style={{ width: page.w, height: page.h }}>
            <img src={page.src} width={page.w} height={page.h} alt="" draggable={false} />
            <span className="cv-sheet-num">{index + 1}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function CvPreview({ profile, cv, zoom = 1, paged = false, master, isDe = false }: { profile: Profile; cv: CvDocument | CvVersion; zoom?: number; paged?: boolean; master?: CvDocument | CvVersion; isDe?: boolean }) {
  if (paged) return <PdfCvPreview profile={profile} cv={cv} zoom={zoom} master={master} isDe={isDe} />;
  const style = {
    "--accent": cv.style.accentColor,
    fontFamily: cvFontFamily(cv.style.font),
    zoom: zoom !== 1 ? zoom : undefined,
  } as CSSProperties;
  return (
    <>
      {/* Single source of truth for the CV look — the SAME stylesheet the PDF export
          embeds, so preview and PDF can never drift. Scoped under `.paper`; injected
          here (after styles.css) so it is authoritative. */}
      <style>{CV_PAPER_CSS}</style>
      <div className={`paper template-${cv.template} density-${cv.style.density}`} style={style}>
        <CvHeaderBlock profile={profile} cv={cv} />
        {cv.sections
          .filter((section) => section.enabled)
          .map((section) => (
            <section className="cv-section" key={section.id}>
              <h3>{section.title}</h3>
              {renderCvSectionContent(section, cv.style)}
            </section>
          ))}
      </div>
    </>
  );
}

function LettersView({
  data,
  setData,
  run,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
}) {
  const isDe = data.settings.language === "de";
  const [jobId, setJobId] = useState(data.jobPosts[0]?.id ?? "");
  const [language, setLanguage] = useState<"en" | "de">(data.settings.language);
  const [instructions, setInstructions] = useState("");
  const [letterSearch, setLetterSearch] = useState("");
  const selectedJob = data.jobPosts.find((job) => job.id === jobId);
  const selectedLetter = data.coverLetters.find((letter) => letter.jobId === jobId && letter.language === language) ?? data.coverLetters[0];
  const [draft, setDraft] = useState<CoverLetter | null>(selectedLetter ?? null);
  const filteredLetters = data.coverLetters.filter((letter) => {
    const job = data.jobPosts.find((item) => item.id === letter.jobId);
    const haystack = `${letter.title ?? ""} ${letter.content ?? ""} ${job?.company ?? ""} ${job?.title ?? ""}`.toLowerCase();
    return haystack.includes(letterSearch.trim().toLowerCase());
  });

  useEffect(() => {
    setDraft(selectedLetter ? { ...selectedLetter, content: cleanUserText(selectedLetter.content) } : null);
  }, [selectedLetter?.id]);

  return (
    <div className="letters-layout">
      <section className="letters-panel">
        <div className="letters-controls">
          <label>Job
            <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
              {data.jobPosts.map((job) => (
                <option key={job.id} value={job.id}>{job.company} - {job.title}</option>
              ))}
            </select>
          </label>
          <label>{isDe ? "Sprache" : "Language"}
            <select value={language} onChange={(event) => setLanguage(event.target.value as "en" | "de")}>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
          </label>
        </div>
        <label>{isDe ? "KI-Anweisung" : "AI direction"}
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={isDe ? "z.B. formell, Frontend-Erfahrung und KI-Kompetenz erwähnen" : "e.g. German, formal, mention frontend leadership and practical AI governance"}
          />
        </label>
        <button
          className="primary wide"
          disabled={!jobId}
          onClick={() =>
            run(isDe ? "Schreiben wird erstellt" : "Generating letter", () =>
              jobCentral()
                .generateCoverLetter({ jobId, language, instructions })
                .then((next) => {
                  setData(next);
                  const created = next.coverLetters.find((letter) => letter.jobId === jobId && letter.language === language) ?? null;
                  setDraft(created ? { ...created, content: cleanUserText(created.content) } : null);
                  return next;
                }),
            )
          }
        >
          <Sparkles size={18} /> {isDe ? "Motivationsschreiben erstellen" : "Generate cover letter"}
        </button>

        <input
          className="search-input"
          value={letterSearch}
          onChange={(event) => setLetterSearch(event.target.value)}
          placeholder={isDe ? "Schreiben suchen" : "Search letters"}
        />
        <div className="letter-list">
          {filteredLetters.map((letter) => {
            const job = data.jobPosts.find((item) => item.id === letter.jobId);
            return (
              <button
                key={letter.id}
                className={draft?.id === letter.id ? "selected" : ""}
                onClick={() => {
                  setDraft({ ...letter, content: cleanUserText(letter.content) });
                  setJobId(letter.jobId);
                  setLanguage(letter.language);
                }}
              >
                <strong>{letter.title}</strong>
                <span>{job?.company} · {letter.language.toUpperCase()}</span>
              </button>
            );
          })}
          {!filteredLetters.length ? (
            <div className="empty-list">{isDe ? "Keine Schreiben gefunden." : "No letters found."}</div>
          ) : null}
        </div>
      </section>
      <section className="letter-editor">
        {draft ? (
          <>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
            <div className="toolbar-row">
              <button
                className="primary"
                onClick={() => run(isDe ? "Schreiben wird gespeichert" : "Saving letter", () => jobCentral().saveCoverLetter(draft).then((next) => (setData(next), next)))}
              >
                <Save size={18} /> {isDe ? "Schreiben speichern" : "Save letter"}
              </button>
              <button
                className="secondary danger"
                onClick={() =>
                  confirmDestructive(isDe ? `Motivationsschreiben '${draft.title}' löschen?` : `Delete motivation letter "${draft.title}"?`)
                    ? run(isDe ? "Schreiben wird gelöscht" : "Deleting letter", () =>
                      jobCentral().deleteCoverLetter(draft.id).then((next) => {
                        setData(next);
                        setDraft(next.coverLetters[0] ?? null);
                        return next;
                      }),
                    )
                    : undefined
                }
              >
                <Trash2 size={18} /> {isDe ? "Löschen" : "Delete"}
              </button>
              <button
                className="secondary"
                onClick={() =>
                  run(
                    isDe ? "PDF wird exportiert" : "Exporting motivation",
                    () => jobCentral().generateCoverLetterPdf(draft.id).then((result) => (setData(result.data), result)),
                    pdfResultMessage,
                  )
                }
              >
                <Download size={18} /> PDF
              </button>
            </div>
            {draft.pdfPath ? <small className="file-path">{draft.pdfPath}</small> : null}
          </>
        ) : (
          <div className="empty-letter">
            <h2>{selectedJob ? selectedJob.company : (isDe ? "Job auswählen" : "Select a job")}</h2>
            <p>{isDe ? "Erstelle ein passendes Schreiben und bearbeite es vor dem Versand." : "Generate a job-specific letter, then edit it manually before sending."}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function JobTracker({
  data,
  setData,
  run,
  selectedApplication,
  selectedJob,
  onSelect,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  selectedApplication?: JobApplication;
  selectedJob?: JobPost;
  onSelect: (id: string) => void;
}) {
  const isDe = data.settings.language === "de";
  const [newJob, setNewJob] = useState({ company: "", title: "", location: "Switzerland", url: "", description: "" });
  const [draggingApplicationId, setDraggingApplicationId] = useState<string | null>(null);
  const [jobDraft, setJobDraft] = useState<JobPost | null>(selectedJob ?? null);

  useEffect(() => {
    setJobDraft(selectedJob ?? null);
  }, [selectedJob?.id, selectedJob?.company, selectedJob?.title, selectedJob?.location, selectedJob?.url, selectedJob?.description]);

  function moveApplication(applicationId: string, status: ApplicationStatus) {
    const application = data.applications.find((item) => item.id === applicationId);
    if (!application || application.status === status) return;
    onSelect(applicationId);
    void run(isDe ? "Job verschieben" : "Moving job", () =>
      jobCentral()
        .updateApplication({ applicationId, status })
        .then((next) => (setData(next), next)),
    );
  }

  async function runJobAi(purpose: AiPlan["purpose"], title: string) {
    if (!selectedJob?.id) return data;
    const created = await jobCentral().createAiPlan({ purpose, title, jobId: selectedJob.id, cvVersionId: selectedApplication?.cvVersionId });
    const plan = newestPlan(created.aiPlans, (item) => item.purpose === purpose && item.relatedJobId === selectedJob.id && item.title === title);
    setData(created);
    if (!plan) return created;
    const ran = await jobCentral().runAiPlan(plan.id);
    setData(ran);
    return ran;
  }

  async function saveSelectedJob() {
    if (!jobDraft) return data;
    const next = await jobCentral().updateJob(jobDraft);
    setData(next);
    return next;
  }

  async function deleteSelectedApplication() {
    if (!selectedApplication) return data;
    const next = await jobCentral().deleteApplication(selectedApplication.id);
    setData(next);
    onSelect(next.applications[0]?.id ?? "");
    return next;
  }

  async function clearRejectedApplications() {
    // Skip ARCHIVED rejected apps: archiving is the user's "keep this, recoverable" signal,
    // so a permanent "clear rejected" must not purge what they deliberately set aside.
    const rejected = data.applications.filter((application) => application.status === "rejected" && !application.archivedAt);
    let next = data;
    for (const application of rejected) {
      next = await jobCentral().deleteApplication(application.id);
    }
    setData(next);
    onSelect(next.applications[0]?.id ?? "");
    return next;
  }

  return (
    <div className="jobs-layout">
      <section className="planner">
        <div className="tracker-strip">
          <div>
            <strong>{data.applications.filter((app) => actionState(app).tone === "bad").length}</strong>
            <span>{isDe ? "Uberfällig" : "overdue"}</span>
          </div>
          <div>
            <strong>{data.applications.filter((app) => app.status === "interview").length}</strong>
            <span>{isDe ? "Vorstellungsgesprache" : "interviews"}</span>
          </div>
          <div>
            <strong>{data.applications.filter((app) => app.cvVersionId).length}</strong>
            <span>{isDe ? "Lebensläufe gesendet" : "CVs sent"}</span>
          </div>
          <button
            className="tracker-strip-action"
            disabled={!data.applications.some((app) => app.status === "rejected" && !app.archivedAt)}
            onClick={() =>
              confirmDestructive(isDe ? "Alle abgelehnten Jobs endgültig löschen? (Archivierte bleiben erhalten.)" : "Permanently delete all rejected jobs? (Archived ones are kept.)")
                ? run(isDe ? "Abgelehnte Jobs löschen" : "Clearing rejected jobs", clearRejectedApplications)
                : undefined
            }
          >
            <strong>{data.applications.filter((app) => app.status === "rejected" && !app.archivedAt).length}</strong>
            <span>{isDe ? "Abgelehnte löschen" : "clear rejected"}</span>
          </button>
        </div>
        {statusOrder.map((status) => {
          const apps = data.applications.filter((app) => app.status === status && !app.archivedAt);
          return (
            <div
              className={`lane ${draggingApplicationId ? "drop-ready" : ""}`}
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggingApplicationId) return;
                moveApplication(draggingApplicationId, status);
                setDraggingApplicationId(null);
              }}
            >
              <h2>{statusLabels[status]} <span>{apps.length}</span></h2>
              {apps.map((app) => {
                const job = data.jobPosts.find((item) => item.id === app.jobPostId);
                return (
                  <button
                    key={app.id}
                    draggable
                    className={`job-card ${selectedApplication?.id === app.id ? "selected" : ""}`}
                    onClick={() => onSelect(app.id)}
                    onDragStart={() => {
                      setDraggingApplicationId(app.id);
                      onSelect(app.id);
                    }}
                    onDragEnd={() => setDraggingApplicationId(null)}
                  >
                    <GripVertical size={16} />
                    <strong>{job?.company ?? (isDe ? "Unbekannt" : "Unknown")}</strong>
                    <span>{job?.title}</span>
                    <small className={`action-state ${actionState(app).tone}`}>{actionState(app).label}</small>
                  </button>
                );
              })}
            </div>
          );
        })}
      </section>

      <aside className="detail-panel">
        <div className="detail-card">
          <div className="detail-title">
            <div>
              <h2>{selectedJob?.company ?? (isDe ? "Kein Job ausgewählt" : "No job selected")}</h2>
              <p>{selectedJob?.title}</p>
            </div>
            {selectedJob?.url ? (
              <a href={selectedJob.url} target="_blank" rel="noreferrer" title={isDe ? "Öffnen" : "Open"}>
                <ExternalLink size={18} />
              </a>
            ) : null}
          </div>

          {selectedApplication ? (
            <>
              <div className="quick-actions">
                <button
                  className="secondary"
                  onClick={() => run(isDe ? "Job bewerten" : "Evaluating job", () => runJobAi("evaluate_job", `Evaluate ${selectedJob?.company ?? "job"}`))}
                >
                  <Sparkles size={16} /> {isDe ? "Bewerten" : "Evaluate"}
                </button>
                <button
                  className="secondary"
                  onClick={() => run(isDe ? "Vorbereitung auf Vorstellungsgespräch" : "Preparing interview", () => runJobAi("interview_prep", `Interview prep ${selectedJob?.company ?? "job"}`))}
                >
                  <BriefcaseBusiness size={16} /> {isDe ? "Vorbereiten" : "Prep"}
                </button>
                <button
                  className="secondary"
                  onClick={() => run(isDe ? "Follow-up schreiben" : "Writing follow-up", () => runJobAi("follow_up", `Follow up ${selectedJob?.company ?? "job"}`))}
                >
                  <Archive size={16} /> {isDe ? "Nachfassen" : "Follow up"}
                </button>
              </div>
              {jobDraft ? (
                <div className="job-edit-box">
                  <input value={jobDraft.company} onChange={(event) => setJobDraft({ ...jobDraft, company: event.target.value })} placeholder={isDe ? "Unternehmen" : "Company"} />
                  <input value={jobDraft.title} onChange={(event) => setJobDraft({ ...jobDraft, title: event.target.value })} placeholder={isDe ? "Stelle" : "Title"} />
                  <input value={jobDraft.location} onChange={(event) => setJobDraft({ ...jobDraft, location: event.target.value })} placeholder={isDe ? "Ort" : "Location"} />
                  <input value={jobDraft.url} onChange={(event) => setJobDraft({ ...jobDraft, url: event.target.value })} placeholder="URL" />
                  <textarea value={jobDraft.description} onChange={(event) => setJobDraft({ ...jobDraft, description: event.target.value })} placeholder={isDe ? "Jobbeschreibung / Passungsnotizen" : "Job description / fit notes"} />
                  <div className="toolbar-row">
                    <button className="secondary" onClick={() => run(isDe ? "Job speichern" : "Saving job", saveSelectedJob)}><Save size={16} /> {isDe ? "Speichern" : "Save job"}</button>
                    <button
                      className="secondary danger"
                      onClick={() =>
                        confirmDestructive(isDe ? `Bewerbung für ${selectedJob?.company ?? "diesen Job"} löschen?` : `Delete application for ${selectedJob?.company ?? "this job"}?`)
                          ? run(isDe ? "Job löschen" : "Deleting job", deleteSelectedApplication)
                          : undefined
                      }
                    >
                      <Trash2 size={16} /> {isDe ? "Löschen" : "Delete"}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="field-grid">
                <label>
                  Status
                  <select
                    value={selectedApplication.status}
                    onChange={(event) => {
                      const status = event.target.value as ApplicationStatus;
                      void run(isDe ? "Status aktualisieren" : "Updating status", () =>
                        jobCentral()
                          .updateApplication({ applicationId: selectedApplication.id, status })
                          .then((next) => (setData(next), next)),
                      );
                    }}
                  >
                    {Object.entries(statusLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {isDe ? "CV gesendet" : "CV sent"}
                  <select
                    value={selectedApplication.cvVersionId ?? ""}
                    onChange={(event) => {
                      const cvVersionId = event.target.value || undefined;
                      void run(isDe ? "CV verknüpfen" : "Linking CV", () =>
                        jobCentral()
                          .updateApplication({ applicationId: selectedApplication.id, cvVersionId })
                          .then((next) => (setData(next), next)),
                      );
                    }}
                  >
                    <option value="">{isDe ? "Keines" : "None"}</option>
                    {data.cvVersions.map((cv) => (
                      <option key={cv.id} value={cv.id}>
                        {cv.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {isDe ? "Nächste Aktion" : "Next action"}
                  <input
                    type="date"
                    value={selectedApplication.nextActionAt ?? ""}
                    onClick={(event) => { try { event.currentTarget.showPicker(); } catch { /* unsupported */ } }}
                    onChange={(event) => {
                      const nextActionAt = event.target.value;
                      void run(isDe ? "Datum speichern" : "Saving date", () =>
                        jobCentral()
                          .updateApplication({ applicationId: selectedApplication.id, nextActionAt })
                          .then((next) => (setData(next), next)),
                      );
                    }}
                  />
                </label>
              </div>

              <label className="notes">
                {isDe ? "Notizen" : "Notes"}
                <textarea
                  value={selectedApplication.notes}
                  onChange={(event) =>
                    setData({
                      ...data,
                      applications: data.applications.map((item) => (item.id === selectedApplication.id ? { ...item, notes: event.target.value } : item)),
                    })
                  }
                  onBlur={(event) => {
                    const notes = event.currentTarget.value;
                    void run(isDe ? "Notizen speichern" : "Saving notes", () =>
                      jobCentral()
                        .updateApplication({ applicationId: selectedApplication.id, notes })
                        .then((next) => (setData(next), next)),
                    );
                  }}
                />
              </label>

              <div className="timeline">
                <h3><History size={16} /> {isDe ? "Verlauf" : "History"}</h3>
                {selectedApplication.events.map((event) => (
                  <div className="timeline-item" key={event.id}>
                    <span />
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.detail}</p>
                      <small>{new Date(event.createdAt).toLocaleString()}</small>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="detail-card">
          <h2>{isDe ? "Job hinzufügen" : "Add job"}</h2>
          <div className="field-grid single">
            <input placeholder={isDe ? "Unternehmen" : "Company"} value={newJob.company} onChange={(event) => setNewJob({ ...newJob, company: event.target.value })} />
            <input placeholder={isDe ? "Stelle" : "Title"} value={newJob.title} onChange={(event) => setNewJob({ ...newJob, title: event.target.value })} />
            <input placeholder={isDe ? "Ort" : "Location"} value={newJob.location} onChange={(event) => setNewJob({ ...newJob, location: event.target.value })} />
            <input placeholder="URL" value={newJob.url} onChange={(event) => setNewJob({ ...newJob, url: event.target.value })} />
          </div>
          <button
            className="primary wide"
            onClick={() =>
              run(isDe ? "Job hinzufügen" : "Adding job", () =>
                jobCentral()
                  .createJob({ ...newJob, sourcePortalId: undefined, score: undefined })
                  .then((next) => {
                    setData(next);
                    setNewJob({ company: "", title: "", location: "Switzerland", url: "", description: "" });
                    return next;
                  }),
              )
            }
          >
            <Plus size={18} /> {isDe ? "Hinzufügen" : "Add job"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function SettingsView({
  data,
  setData,
  run,
  mirrorStatus,
}: {
  data: AppData;
  setData: (data: AppData) => void;
  run: <T>(label: string, task: () => Promise<T>, done?: (value: T) => string) => Promise<T | undefined>;
  mirrorStatus: MirrorSyncStatus | null;
}) {
  const [portalDraft, setPortalDraft] = useState<JobPortal>(data.portals[0] ?? emptyPortal());
  const [adzId, setAdzId] = useState(data.settings.adzuna?.appId ?? "");
  const [adzKey, setAdzKey] = useState(data.settings.adzuna?.appKey ?? "");
  const isDe = data.settings.language === "de";
  // Settings are grouped into top tabs so everyday toggles, API keys, and the destructive
  // reset don't all live in one overwhelming scroll. One tab's sections render at a time.
  const [tab, setTab] = useState<"general" | "ai" | "jobs" | "docs" | "data">("general");
  const settingsTabs = [
    { key: "general", label: isDe ? "Allgemein" : "General", Icon: Settings },
    { key: "ai", label: "AI", Icon: Bot },
    { key: "jobs", label: isDe ? "Jobsuche" : "Job search", Icon: Globe2 },
    { key: "docs", label: isDe ? "Dokumente" : "Documents", Icon: FolderOpen },
    { key: "data", label: isDe ? "Daten" : "Data", Icon: Trash2 },
  ] as const;
  useEffect(() => {
    const current = data.portals.find((portal) => portal.id === portalDraft.id);
    setPortalDraft(current ?? data.portals[0] ?? emptyPortal());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.portals]);

  return (
    <div className="settings-view">
      <div className="settings-tabs" role="tablist">
        {settingsTabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <div className="settings-tab-body">
      {tab === "general" ? (
      <section className="settings-panel">
        <h2><Settings size={18} /> {isDe ? "Allgemein" : "General"}</h2>
        <div className="field-grid single">
          <select
            value={data.settings.language}
            onChange={(event) => {
              // Capture the selected value synchronously: run() defers the task, and by the
              // time it executes React has reset this controlled <select> back to the current
              // language, so reading event.target.value lazily would always send the OLD value.
              const value = event.target.value as "en" | "de";
              void run(isDe ? "Sprache wird gespeichert" : "Saving language", () =>
                jobCentral().setLanguage(value).then((next) => (setData(next), next)),
              );
            }}
          >
            <option value="en">English UI</option>
            <option value="de">Deutsch UI</option>
          </select>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={data.settings.naturalWriting !== false}
            onChange={(event) => {
              // Capture synchronously — run() defers, and the controlled checkbox would
              // otherwise be read back at its pre-change value (same footgun as the language select).
              const on = event.target.checked;
              void run(isDe ? "Schreibstil wird gespeichert" : "Saving writing style", () =>
                jobCentral().setNaturalWriting(on).then((next) => (setData(next), next)),
              );
            }}
          />
          <span>
            <strong>{isDe ? "Natürliche, menschliche Sprache" : "Natural, human wording"}</strong>
            <span className="panel-help">
              {isDe
                ? "KI-Texte (Lebenslauf, Anschreiben, Optimierung) vermeiden Gedankenstriche (—), KI-Floskeln und schablonenhafte Formulierungen, damit sie nicht „nach KI“ klingen. Zum polierten/journalistischen Ton ausschalten. Fakten bleiben immer unverändert — die KI erfindet nie etwas."
                : "AI text (CVs, cover letters, optimize) avoids em dashes (—), AI buzzwords and formulaic phrasing so it doesn't read “like AI”. Turn off for a polished/editorial tone (journalist/PR). Facts are never affected — the AI never invents anything."}
            </span>
          </span>
        </label>
        <button
          className="secondary wide"
          onClick={() => run(isDe ? "Einrichtungsassistent wird gestartet" : "Restarting setup", () => jobCentral().restartOnboarding().then((next) => (setData(next), next)))}
        >
          <Sparkles size={16} /> {isDe ? "Einrichtungsassistent erneut starten" : "Run setup wizard again"}
        </button>
      </section>
      ) : null}
      {tab === "jobs" ? (
      <section className="settings-panel">
        <h2><Globe2 size={18} /> {isDe ? "Adzuna-Jobsuche" : "Adzuna job search"}</h2>
        <div className="adzuna-keys">
          <strong>{isDe ? "Adzuna-Jobsuche (optional)" : "Adzuna job search (optional)"}</strong>
          <span className="panel-help">
            {isDe
              ? "Eigener kostenloser API-Schlüssel für breite Schweizer Jobsuche — bleibt nur auf diesem Gerät."
              : "Your own free API key for broad Swiss coverage — stays on this device only."}
          </span>
          <input placeholder="Adzuna App ID" value={adzId} onChange={(event) => setAdzId(event.target.value)} spellCheck={false} />
          <input placeholder="Adzuna App Key" type="password" value={adzKey} onChange={(event) => setAdzKey(event.target.value)} spellCheck={false} />
          <div className="toolbar-row">
            <button
              className="secondary"
              onClick={() => run(isDe ? "Adzuna-Schlüssel wird gespeichert" : "Saving Adzuna key", () =>
                jobCentral().updateAdzunaCredentials({ appId: adzId.trim(), appKey: adzKey.trim(), country: data.settings.defaultCountry || "ch" }).then((next) => (setData(next), next)),
              )}
            >
              <RefreshCw size={15} /> {isDe ? "Speichern" : "Save"}
            </button>
            <a href="https://developer.adzuna.com/" target="_blank" rel="noreferrer" className="link-like">
              <ExternalLink size={14} /> developer.adzuna.com
            </a>
          </div>
        </div>
      </section>
      ) : null}
      {tab === "data" ? (
      <section className="settings-panel">
        <h2><Trash2 size={18} /> {isDe ? "Daten" : "Data"}</h2>
        <div className="danger-zone">
          <div>
            <strong>{isDe ? "Alles zurücksetzen" : "Reset everything"}</strong>
            <span>{isDe ? "Löscht Profil, CVs, Anschreiben, Jobs und Einstellungen auf diesem Gerät. Nicht umkehrbar." : "Deletes your profile, CVs, cover letters, jobs and settings on this device. Cannot be undone."}</span>
          </div>
          <button
            className="danger-button wide"
            onClick={() => run(isDe ? "Alle Daten werden zurückgesetzt" : "Resetting all data", () => jobCentral().resetAllData().then((next) => (setData(next), next)))}
          >
            <Trash2 size={16} /> {isDe ? "Alles löschen" : "Erase all data"}
          </button>
        </div>
      </section>
      ) : null}

      {tab === "docs" ? (
      <section className="settings-panel">
        <h2><FolderOpen size={18} /> {isDe ? "Dokumentenordner" : "Document folder"}</h2>
        <span className="panel-help">
          {isDe
            ? "Wähle einen Ordner — Job Central legt dort automatisch alle CVs, Anschreiben und dein Profil ab (als .md, .pdf und .docx), pro Job ein Unterordner. Deine Daten bleiben in der App; der Ordner ist eine durchsuchbare Kopie."
            : "Pick a folder — Job Central keeps a tidy copy of every CV, letter and your profile there (as .md, .pdf and .docx), one sub-folder per job. Your data still lives in the app; the folder is a browsable mirror."}
        </span>
        {(() => {
          const folder = data.settings.workspaceFolder;
          const state = mirrorStatus?.state ?? (folder?.enabled ? "idle" : "disabled");
          const stateLabel =
            state === "syncing" ? (isDe ? "Synchronisiert…" : "Syncing…")
            : state === "ok" ? (isDe ? "Synchronisiert" : "Synced")
            : state === "error" ? (isDe ? "Fehler" : "Error")
            : state === "idle" ? (isDe ? "Bereit" : "Ready")
            : (isDe ? "Aus" : "Off");
          return (
            <>
              <div className={`mirror-status mirror-${state}`}>
                <span className="mirror-dot" />
                <div>
                  <strong>{stateLabel}</strong>
                  <span>
                    {folder?.rootPath
                      ? folder.rootPath
                      : isDe ? "Noch kein Ordner gewählt." : "No folder chosen yet."}
                  </span>
                  {state === "error" && mirrorStatus?.lastError ? <span className="mirror-error">{mirrorStatus.lastError}</span> : null}
                </div>
              </div>
              <div className="toolbar-row">
                <button
                  className="primary"
                  onClick={() => run(isDe ? "Ordner wählen" : "Choosing folder", () => jobCentral().selectMirrorFolder().then((next) => (setData(next), next)))}
                >
                  <FolderOpen size={15} /> {folder?.rootPath ? (isDe ? "Ordner ändern" : "Change folder") : (isDe ? "Ordner wählen" : "Choose folder")}
                </button>
                {folder?.rootPath ? (
                  <>
                    <button className="secondary" onClick={() => void jobCentral().openMirrorPath({ target: "root" })}>
                      <ExternalLink size={15} /> {isDe ? "Öffnen" : "Open"}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => run(isDe ? "Neu synchronisieren" : "Re-syncing", async () => { await jobCentral().resyncMirror(); return undefined; })}
                    >
                      <RefreshCw size={15} /> {isDe ? "Neu synchronisieren" : "Re-sync now"}
                    </button>
                    <button
                      className="row-icon-button"
                      title={isDe ? "Spiegelung ausschalten" : "Turn off mirroring"}
                      onClick={() => run(isDe ? "Ausschalten" : "Turning off", () => jobCentral().clearMirrorFolder().then((next) => (setData(next), next)))}
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : null}
              </div>
            </>
          );
        })()}
      </section>
      ) : null}

      {tab === "ai" ? (
      <section className="settings-panel">
        <h2><Bot size={18} /> AI CLI</h2>
        <div className="provider-list">
          {data.aiProviders.map((provider) => (
            <div
              className={`provider-row ${provider.selected ? "selected" : ""}`}
              key={provider.key}
            >
              <span className={provider.detected ? "dot ok" : "dot"} />
              <button
                className="provider-select-button"
                onClick={() => run(isDe ? "KI wird ausgewählt" : "Selecting AI", () => jobCentral().selectAiProvider(provider.key).then((next) => (setData(next), next)))}
              >
                <strong>{provider.label}</strong>
                <small>{provider.version ?? provider.command}</small>
                <small>{provider.availableModels?.find((model) => model.id === provider.selectedModel)?.label ?? (provider.selectedModel || (isDe ? "Account-Standard" : "Account default"))}</small>
              </button>
              {provider.availableModels?.length ? (
                <select
                  value={provider.selectedModel ?? ""}
                  onChange={(event) => {
                    const modelId = event.target.value;
                    // Optimistic + un-queued: reflect instantly and persist directly,
                    // so it never waits behind a long AI run in the action queue.
                    setData({
                      ...data,
                      aiProviders: data.aiProviders.map((item) =>
                        item.key === provider.key ? { ...item, selectedModel: modelId } : item,
                      ),
                    });
                    void jobCentral().updateAiProviderModel({ providerKey: provider.key, modelId }).then((next) => setData(next));
                  }}
                >
                  <option value="">{isDe ? "Account-Standard (angemeldet)" : "Account default (logged-in)"}</option>
                  {provider.availableModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              ) : provider.key === "agy" ? (
                <AgyModelControl onActivated={setData} isDe={isDe} />
              ) : (
                <span className="provider-default-model">{isDe ? "Account-Standard" : "Account default"}</span>
              )}
            </div>
          ))}
        </div>
        <button className="secondary" onClick={() => run(isDe ? "CLIs werden erkannt" : "Detecting CLIs", () => jobCentral().detectAiProviders().then((next) => (setData(next), next)))}>
          <RefreshCw size={18} /> {isDe ? "Erkennen" : "Detect"}
        </button>
      </section>
      ) : null}

      {tab === "jobs" ? (
      <section className="settings-panel portal-settings-panel">
        <h2><Globe2 size={18} /> {isDe ? "Portale" : "Portals"}</h2>
        <p className="panel-help">{isDe ? "Hier sucht die KI nach Jobs. Quellen ein-/ausschalten im 'Jobs finden'-Bildschirm; eigene Jobbörsen hier hinzufügen oder bearbeiten. Suchkriterien (Rollen, Standort, Keywords) unter 'Jobs finden' → 'Kriterien anpassen'." : "Where the AI looks for jobs. Toggle sources on the Find jobs screen; add or edit custom job boards here. Your search criteria (roles, location, keywords) live in Find jobs → Adjust criteria."}</p>
        <div className="portal-editor-layout">
          <div className="portal-list">
            {data.portals.map((portal) => (
              <button key={portal.id} className={portalDraft.id === portal.id ? "selected" : ""} onClick={() => setPortalDraft(portal)}>
                <span>{portal.name}</span>
                <small>{portal.sourceType}</small>
              </button>
            ))}
            <button onClick={() => setPortalDraft(emptyPortal())}>
              <Plus size={16} /> {isDe ? "Neues Portal" : "New portal"}
            </button>
          </div>
          <div className="portal-editor-fields">
            <div className="portal-presets">
              <span className="portal-presets-label">{isDe ? "Schnell hinzufügen" : "Quick add"}</span>
              {PORTAL_PRESETS.map((preset) => (
                <button key={preset.label} type="button" className="portal-preset-chip" onClick={() => setPortalDraft(portalFromPreset(preset))}>
                  <Plus size={13} /> {preset.label}
                </button>
              ))}
            </div>

            <div className="portal-field-row portal-field-basics">
              <label className="portal-field">
                <span>{isDe ? "Name" : "Name"}</span>
                <input value={portalDraft.name} onChange={(event) => setPortalDraft({ ...portalDraft, name: event.target.value })} placeholder={isDe ? "z. B. jobs.ch" : "e.g. jobs.ch"} />
              </label>
              <label className="portal-field">
                <span>{isDe ? "Typ" : "Type"}</span>
                <select value={portalDraft.sourceType} onChange={(event) => setPortalDraft({ ...portalDraft, sourceType: event.target.value as JobPortal["sourceType"] })}>
                  <option value="websearch">{isDe ? "Websuche" : "Web search"}</option>
                  <option value="greenhouse">Greenhouse (ATS)</option>
                  <option value="ashby">Ashby (ATS)</option>
                  <option value="lever">Lever (ATS)</option>
                  <option value="manual">{isDe ? "Manuell" : "Manual"}</option>
                </select>
              </label>
              <label className="portal-field">
                <span>{isDe ? "Land" : "Country"}</span>
                <input value={portalDraft.country} onChange={(event) => setPortalDraft({ ...portalDraft, country: event.target.value })} placeholder={isDe ? "Schweiz" : "Switzerland"} />
              </label>
            </div>

            <label className="portal-field">
              <span>URL <small>{urlHintForType(portalDraft.sourceType)}</small></span>
              <input value={portalDraft.url} onChange={(event) => setPortalDraft({ ...portalDraft, url: event.target.value })} placeholder="https://…" />
            </label>

            <label className="portal-field">
              <span>{isDe ? "Suchanfrage" : "Search query"} <small>{isDe ? "optional — leer lassen, damit die KI Suchanfragen erstellt" : "optional — leave empty to let the AI build queries"}</small></span>
              <textarea value={portalDraft.query} onChange={(event) => setPortalDraft({ ...portalDraft, query: event.target.value })} placeholder="site:jobs.ch frontend engineer zürich" />
            </label>

            <div className="portal-field-row">
              <label className="portal-field">
                <span>{isDe ? "Keywords aufwerten" : "Boost keywords"} <small>{isDe ? "optional" : "optional"}</small></span>
                <input placeholder="react, typescript, remote" value={portalDraft.positiveKeywords.join(", ")} onChange={(event) => setPortalDraft({ ...portalDraft, positiveKeywords: splitCommaList(event.target.value) })} />
              </label>
              <label className="portal-field">
                <span>{isDe ? "Keywords ausschließen" : "Exclude keywords"} <small>{isDe ? "optional" : "optional"}</small></span>
                <input placeholder="senior, lead, php" value={portalDraft.negativeKeywords.join(", ")} onChange={(event) => setPortalDraft({ ...portalDraft, negativeKeywords: splitCommaList(event.target.value) })} />
              </label>
            </div>

            <label className="portal-field">
              <span>{isDe ? "Notizen" : "Notes"} <small>{isDe ? "optional" : "optional"}</small></span>
              <textarea value={portalDraft.notes} onChange={(event) => setPortalDraft({ ...portalDraft, notes: event.target.value })} placeholder={isDe ? "Wofür diese Quelle gut ist." : "What this source is good for."} />
            </label>

            <div className="portal-editor-controls">
              <label className="check-row">
                <input type="checkbox" checked={portalDraft.enabled} onChange={(event) => setPortalDraft({ ...portalDraft, enabled: event.target.checked })} />
                {isDe ? "Für Scans aktiviert" : "Enabled for scans"}
              </label>
              <a className="search-link" href={searchHref(portalDraft)} target="_blank" rel="noreferrer">
                <ExternalLink size={16} /> {isDe ? "Suche öffnen" : "Open search"}
              </a>
            </div>
            <div className="toolbar-row">
              <button className="primary" onClick={() => run(isDe ? "Portal wird gespeichert" : "Saving portal", () => jobCentral().savePortal(portalDraft).then((next) => (setData(next), next)))}>
                <Save size={18} /> {isDe ? "Portal speichern" : "Save portal"}
              </button>
              <button
                className="secondary"
                onClick={() =>
                  run(
                    isDe ? "Portale werden gescannt" : "Scanning portals",
                    () => jobCentral().scanPortals().then((result) => (setData(result.data), result)),
                    scanResultMessage,
                  )
                }
              >
                <RefreshCw size={18} /> {isDe ? "Scannen" : "Scan"}
              </button>
              <button
                className="secondary"
                onClick={() =>
                  run(isDe ? "KI-Suchplan wird erstellt" : "Planning portal search", async () => {
                    const created = await jobCentral().createAiPlan({ purpose: "portal_search", title: "Swiss portal search plan" });
                    const plan = newestPlan(created.aiPlans, (item) => item.purpose === "portal_search" && item.title === "Swiss portal search plan");
                    setData(created);
                    if (!plan) return created;
                    const ran = await jobCentral().runAiPlan(plan.id);
                    setData(ran);
                    return ran;
                  })
                }
              >
                <Bot size={18} /> {isDe ? "KI-Suchplan" : "AI search plan"}
              </button>
              {data.portals.some((portal) => portal.id === portalDraft.id) && (
                <button
                  className="secondary danger"
                  onClick={() =>
                    confirmDestructive(isDe ? `Portal '${portalDraft.name}' löschen?` : `Delete portal "${portalDraft.name}"?`)
                      ? run(isDe ? "Portal wird gelöscht" : "Deleting portal", () => jobCentral().deletePortal(portalDraft.id).then((next) => (setData(next), next)))
                      : undefined
                  }
                >
                  <Trash2 size={18} /> {isDe ? "Portal löschen" : "Delete portal"}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      ) : null}
      </div>
    </div>
  );
}

export default App;
