import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppData, AppEvent, EventType } from "../shared/types.js";
import { hydrateCvSections } from "../shared/cvModel.js";
import { normalizeJobUrlKey } from "../shared/jobUrl.js";
import { createInitialData, nowIso } from "./seed.js";
import { mirror } from "./services/mirror.js";

const DATA_VERSION = 1;

const makeId = (prefix: string) => `${prefix}_${randomUUID()}`;

function mergeDefaults<T extends { id: string }>(stored: T[] | undefined, defaults: T[]) {
  if (!stored) return defaults;
  const storedIds = new Set(stored.map((item) => item.id));
  return [...stored, ...defaults.filter((item) => !storedIds.has(item.id))];
}

function looksLikeEnglishCvContent(sections: AppData["masterCv"]["sections"] | undefined): boolean {
  const text = (sections ?? [])
    .map((section) => `${String(section?.title ?? "")}\n${String(section?.content ?? "")}`)
    .join("\n")
    .toLowerCase();
  if (!text.trim()) return false;
  const titles = (sections ?? []).map((section) => String(section?.title ?? "").trim().toLowerCase());
  const hasEnglishDefaultTitles =
    titles.includes("profile") &&
    (titles.includes("professional experience") || titles.includes("experience")) &&
    titles.includes("education") &&
    titles.includes("languages");
  if (!hasEnglishDefaultTitles) return false;
  const englishHits = [
    "professional summary",
    "professional experience",
    "work experience",
    "education",
    "languages",
    "building",
    "designing",
    "operating",
    "track record",
    "development",
  ].filter((term) => text.includes(term)).length;
  const germanHits = [
    "berufserfahrung",
    "ausbildung",
    "kenntnisse",
    "fähigkeiten",
    "sprachen",
    "entwicklung",
    "aufbau",
    "betrieb",
    "erfahrung",
  ].filter((term) => text.includes(term)).length;
  return englishHits >= 2 && englishHits > germanHits;
}

export class DataStore {
  private data?: AppData;
  private startupSyncDone = false;
  private _dataDir?: string;

  // Resolve the data dir LAZILY (not in the constructor) so main.ts can call
  // app.setName("job-central") before the userData path is first read. Without
  // that, the unpackaged dev build (Electron's default name "Electron") and the
  // packaged app ("job-central") end up with two separate data folders.
  private get dataDir(): string {
    // `??=` keeps the return type `string` (the `if (!x) x = …; return x` form left it
    // `string | undefined` to stricter type-checkers even though the value is always set).
    return (this._dataDir ??= path.join(app.getPath("userData"), "job-central-data"));
  }

  private get dataPath(): string {
    return path.join(this.dataDir, "workspace.json");
  }

  async load(): Promise<AppData> {
    if (this.data) return this.data;
    await mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await readFile(this.dataPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppData>;
      this.data = this.withDefaults(parsed);
      // Startup sync (once): bring the folder mirror up to date with stored data.
      // Guarded so read-only handlers that call load() don't re-arm a full reconcile
      // on every state fetch — writes drive the mirror via update() thereafter.
      if (!this.startupSyncDone) {
        this.startupSyncDone = true;
        mirror.schedule(this.data);
      }
      return this.data;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      this.data = createInitialData();
      await this.save(this.data);
      return this.data;
    }
  }

  async update(mutator: (data: AppData) => void | Promise<void>): Promise<AppData> {
    const data = await this.load();
    await mutator(data);
    await this.save(data);
    // Write-through to the user's folder mirror after the canonical save succeeds.
    // Fire-and-forget + debounced: a mirror failure never blocks or rolls back here.
    mirror.schedule(data);
    return data;
  }

  // Wipe everything back to a fresh install (profile, CVs, letters, jobs,
  // applications, settings). Irreversible — the IPC layer confirms first.
  async reset(): Promise<AppData> {
    // Capture the mirror root BEFORE re-seeding wipes the folder config, then delete the
    // app-managed on-disk copies — otherwise the user's CVs/letters/profile survive on
    // disk and the path is lost, so nothing can ever clean them up.
    const root = this.data?.settings?.workspaceFolder?.rootPath;
    if (root) await mirror.purge(root);
    this.data = createInitialData();
    await this.save(this.data);
    return this.data;
  }

  emit(input: {
    type: EventType;
    aggregateType: AppEvent["aggregateType"];
    aggregateId: string;
    payload: Record<string, unknown>;
  }): Promise<AppData> {
    return this.update((data) => {
      data.events = [{
        id: makeId("event"),
        type: input.type,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        createdAt: nowIso(),
      }, ...data.events];
    });
  }

