import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AdzunaCredentials, AiPlan, AiProvider, AiStreamEvent, AppEvent, ApplicationStatus, AutofillField, CoverLetter, CvDocument, CvVersion, EventType, JobApplication, JobCentralApi, JobEvaluation, JobPortal, JobPost, MirrorSyncStatus, PersonWorkspace, Profile, RemovedJobInput, SearchPreferences } from "../shared/types.js";

const api: JobCentralApi = {
  getState: () => ipcRenderer.invoke("app:get-state"),
  importCvDocument: () => ipcRenderer.invoke("documents:import-cv"),
  structureCvImport: (input: { text: string }) => ipcRenderer.invoke("cv:structure-import", input),
  // Drag-and-drop ingestion: resolve a dropped File to its absolute path (Electron
  // dropped File.path was removed; webUtils.getPathForFile is the supported way), then
  // hand the paths to the main process to extract + store as source documents.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  importDocumentPaths: (paths: string[]) => ipcRenderer.invoke("documents:import-paths", paths),
  removeSourceDocument: (id: string) => ipcRenderer.invoke("documents:remove", id),
  listSystemFonts: () => ipcRenderer.invoke("fonts:list"),
  saveProfile: (profile: Profile) => ipcRenderer.invoke("profile:save", profile),
  createWorkspace: (input: { label: string; fullName: string; relationship: PersonWorkspace["relationship"] }) => ipcRenderer.invoke("workspace:create", input),
  switchWorkspace: (workspaceId: string) => ipcRenderer.invoke("workspace:switch", workspaceId),
  saveMasterCv: (cv: CvDocument) => ipcRenderer.invoke("cv:save-master", cv),
  saveCvVersion: (cv: CvVersion) => ipcRenderer.invoke("cv:save-version", cv),
  proposeMasterCvOptimization: (input: { instructions?: string }) => ipcRenderer.invoke("cv:propose-master-optimization", input),
  createCvVariant: (input: { jobId?: string; title: string; notes: string; reuseExisting?: boolean }) => ipcRenderer.invoke("cv:create-variant", input),
  deleteCvVersion: (cvVersionId: string) => ipcRenderer.invoke("cv:delete-version", cvVersionId),
  copyCvPart: (input: { targetCvId: string; sourceCvId: string; sectionId: string; entryId?: string; targetEntryId?: string }) => ipcRenderer.invoke("cv:copy-part", input),
  removeCvPart: (input: { cvId: string; sectionId: string; entryId?: string }) => ipcRenderer.invoke("cv:remove-part", input),
  promoteCvToMaster: (input: { cvVersionId: string }) => ipcRenderer.invoke("cv:promote-to-master", input),
  saveCoverLetter: (letter: CoverLetter) => ipcRenderer.invoke("letters:save", letter),
  deleteCoverLetter: (letterId: string) => ipcRenderer.invoke("letters:delete", letterId),
  generateCoverLetter: (input: { jobId: string; cvVersionId?: string; language: "en" | "de"; instructions: string }) =>
    ipcRenderer.invoke("letters:generate", input),
  translateCv: (input: { cvId: string; targetLang: "en" | "de" }) => ipcRenderer.invoke("cv:translate", input),
  translateCoverLetter: (input: { letterId: string; targetLang: "en" | "de" }) => ipcRenderer.invoke("letter:translate", input),
  createAiPlan: (input: { purpose: AiPlan["purpose"]; title: string; jobId?: string; cvVersionId?: string; instructions?: string }) => ipcRenderer.invoke("ai:create-plan", input),
  runAiPlan: (planId: string) => ipcRenderer.invoke("ai:run-plan", planId),
  sendJobAiMessage: (input: { jobId: string; message: string; cvVersionId?: string; letterId?: string }) => ipcRenderer.invoke("ai:chat-job", input),
  sendCvAiMessage: (input: { cvId: string; message: string }) => ipcRenderer.invoke("ai:chat-cv", input),
  sendCareerAdvisorMessage: (input: { message: string }) => ipcRenderer.invoke("ai:career-advisor", input),
  clearCvChat: (cvId: string) => ipcRenderer.invoke("ai:clear-cv-chat", { cvId }),
  importZeugnisse: () => ipcRenderer.invoke("zeugnisse:import"),
  buildExperienceFromDocs: (input: { text: string; mode: "curate" | "trim"; cvId?: string; apply?: boolean }) => ipcRenderer.invoke("cv:build-experience", input),
  ingestCvMaterial: (input: { text: string; instruction?: string }) => ipcRenderer.invoke("cv:ingest-material", input),
  addTextSource: (text: string) => ipcRenderer.invoke("cv:add-text-source", { text }),
  buildCvFromSources: (input?: { targetLang?: "en" | "de" }) => ipcRenderer.invoke("cv:build-from-sources", input),
  setCvProjects: (input: { projects: Array<{ id: string; included: boolean; order: number }>; targetRole?: string }) => ipcRenderer.invoke("cv:set-projects", input),
  addHistoryItems: (input: { cvId: string; projectIds: string[] }) => ipcRenderer.invoke("cv:add-history-items", input),
  tailorProjects: (input: { targetRole: string }) => ipcRenderer.invoke("cv:tailor-projects", input),
  resolveAiProposal: (input: { proposalId: string; action: "accept" | "reject" | "edit"; edited?: string }) => ipcRenderer.invoke("ai:resolve-proposal", input),
  updateJobEvaluation: (evaluation: JobEvaluation) => ipcRenderer.invoke("jobs:update-evaluation", evaluation),
  cleanupJobArtifacts: (jobId: string) => ipcRenderer.invoke("jobs:cleanup-artifacts", jobId),
  generateCvPdf: (cvVersionId: string) => ipcRenderer.invoke("cv:generate-pdf", cvVersionId),
  previewCvPdf: (input: { profile: Profile; cv: CvDocument | CvVersion; master?: CvDocument | CvVersion | null }) => ipcRenderer.invoke("cv:preview-pdf", input),
  generateCvDocx: (cvVersionId: string) => ipcRenderer.invoke("cv:generate-docx", cvVersionId),
  generateCoverLetterPdf: (letterId: string) => ipcRenderer.invoke("letters:generate-pdf", letterId),
  createJob: (input: Omit<JobPost, "id" | "createdAt">) => ipcRenderer.invoke("jobs:create", input),
  pipelineSync: () => ipcRenderer.invoke("pipeline:sync"),
  updateAdzunaCredentials: (creds: AdzunaCredentials) => ipcRenderer.invoke("settings:set-adzuna", creds),
  updateJob: (job: JobPost) => ipcRenderer.invoke("jobs:update", job),
  markJobsSeen: (ids: string[] | "all") => ipcRenderer.invoke("jobs:mark-seen", ids),
  dismissJobUrls: (jobs: Array<string | RemovedJobInput>) => ipcRenderer.invoke("jobs:dismiss-urls", jobs),
  restoreRemovedJob: (url: string) => ipcRenderer.invoke("jobs:restore-removed", url),
  restoreAllRemovedJobs: () => ipcRenderer.invoke("jobs:restore-all-removed"),
  deleteApplication: (applicationId: string) => ipcRenderer.invoke("jobs:delete-application", applicationId),
  setApplicationArchived: (input: { applicationId: string; archived: boolean }) => ipcRenderer.invoke("jobs:set-application-archived", input),
  archiveApplicationsByStatus: (status: ApplicationStatus) => ipcRenderer.invoke("jobs:archive-by-status", status),
  clearWatchlist: () => ipcRenderer.invoke("jobs:clear-watchlist"),
  updateApplication: (input: {
    applicationId: string;
    status?: ApplicationStatus;
    priority?: JobApplication["priority"];
    cvVersionId?: string;
    nextActionAt?: string;
    appliedAt?: string;
    notes?: string;
    eventDetail?: string;
  }) => ipcRenderer.invoke("jobs:update-application", input),
  savePortal: (portal: JobPortal) => ipcRenderer.invoke("portals:save", portal),
  deletePortal: (portalId: string) => ipcRenderer.invoke("portals:delete", portalId),
  scanPortals: () => ipcRenderer.invoke("portals:scan"),
  checkLink: (url: string) => ipcRenderer.invoke("web:check-link", url),
  extractJobFromPage: (input: { url: string; text: string }) => ipcRenderer.invoke("web:extract-job", input),
  liveSearch: (input: { roles: string; location: string; instructions?: string }) => ipcRenderer.invoke("web:live-search", input),
  grabJobsFromPage: (input: { url: string; text: string; links: Array<{ text: string; href: string }> }) => ipcRenderer.invoke("web:grab-jobs", input),
  extractApplicationForm: (webContentsId: number) => ipcRenderer.invoke("web:extract-form", webContentsId),
  mapApplicationForm: (input: { fields: AutofillField[]; pageText: string }) => ipcRenderer.invoke("ai:autofill-map", input),
  applyApplicationForm: (input: { webContentsId: number; values: Record<string, string> }) => ipcRenderer.invoke("web:apply-autofill", input),
  getAgyModel: () => ipcRenderer.invoke("agy:get-model"),
  setAgyModel: (model: string) => ipcRenderer.invoke("agy:set-model", model),
  reviewCv: (input: { cvVersionId?: string }) => ipcRenderer.invoke("cv:review", input),
  resetAllData: () => ipcRenderer.invoke("app:reset-all"),
  clearResolvedProposals: () => ipcRenderer.invoke("ai:clear-resolved-proposals"),
  installCli: (providerKey: AiProvider["key"]) => ipcRenderer.invoke("ai:install-cli", providerKey),
  loginCli: (providerKey: AiProvider["key"]) => ipcRenderer.invoke("ai:cli-login", providerKey),
  testCli: (providerKey: AiProvider["key"]) => ipcRenderer.invoke("ai:cli-test", providerKey),
  importCareerOps: (path: string) => ipcRenderer.invoke("career-ops:import", path),
  detectAiProviders: () => ipcRenderer.invoke("ai:detect"),
  selectAiProvider: (providerKey: AiProvider["key"]) => ipcRenderer.invoke("ai:select", providerKey),
  updateAiProviderModel: (input: { providerKey: AiProvider["key"]; modelId: string }) => ipcRenderer.invoke("ai:update-model", input),
  setLanguage: (language: "en" | "de") => ipcRenderer.invoke("settings:set-language", language),
  setNaturalWriting: (on: boolean) => ipcRenderer.invoke("settings:set-natural-writing", on),
  completeOnboarding: () => ipcRenderer.invoke("onboarding:complete"),
  restartOnboarding: () => ipcRenderer.invoke("onboarding:reset"),
  updateSearchPreferences: (preferences: SearchPreferences) => ipcRenderer.invoke("settings:update-search", preferences),
  onAiStream: (callback: (event: AiStreamEvent) => void) => {
    const handler = (_event: unknown, payload: AiStreamEvent) => callback(payload);
    ipcRenderer.on("ai:stream", handler);
    return () => ipcRenderer.removeListener("ai:stream", handler);
  },
  selectMirrorFolder: () => ipcRenderer.invoke("mirror:select-folder"),
  clearMirrorFolder: () => ipcRenderer.invoke("mirror:clear-folder"),
  resyncMirror: () => ipcRenderer.invoke("mirror:resync"),
  getMirrorStatus: () => ipcRenderer.invoke("mirror:get-status"),
  openMirrorPath: (input: { target: "root" | "me" | "application"; applicationId?: string }) => ipcRenderer.invoke("mirror:open-path", input),
  onMirrorStatus: (callback: (status: MirrorSyncStatus) => void) => {
    const handler = (_event: unknown, payload: MirrorSyncStatus) => callback(payload);
    ipcRenderer.on("mirror:status", handler);
    return () => ipcRenderer.removeListener("mirror:status", handler);
  },
  extractProfileFacts: (input: { conversationId: string }) => ipcRenderer.invoke("ai:extract-profile-facts", input),
  resolveProfileFacts: (input: { approve: string[]; reject: string[] }) => ipcRenderer.invoke("profile:approve-facts", input),
};

contextBridge.exposeInMainWorld("jobCentral", api);
