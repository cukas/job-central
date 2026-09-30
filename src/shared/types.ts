import type { ProfileFact, WorkspaceFolderConfig, CvProject, RoleTailoring } from "./models.js";

export type { ProfileFact, ProfileFactStatus, WorkspaceFolderConfig, CvProject, RoleTailoring } from "./models.js";

export type AppSection = "start" | "cv" | "letters" | "jobs" | "pipeline" | "settings";

// Live, in-memory mirror sync state pushed to the renderer over the `mirror:status`
// IPC event. Deliberately NOT persisted in workspace.json: storing it would route
// through DataStore.update() and re-trigger the mirror, an infinite loop. Only the
// persistent config (WorkspaceFolderConfig: rootPath + enabled) lives in settings.
export interface MirrorSyncStatus {
  state: "idle" | "syncing" | "ok" | "error" | "disabled";
  rootPath?: string;
  lastSyncedAt?: string;
  lastError?: string;
}

export type ApplicationStatus =
  | "watching"
  | "evaluating"
  | "applied"
  | "follow_up"
  | "interview"
  | "offer"
  | "rejected"
  | "ghosted"
  | "archived";

export type EventType =
  | "profile.updated"
  | "cv.master_updated"
  | "cv.variant_created"
  | "cv.pdf_generated"
  | "cv.docx_generated"
  | "letter.pdf_generated"
  | "job.created"
  | "job.status_changed"
  | "job.note_added"
  | "portal.updated"
  | "portal.scan_completed"
  | "ai.detected"
  | "ai.selected"
  | "ai.proposal_created"
  | "ai.proposal_resolved"
  | "ai.chat_message"
  | "ai.chat_cleared"
  | "ai.autofill_mapped"
  | "artifact.cleaned";

export interface Profile {
  id: string;
  fullName: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
  targetRoles: string[];
  compensation: string;
  workPreference: string;
  nationality?: string;
  workPermit?: string;
  dateOfBirth?: string;
  photoDataUrl?: string;
  updatedAt: string;
}

export interface CvStyle {
  accentColor: string;
  density: "comfortable" | "compact";
  font: string;
  showPhoto: boolean;
  showContactIcons: boolean;
  // Several roles at the SAME employer (a promotion path: Frontend → Senior → Lead) are stored
  // as separate experience entries, so each keeps its own dates, bullets and tailoring. This
  // only changes how they are DRAWN: on, consecutive entries sharing an employer collapse into
  // one company block with the total span, roles nested underneath. Undefined = off (the
  // long-standing look), so existing CVs render exactly as before.
  groupSameEmployer?: boolean;
}