  makeId(prefix: string) {
    return makeId(prefix);
  }

  private async save(data: AppData) {
    data.dataVersion = DATA_VERSION;
    data.settings.dataVersion = DATA_VERSION;
    const tmpPath = `${this.dataPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.dataPath);
  }

  private withDefaults(parsed: Partial<AppData>): AppData {
    const initial = createInitialData();
    const settings = {
      ...initial.settings,
      ...parsed.settings,
      search: {
        ...initial.settings.search,
        ...parsed.settings?.search,
      },
    };
    delete (settings as Record<string, unknown>).kern;
    const storedWorkspaces = parsed.workspaces ?? initial.workspaces;
    const preferredWorkspace =
      storedWorkspaces.find((workspace) => workspace.relationship === "self") ??
      storedWorkspaces.find((workspace) => workspace.id === settings.activeWorkspaceId) ??
      storedWorkspaces[0] ??
      initial.workspaces[0];
    const profile = preferredWorkspace?.profile
      ? { ...initial.profile, ...preferredWorkspace.profile }
      : { ...initial.profile, ...parsed.profile };
    // Heal the old seed headline: it used to default to the literal placeholder
    // sentence, which then showed up as the CV's title. Replace an empty/placeholder
    // headline with the candidate's real target role(s) so it's a usable, editable title.
    const LEGACY_HEADLINE = "Target role or professional headline";
    if (!profile.headline?.trim() || profile.headline.trim() === LEGACY_HEADLINE) {
      const roleSeed = (profile.targetRoles?.length ? profile.targetRoles : parsed.settings?.search?.targetRoles ?? [])
        .map((role) => role.trim())
        .filter(Boolean);
      profile.headline = roleSeed.join(" · ");
    }
    const accountWorkspace = {
      ...initial.workspaces[0],
      id: "workspace_self",
      label: "My profile",
      relationship: "self" as const,
      profile,
      masterCvId: parsed.masterCv?.id ?? initial.masterCv.id,
      updatedAt: nowIso(),
    };
    const legacySeedJobIds = new Set(["job_lakera_sa", "job_smg_staff_frontend"]);
    const jobPosts = (parsed.jobPosts ?? initial.jobPosts).filter((job) => !legacySeedJobIds.has(job.id));
    const applications = (parsed.applications ?? initial.applications).filter((application) => !legacySeedJobIds.has(application.jobPostId));
    const companyPortalNames = new Set(["lakera", "scandit"]);
    const globalDefaultPortalIds = new Set(["portal_google_jobs", "portal_swissdevjobs", "portal_jobs_ch", "portal_indeed_ch", "portal_linkedin_jobs"]);
    // Portals the user deleted stay deleted even though mergeDefaults would re-seed them.
    const removedPortalIds = new Set(settings.removedPortalIds ?? []);
    const portals = mergeDefaults(parsed.portals, initial.portals)
      .filter((portal) => !removedPortalIds.has(portal.id))
      .filter((portal) => !companyPortalNames.has(portal.name.trim().toLowerCase()))
      .map((portal) => globalDefaultPortalIds.has(portal.id) ? { ...portal, positiveKeywords: [], negativeKeywords: [] } : portal);
    const storedProviders = parsed.aiProviders ?? [];
    const aiProviders = initial.aiProviders.map((base) => {
      const stored = storedProviders.find((provider) => provider.key === base.key);
      return {
        ...base,
        ...stored,
        modelFlag: stored?.modelFlag ?? base.modelFlag,
        // "" means "use the CLI's own logged-in default model" — preserve it.
        selectedModel: stored?.selectedModel ?? base.selectedModel,
        availableModels: stored?.availableModels?.length ? stored.availableModels : base.availableModels,
      };
    });

    const masterStyle = {
      ...initial.masterCv.style,
      ...(parsed.masterCv?.style ?? {}),
    };

    // First-run gating: show onboarding only for genuinely fresh installs.
    // Existing users (any real activity) are treated as already onboarded so
    // they are never forced back through the wizard or lose their data.
    const storedSearch = parsed.settings?.search;
    const hadConfiguredSearch = Boolean(
      storedSearch && [
        storedSearch.targetRoles,
        storedSearch.locations,
        storedSearch.positiveKeywords,
        storedSearch.negativeKeywords,
        storedSearch.targetCompanies,
        storedSearch.excludedCompanies,
      ].some((list) => list?.length),
    );
    const hadPriorUse = Boolean(
      (profile.fullName?.trim() && profile.fullName.trim() !== "Your Name") ||
      parsed.jobPosts?.length ||
      parsed.applications?.length ||
      parsed.coverLetters?.length ||
      parsed.cvVersions?.some((cv) => cv.sections?.some((section) => section.content?.trim())) ||
      hadConfiguredSearch,
    );
    const onboardingComplete = parsed.settings?.onboardingComplete ?? hadPriorUse;
    const storedMasterCv = parsed.masterCv ?? initial.masterCv;
    const storedMasterLanguage: "en" | "de" = storedMasterCv.language === "de" ? "de" : "en";
    const masterCvLanguage: "en" | "de" =
      storedMasterLanguage === "de" &&
      settings.language === "de" &&
      !parsed.masterCvTranslation &&
      looksLikeEnglishCvContent(storedMasterCv.sections)
        ? "en"
        : storedMasterLanguage;
    const removedJobUrls = [...new Set((settings.removedJobUrls ?? []).map(normalizeJobUrlKey).filter(Boolean))];
    const removedJobsByUrl = new Map(
      (settings.removedJobs ?? [])
        .map((job) => ({ ...job, url: normalizeJobUrlKey(job.url) }))
        .filter((job) => job.url)
        .map((job) => [job.url, job]),
    );
    for (const url of removedJobUrls) {
      if (!removedJobsByUrl.has(url)) removedJobsByUrl.set(url, { url, removedAt: "" });
    }

    return {
      ...initial,
      ...parsed,
      dataVersion: DATA_VERSION,
      workspaces: [accountWorkspace],
      profile,
      masterCv: {
        ...initial.masterCv,
        ...parsed.masterCv,
        language: masterCvLanguage,
        style: masterStyle,
        sections: hydrateCvSections(parsed.masterCv?.sections ?? initial.masterCv.sections),
        // Bilingual: every CV belongs to a translation group so its DE/EN sibling
        // can be found. Existing single-language master CVs adopt the stable group id.
        translationGroupId: parsed.masterCv?.translationGroupId ?? initial.masterCv.translationGroupId ?? "cvgroup_master",
      },
      // Other-language sibling of the master CV (created on demand). Mirror the master's
      // style/section defaulting so a style-schema migration reaches the sidecar too.
      masterCvTranslation: parsed.masterCvTranslation
        ? {
            ...parsed.masterCvTranslation,
            style: { ...masterStyle, ...(parsed.masterCvTranslation.style ?? {}) },
            sections: hydrateCvSections(parsed.masterCvTranslation.sections),
          }
        : undefined,
      cvVersions: (parsed.cvVersions ?? initial.cvVersions).map((cv) => ({
        ...cv,
        style: {
          ...masterStyle,
          ...(cv.style ?? {}),
        },
        sections: hydrateCvSections(cv.sections),
        // Existing versions become their own translation group; a translated sibling
        // later shares this id. language/updatedAt backfill for pairing + staleness.
        language: cv.language ?? settings.language,
        translationGroupId: cv.translationGroupId ?? cv.id,
        updatedAt: cv.updatedAt ?? cv.createdAt,
      })),
      sourceDocuments: parsed.sourceDocuments ?? initial.sourceDocuments ?? [],
      pendingProfileFacts: parsed.pendingProfileFacts ?? initial.pendingProfileFacts ?? [],
      cvProjects: parsed.cvProjects ?? initial.cvProjects ?? [],
      roleTailorings: parsed.roleTailorings ?? initial.roleTailorings ?? [],
      coverLetters: (parsed.coverLetters ?? initial.coverLetters).map((letter) => ({
        ...letter,
        translationGroupId: letter.translationGroupId ?? letter.id,
      })),
      portals,
      jobPosts,
      applications,
      aiProviders,
      aiPlans: parsed.aiPlans ?? initial.aiPlans,
      aiProposals: parsed.aiProposals ?? [],
      aiConversations: parsed.aiConversations ?? [],
      jobEvaluations: parsed.jobEvaluations ?? [],
      artifactHistory: parsed.artifactHistory ?? [],
      events: parsed.events ?? initial.events,
      settings: {
        ...settings,
        activeWorkspaceId: "workspace_self",
        removedJobUrls: [...new Set([...removedJobUrls, ...removedJobsByUrl.keys()])],
        removedJobs: [...removedJobsByUrl.values()].sort((a, b) => (b.removedAt || "").localeCompare(a.removedAt || "")),
        // Gemini CLI is dropped (Google stops serving AI Pro/Ultra to it ~June
        // 2026); anyone pointed at it — or any provider no longer seeded — moves
        // to the Antigravity CLI (agy).
        activeAiProvider: aiProviders.some((provider) => provider.key === settings.activeAiProvider)
          ? settings.activeAiProvider
          : "agy",
        onboardingComplete,
      },
    };
  }
}

export const store = new DataStore();
