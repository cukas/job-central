import { randomUUID } from "node:crypto";
import type { AiProvider, AppData, CvSection, CvStyle, JobPortal, PersonWorkspace, Profile } from "../shared/types.js";

export const nowIso = () => new Date().toISOString();

const id = (prefix: string) => `${prefix}_${randomUUID()}`;

const defaultCvStyle: CvStyle = {
  accentColor: "#f97316",
  density: "comfortable",
  font: "system",
  showPhoto: true,
  showContactIcons: true,
};

const profile: Profile = {
  id: "profile_self",
  fullName: "Your Name",
  headline: "",
  email: "",
  phone: "",
  location: "Switzerland",
  linkedin: "",
  github: "",
  website: "",
  targetRoles: [],
  compensation: "",
  workPreference: "Switzerland",
  updatedAt: nowIso(),
};

// A fresh/reset install seeds the master CV as an EMPTY shell: the section structure
// (so the build-from-docs flow and the editor have targets to write into) but no
// placeholder content — so the Library treats it as "no CV yet" until the user builds
// one from their documents. See masterCvHasContent() in the renderer.
const cvSections: CvSection[] = [
  { id: "profile", title: "Profile", kind: "profile", enabled: true, content: "" },
  { id: "experience", title: "Professional Experience", kind: "experience", enabled: true, content: "" },
  { id: "skills", title: "Skills", kind: "skills", enabled: false, content: "" },
  { id: "education", title: "Education", kind: "education", enabled: true, content: "" },
  { id: "languages", title: "Languages", kind: "languages", enabled: true, content: "" },
];

const defaultPortals: JobPortal[] = [
  {
    id: "portal_google_jobs",
    name: "Google Search",
    country: "Switzerland",
    url: "https://www.google.com/search",
    sourceType: "websearch",
    enabled: true,
    query: "",
    positiveKeywords: [],
    negativeKeywords: [],
    notes: "General Google search source. Use it for custom company discovery and AI-decided search queries, not as a company portal.",
    updatedAt: nowIso(),
  },
  {
    id: "portal_swissdevjobs",
    name: "SwissDevJobs",
    country: "Switzerland",
    url: "https://swissdevjobs.ch",
    sourceType: "websearch",
    enabled: true,
    query: "",
    positiveKeywords: [],
    negativeKeywords: [],
    notes: "Swiss-first technology roles.",
    updatedAt: nowIso(),
  },
  {
    id: "portal_jobs_ch",
    name: "Jobs.ch",
    country: "Switzerland",
    url: "https://www.jobs.ch",
    sourceType: "websearch",
    enabled: true,
    query: "",
    positiveKeywords: [],
    negativeKeywords: [],
    notes: "Broad Swiss board, usually needs manual review.",
    updatedAt: nowIso(),
  },
  {
    id: "portal_indeed_ch",
    name: "Indeed Switzerland",
    country: "Switzerland",
    url: "https://ch.indeed.com/jobs",
    sourceType: "websearch",
    enabled: true,
    query: "",
    positiveKeywords: [],
    negativeKeywords: [],
    notes: "Broad Swiss Indeed search. Use browser review because Indeed can vary results by login, location, and anti-bot rules.",
    updatedAt: nowIso(),
  },
  {
    id: "portal_linkedin_jobs",
    name: "LinkedIn Jobs",
    country: "Switzerland",
    url: "https://www.linkedin.com/jobs/search/",
    sourceType: "websearch",
    enabled: true,
    query: "",
    positiveKeywords: [],
    negativeKeywords: [],
    notes: "LinkedIn needs the user's logged-in browser. Job Central opens/searches LinkedIn and imports accepted jobs into the pipeline.",
    updatedAt: nowIso(),
  },
];

// Neutral by default. The onboarding wizard populates these from the user's own
// goal (target roles, locations, keywords) so the app is not tied to any persona.
const defaultSearch = {
  targetRoles: [],
  locations: [],
  positiveKeywords: [],
  negativeKeywords: [],
  targetCompanies: [],
  excludedCompanies: [],
};

const aiProviders: AiProvider[] = [
  {
    key: "agy",
    label: "Antigravity (agy)",
    command: "agy",
    detected: false,
    selected: true,
    notes: "Recommended. Google Antigravity CLI — uses your logged-in Google account (AI Pro/Ultra) at full power. Install once: curl -fsSL https://antigravity.google/cli/install.sh | bash",
  },
  {
    key: "claude",
    label: "Claude Code",
    command: "claude",
    detected: false,
    selected: false,
    modelFlag: "--model",
    availableModels: [
      { id: "claude-opus-4-6", label: "Opus 4.6" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5" },
    ],
    notes: "Strong for CV rewriting and career reasoning.",
  },
  {
    key: "codex",
    label: "Codex",
    command: "codex",
    detected: false,
    selected: false,
    modelFlag: "--model",
    availableModels: [
      { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
    ],
    notes: "Strong for code and local app automation.",
  },
  {
    key: "opencode",
    label: "OpenCode",
    command: "opencode",
    detected: false,
    selected: false,
    modelFlag: "--model",
    availableModels: [
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
      { id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    ],
    notes: "Optional coding CLI adapter.",
  },
];

const workspaces: PersonWorkspace[] = [
  {
    id: "workspace_self",
    label: "My profile",
    relationship: "self",
    profile,
    masterCvId: "cv_master",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
];

export function createInitialData(): AppData {
  return {
    dataVersion: 1,
    workspaces,
    profile,
    masterCv: {
      id: "cv_master",
      title: "Master CV",
      language: "en",
      template: "swiss",
      style: defaultCvStyle,
      sections: cvSections,
      updatedAt: nowIso(),
      translationGroupId: "cvgroup_master",
    },
    // No pre-seeded saved CV version — the Library shows "0 CVs" until the user builds
    // their master CV from documents. Job-specific versions are created on demand.
    cvVersions: [],
    sourceDocuments: [],
    pendingProfileFacts: [],
    cvProjects: [],
    roleTailorings: [],
    coverLetters: [],
    portals: defaultPortals,
    jobPosts: [],
    applications: [],
    aiProviders,
    aiPlans: [],
    aiProposals: [],
    aiConversations: [],
    jobEvaluations: [],
    artifactHistory: [],
    events: [],
    settings: {
      activeAiProvider: "agy",
      activeWorkspaceId: "workspace_self",
      language: "en",
      defaultCountry: "Switzerland",
      search: defaultSearch,
      onboardingComplete: false,
      dataVersion: 1,
    },
  };
}