export interface PersonWorkspace {
  id: string;
  label: string;
  relationship: "self" | "family" | "client";
  profile: Profile;
  masterCvId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CvSection {
  id: string;
  title: string;
  kind:
    | "profile"
    | "languages"
    | "experience"
    | "skills"
    | "education"
    | "projects"
    | "speaking"
    | "certificates"
    | "interests"
    | "courses"
    | "awards"
    | "organisations"
    | "publications"
    | "references"
    | "declaration"
    | "custom";
  content: string;
  structured?: StructuredCvSection;
  enabled: boolean;
}

export interface CvTextRun {
  text: string;
  marks?: Array<"bold" | "italic">;
  link?: string;
}

export interface CvRichTextBlock {
  id: string;
  type: "paragraph" | "bullet";
  runs: CvTextRun[];
}

export interface CvField {
  key: "title" | "subtitle" | "date" | "location" | "level" | "url" | "description" | "custom";
  label: string;
  value: string;
}

export interface CvEntry {
  id: string;
  kind: CvSection["kind"];
  fields: CvField[];
  blocks: CvRichTextBlock[];
  bullets: CvRichTextBlock[];
  links: Array<{ label: string; url: string }>;
  visible: boolean;
  order: number;
}

export interface StructuredCvSection {
  schemaVersion: 1;
  kind: CvSection["kind"];
  entries: CvEntry[];
  visible: boolean;
  order: number;
}

export interface CvDocument {
  id: string;
  title: string;
  language: "en" | "de";
  template: "flow" | "swiss" | "compact" | "executive" | "minimal" | "sidebar" | "classic"
    | "ats" | "zurich" | "modern" | "slate" | "editorial" | "techmono" | "elegant";
  style: CvStyle;
  sections: CvSection[];
  updatedAt: string;
  // Bilingual pairing: a DE and EN sibling share a translationGroupId so the
  // language toggle / export can find the pair. translationSourceUpdatedAt is the
  // source doc's updatedAt at translation time, for staleness detection.
  translationGroupId?: string;
  translationSourceUpdatedAt?: string;
}

export interface CvVersion {
  id: string;
  title: string;
  // Per-variant professional title shown under the name (the "Titel"/headline).
  // Optional: when a tailor run produces a role-fit title it is stored here so this
  // one CV can lead with the target role, while the master and every other variant
  // keep the global profile.headline. Absent → fall back to profile.headline.
  headline?: string;
  sourceCvId: string;
  jobId?: string;
  language?: "en" | "de";
  template: CvDocument["template"];
  style: CvStyle;
  sections: CvSection[];
  pdfPath?: string;
  docxPath?: string;
  notes: string;
  createdAt: string;
  updatedAt?: string;
  // Bilingual pairing — see CvDocument.
  translationGroupId?: string;
  translationSourceUpdatedAt?: string;
}

export interface JobPortal {
  id: string;
  name: string;
  country: string;
  url: string;
  sourceType: "greenhouse" | "ashby" | "lever" | "websearch" | "manual";
  enabled: boolean;
  query: string;
  positiveKeywords: string[];
  negativeKeywords: string[];
  notes: string;
  updatedAt: string;
}

// AI-estimated market pay for a role (NOT a figure from the posting). A gross range
// in `currency` per `period`, plus a one-line basis the user can sanity-check.
export interface SalaryEstimate {
  min: number;
  max: number;
  currency: string; // e.g. "CHF"
  period: "year" | "month" | "hour";
  basis: string; // short rationale: role, seniority, location, market
}

export interface JobPost {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  sourcePortalId?: string;
  description: string;
  fitReason?: string;
  score?: number;
  // AI market salary estimate for this role, produced during tailoring so the user
  // can orient on pay. An enrichment like fitReason/score — never a posted figure.
  salaryEstimate?: SalaryEstimate;
  createdAt: string;
  // When the job pipeline first saw this posting (carried from the wire
  // `first_seen_at`). This is the real "added to your pool" date — `createdAt`
  // is only the local sync time. Older records may lack it; fall back to createdAt.
  firstSeenAt?: string;
  postedAt?: string;
  // Whether the user has already viewed this posting in the browse list. Persisted
  // so a re-sync can flag what's genuinely new vs. already-shown.
  seen?: boolean;
}

export interface RemovedJob {
  url: string;
  title?: string;
  company?: string;
  location?: string;
  reason?: string;
  score?: number;
  source?: "search" | "pipeline" | "watchlist" | "application";
  removedAt: string;
}

export type RemovedJobInput = Omit<RemovedJob, "removedAt">;

export interface LinkCheckResult {
  url: string;
  alive: boolean;
  status: number;
  finalUrl?: string;
}

export interface JobExtraction {
  company: string;
  title: string;
  location: string;
  description: string;
  url: string;
}

export interface CvReviewCategory {
  name: string;
  score: number;
  note: string;
}

export interface CvReview {
  overall: number;
  verdict: string;
  categories: CvReviewCategory[];
  strengths: string[];
  fixes: string[];
  missingKeywords: string[];
  jobTitle?: string;
}

// One fillable control discovered on an application form. `ref` is a marker the
// main process stamps onto the element so a later apply pass can target it exactly.
export interface AutofillField {
  ref: string;
  type: string;
  label: string;
  required?: boolean;
  name?: string;
  value?: string;
  options?: Array<{ value: string; text: string }>;
  isFile?: boolean;
}

// The AI's answer: which value to put in each field, plus a human checklist of
// what it deliberately left for the user (file uploads, blanks, things to verify).
export interface AutofillMapResult {
  values: Record<string, string>;
  review: string[];
}

export interface ApplicationEvent {
  id: string;
  type: "created" | "status" | "note" | "cv" | "follow_up" | "interview" | "portal_scan";
  title: string;
  detail: string;
  createdAt: string;
}

export interface JobApplication {
  id: string;
  jobPostId: string;
  status: ApplicationStatus;
  priority: "low" | "medium" | "high";
  cvVersionId?: string;
  nextActionAt?: string;
  appliedAt?: string;
  notes: string;
  events: ApplicationEvent[];
  updatedAt: string;
  // Soft-archive: when set, the application is hidden from the pipeline lanes but fully
  // kept (job, CVs, letters, the "where I applied" record) and restorable. Lets a busy
  // lane (e.g. 200 rejections) be cleared without losing history — unlike a hard delete.
  archivedAt?: string;
}

export interface AiProvider {
  key: "claude" | "codex" | "gemini" | "opencode" | "agy" | "custom";
  label: string;
  command: string;
  detected: boolean;
  version?: string;
  selected: boolean;
  modelFlag?: string;
  selectedModel?: string;
  availableModels?: Array<{
    id: string;
    label: string;
  }>;
  notes: string;
}

export interface AiPlan {
  id: string;
  providerKey: AiProvider["key"];
  purpose:
    | "tailor_cv"
    | "optimize_cv"
    | "cv_entry"
    | "evaluate_job"
    | "follow_up"
    | "interview_prep"
    | "portal_search"
    | "career_advice"
    | "cover_letter"
    | "job_chat"
    | "cv_chat"
    | "extract_profile_facts"
    | "translate_cv"
    | "translate_letter";
  title: string;
  prompt: string;
  output?: string;
  status: "draft" | "ready" | "ran" | "failed";
  modelId?: string;
  modelLabel?: string;
  relatedJobId?: string;
  relatedCvId?: string;
  createdAt: string;
}

export type AiProposalStatus = "pending" | "accepted" | "rejected" | "edited" | "superseded";

export interface AiProposal {
  id: string;
  type: "cv_section" | "cover_letter" | "job_evaluation" | "package" | "search_result";
  status: AiProposalStatus;
  jobId?: string;
  cvVersionId?: string;
  letterId?: string;
  aiPlanId?: string;
  title: string;
  rationale?: string;
  confidence?: number;
  before?: string;
  proposed: string;
  edited?: string;
  sectionKind?: CvSection["kind"];
  createdAt: string;
  resolvedAt?: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  aiPlanId?: string;
  proposalIds?: string[];
  // Inline CV-check score (0-100) the coach attached to this reply, if any.
  cvScore?: number;
  createdAt: string;
}

export interface AiConversation {
  id: string;
  // A conversation is scoped to either a job or a CV (master/version).
  jobId?: string;
  cvId?: string;
  title: string;
  messages: AiMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface JobEvaluation {
  jobId: string;
  fitScore: number;
  riskScore: number;
  effortScore: number;
  priorityScore: number;
  summary: string;
  strengths: string[];
  risks: string[];
  missingInfo: string[];
  recommendation: "skip" | "watch" | "apply" | "high_priority";
  aiSuggested: boolean;
  updatedAt: string;
}

export interface ArtifactHistoryItem {
  id: string;
  jobId?: string;
  artifactType: "cv" | "letter" | "pdf" | "proposal" | "package";
  artifactId: string;
  action: "created" | "updated" | "accepted" | "rejected" | "exported" | "cleaned" | "archived";
  title: string;
  detail: string;
  createdAt: string;
}

export interface AppEvent {
  id: string;
  type: EventType;
  aggregateType: "profile" | "cv" | "job" | "portal" | "ai";
  aggregateId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AdzunaCredentials {
  appId: string;
  appKey: string;
  country: string;
}

export interface AppSettings {
  activeAiProvider?: AiProvider["key"];
  activeWorkspaceId: string;
  language: "en" | "de";
  defaultCountry: string;
  search: SearchPreferences;
  adzuna?: AdzunaCredentials;
  dataVersion: number;
  onboardingComplete?: boolean;
  // When true (default), AI-generated application text (CVs, cover letters, optimize) is
  // told to write in plain human style — no em dashes, AI buzzwords, or formulaic phrasing.
  // Turn off for a more polished/editorial tone (e.g. journalist/PR roles).
  naturalWriting?: boolean;
  // User-chosen folder where the app mirrors all CVs/letters/profile to disk.
  // Undefined until the user picks one; the mirror is off until then.
  workspaceFolder?: WorkspaceFolderConfig;
  // Tombstones for portals the user deleted. The seeded default portals are
  // re-added by mergeDefaults on every load; this list makes their deletion
  // stick. User-added portals are never re-seeded, so recording them is a no-op.
  removedPortalIds?: string[];
  // Tombstones for jobs the user deleted from the pipeline. Source sync can see
  // the same canonical URL again; this keeps explicit deletions from being re-added.
  removedJobUrls?: string[];
  // Readable archive metadata for removed jobs. Older data may only have
  // removedJobUrls, so the UI still falls back to URLs when these details are absent.
  removedJobs?: RemovedJob[];
}

export interface SearchPreferences {
  targetRoles: string[];
  locations: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  targetCompanies: string[];
  excludedCompanies: string[];
}

// Raw material the user has given us (imported CVs, Arbeitszeugnisse, diplomas).
// Kept verbatim so CV/letter generation can draw on ALL of it for tailoring —
// and so the AI only ever uses real, user-supplied facts (never fabricated).
export interface SourceDocument {
  id: string;
  name: string;
  kind: "zeugnis" | "cv" | "other";
  text: string;
  words: number;
  addedAt: string;
}

export interface AppData {
  dataVersion: number;
  workspaces: PersonWorkspace[];
  profile: Profile;
  masterCv: CvDocument;
  // The other-language sibling of the master CV (the master stays a single field to
  // avoid touching its ~40 read sites; this sidecar holds the translated peer).
  masterCvTranslation?: CvDocument;
  cvVersions: CvVersion[];
  sourceDocuments: SourceDocument[];
  // Facts captured from AI chats, staged for the user to approve before they are
  // allowed to enrich profile.md / the master CV. Never auto-applied.
  pendingProfileFacts: ProfileFact[];
  // The project/achievement inventory the AI extracts from dropped documents during
  // "Build my CV". Each item cites its source (sourceDocId + sourceQuote) so nothing
  // is fabricated; `included` drives the project picker; the master CV's
  // experience/projects sections are rendered from the included items.
  cvProjects: CvProject[];
  // Per-target-role memory of which projects were picked, so one source pile yields
  // several tailored CVs without re-selecting.
  roleTailorings: RoleTailoring[];
  coverLetters: CoverLetter[];
  portals: JobPortal[];
  jobPosts: JobPost[];
  applications: JobApplication[];
  aiProviders: AiProvider[];
  aiPlans: AiPlan[];
  aiProposals: AiProposal[];
  aiConversations: AiConversation[];
  jobEvaluations: JobEvaluation[];
  artifactHistory: ArtifactHistoryItem[];
  events: AppEvent[];
  settings: AppSettings;
}

export interface CoverLetter {
  id: string;
  jobId: string;
  cvVersionId?: string;
  language: "en" | "de";
  tone: "direct" | "formal" | "warm";
  title: string;
  content: string;
  instructions: string;
  pdfPath?: string;
  createdAt: string;
  updatedAt: string;
  // Bilingual pairing — see CvDocument.
  translationGroupId?: string;
  translationSourceUpdatedAt?: string;
}

export interface PortalScanResult {
  portalId: string;
  portalName: string;
  scanned: number;
  added: number;
  skipped: number;
  errors: string[];
}

export interface CareerOpsImportResult {
  jobsAdded: number;
  portalsAdded: number;
  skipped: number;
  errors: string[];
}

export interface PdfResult {
  cvVersionId?: string;
  letterId?: string;
  pdfPath: string;
}

export interface DocxResult {
  cvVersionId: string;
  docxPath: string;
}

export interface JobCentralApi {
  getState(): Promise<AppData>;
  pipelineSync(): Promise<AppData>;
  updateAdzunaCredentials(creds: AdzunaCredentials): Promise<AppData>;
  importCvDocument(): Promise<{ text: string; filePath: string }>;
  // AI structuring for import: convert raw extracted CV text into canonical section
  // text. Returns null when no engine is detected or the output is unusable, so the
  // caller falls back to the deterministic parser.
  structureCvImport(input: { text: string }): Promise<{ sections: Record<string, string> } | null>;
  // Drag-and-drop Source Inbox. getPathForFile resolves a dropped File to its absolute
  // path (sync, via webUtils); importDocumentPaths extracts + stores each as a source
  // document; removeSourceDocument drops one from the inbox.
  getPathForFile(file: File): string;
  importDocumentPaths(paths: string[]): Promise<AppData>;
  removeSourceDocument(id: string): Promise<AppData>;
  listSystemFonts(): Promise<string[]>;
  saveProfile(profile: Profile): Promise<AppData>;
  createWorkspace(input: { label: string; fullName: string; relationship: PersonWorkspace["relationship"] }): Promise<AppData>;
  switchWorkspace(workspaceId: string): Promise<AppData>;
  saveMasterCv(cv: CvDocument): Promise<AppData>;
  saveCvVersion(cv: CvVersion): Promise<AppData>;
  proposeMasterCvOptimization(input: { instructions?: string }): Promise<AppData>;
  createCvVariant(input: { jobId?: string; title: string; notes: string; reuseExisting?: boolean }): Promise<AppData>;
  deleteCvVersion(cvVersionId: string): Promise<AppData>;
  copyCvPart(input: { targetCvId: string; sourceCvId: string; sectionId: string; entryId?: string; targetEntryId?: string }): Promise<AppData>;
  removeCvPart(input: { cvId: string; sectionId: string; entryId?: string }): Promise<AppData>;
  promoteCvToMaster(input: { cvVersionId: string }): Promise<AppData>;
  saveCoverLetter(letter: CoverLetter): Promise<AppData>;
  deleteCoverLetter(letterId: string): Promise<AppData>;
  generateCoverLetter(input: { jobId: string; cvVersionId?: string; language: "en" | "de"; instructions: string }): Promise<AppData>;
  translateCv(input: { cvId: string; targetLang: "en" | "de" }): Promise<{ data: AppData; summary: string }>;
  translateCoverLetter(input: { letterId: string; targetLang: "en" | "de" }): Promise<{ data: AppData; summary: string }>;
  createAiPlan(input: {
    purpose: AiPlan["purpose"];
    title: string;
    jobId?: string;
    cvVersionId?: string;
    instructions?: string;
  }): Promise<AppData>;
  runAiPlan(planId: string): Promise<AppData>;
  sendJobAiMessage(input: { jobId: string; message: string; cvVersionId?: string; letterId?: string }): Promise<AppData>;
  sendCvAiMessage(input: { cvId: string; message: string }): Promise<AppData>;
  sendCareerAdvisorMessage(input: { message: string }): Promise<AppData>;
  clearCvChat(cvId: string): Promise<AppData>;
  importZeugnisse(): Promise<{ documents: Array<{ name: string; words: number }>; text: string }>;
  buildExperienceFromDocs(input: { text: string; mode: "curate" | "trim"; cvId?: string; apply?: boolean }): Promise<AppData>;
  // Paste raw material (old CV, LinkedIn, notes); agy merges the real facts into the
  // master CV and keeps the text as a source document. Returns a one-line summary.
  ingestCvMaterial(input: { text: string; instruction?: string }): Promise<{ data: AppData; summary: string }>;
  // Unified intake: add pasted text as a source document only (no AI refine) so the
  // next build-from-sources includes it — the paste counterpart to dropping files.
  addTextSource(text: string): Promise<AppData>;
  // CV workbench: build the master CV + a source-cited project inventory from all dropped
  // documents; toggle/reorder which projects are in the CV (with per-role memory); or let
  // agy pre-select the projects that fit a target role.
  buildCvFromSources(input?: { targetLang?: "en" | "de" }): Promise<{ data: AppData; summary: string }>;
  setCvProjects(input: { projects: Array<{ id: string; included: boolean; order: number }>; targetRole?: string }): Promise<AppData>;
  addHistoryItems(input: { cvId: string; projectIds: string[] }): Promise<AppData>;
  tailorProjects(input: { targetRole: string }): Promise<{ data: AppData; summary: string }>;
  resolveAiProposal(input: { proposalId: string; action: "accept" | "reject" | "edit"; edited?: string }): Promise<AppData>;
  updateJobEvaluation(evaluation: JobEvaluation): Promise<AppData>;
  cleanupJobArtifacts(jobId: string): Promise<AppData>;
  generateCvPdf(cvVersionId: string): Promise<{ data: AppData; result: PdfResult }>;
  // Render the live CV draft to PDF bytes through the SAME Chromium path as the export, so the
  // on-screen preview is the exact document that will be exported (pdf.js renders the base64).
  previewCvPdf(input: { profile: Profile; cv: CvDocument | CvVersion; master?: CvDocument | CvVersion | null }): Promise<{ pdfBase64: string; pageCount: number }>;
  generateCvDocx(cvVersionId: string): Promise<{ data: AppData; result: DocxResult }>;
  generateCoverLetterPdf(letterId: string): Promise<{ data: AppData; result: PdfResult }>;
  createJob(input: Omit<JobPost, "id" | "createdAt">): Promise<AppData>;
  updateJob(job: JobPost): Promise<AppData>;
  // Mark browse-list postings as seen (or "all"). Lightweight: only flips the
  // `seen` flag, no application-event side effects.
  markJobsSeen(ids: string[] | "all"): Promise<AppData>;
  dismissJobUrls(jobs: Array<string | RemovedJobInput>): Promise<AppData>;
  restoreRemovedJob(url: string): Promise<AppData>;
  restoreAllRemovedJobs(): Promise<AppData>;
  deleteApplication(applicationId: string): Promise<AppData>;
  setApplicationArchived(input: { applicationId: string; archived: boolean }): Promise<AppData>;
  archiveApplicationsByStatus(status: ApplicationStatus): Promise<AppData>;
  clearWatchlist(): Promise<AppData>;
  updateApplication(input: {
    applicationId: string;
    status?: ApplicationStatus;
    priority?: JobApplication["priority"];
    cvVersionId?: string;
    nextActionAt?: string;
    appliedAt?: string;
    notes?: string;
    eventDetail?: string;
  }): Promise<AppData>;
  savePortal(portal: JobPortal): Promise<AppData>;
  deletePortal(portalId: string): Promise<AppData>;
  scanPortals(): Promise<{ data: AppData; results: PortalScanResult[] }>;
  checkLink(url: string): Promise<LinkCheckResult>;
  extractJobFromPage(input: { url: string; text: string }): Promise<JobExtraction>;
  liveSearch(input: { roles: string; location: string; instructions?: string }): Promise<AppData>;
  grabJobsFromPage(input: { url: string; text: string; links: Array<{ text: string; href: string }> }): Promise<AppData>;
  extractApplicationForm(webContentsId: number): Promise<{ fields: AutofillField[] }>;
  mapApplicationForm(input: { fields: AutofillField[]; pageText: string }): Promise<AutofillMapResult>;
  applyApplicationForm(input: { webContentsId: number; values: Record<string, string> }): Promise<number>;
  getAgyModel(): Promise<string | null>;
  setAgyModel(model: string): Promise<string | null>;
  reviewCv(input: { cvVersionId?: string }): Promise<CvReview>;
  resetAllData(): Promise<AppData>;
  clearResolvedProposals(): Promise<AppData>;
  installCli(providerKey: AiProvider["key"]): Promise<AppData>;
  loginCli(providerKey: AiProvider["key"]): Promise<void>;
  testCli(providerKey: AiProvider["key"]): Promise<{ ok: boolean; message: string }>;
  importCareerOps(path: string): Promise<{ data: AppData; result: CareerOpsImportResult }>;
  detectAiProviders(): Promise<AppData>;
  selectAiProvider(providerKey: AiProvider["key"]): Promise<AppData>;
  updateAiProviderModel(input: { providerKey: AiProvider["key"]; modelId: string }): Promise<AppData>;
  setLanguage(language: "en" | "de"): Promise<AppData>;
  setNaturalWriting(on: boolean): Promise<AppData>;
  completeOnboarding(): Promise<AppData>;
  restartOnboarding(): Promise<AppData>;
  updateSearchPreferences(preferences: SearchPreferences): Promise<AppData>;
  onAiStream(callback: (event: AiStreamEvent) => void): () => void;
  // Folder mirror — pick/clear the on-disk root, query live status, open a folder
  // in the OS file manager, and subscribe to push status updates.
  selectMirrorFolder(): Promise<AppData>;
  clearMirrorFolder(): Promise<AppData>;
  resyncMirror(): Promise<MirrorSyncStatus>;
  getMirrorStatus(): Promise<MirrorSyncStatus>;
  openMirrorPath(input: { target: "root" | "me" | "application"; applicationId?: string }): Promise<{ ok: boolean; error?: string }>;
  onMirrorStatus(callback: (status: MirrorSyncStatus) => void): () => void;
  // Profile-fact capture from AI chats (review-gated; never auto-applied).
  extractProfileFacts(input: { conversationId: string }): Promise<AppData>;
  resolveProfileFacts(input: { approve: string[]; reject: string[] }): Promise<AppData>;
}

export interface AiStreamEvent {
  planId: string;
  phase: "start" | "chunk" | "end";
  text?: string;
  kind?: "stdout" | "stderr";
  title?: string;
  status?: "ran" | "failed";
  provider?: string;
  model?: string;
}
