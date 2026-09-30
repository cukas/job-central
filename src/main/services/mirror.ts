import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppData,
  CoverLetter,
  CvDocument,
  CvVersion,
  JobPost,
  MirrorSyncStatus,
  Profile,
} from "../../shared/types.js";
import { coverLetterDocx, cvDocx } from "./docx.js";
import {
  applicationTimelineToMarkdown,
  coverLetterToMarkdown,
  cvToMarkdown,
  jobToMarkdown,
  notesToMarkdown,
  profileToMarkdown,
  sourceDocumentToMarkdown,
} from "./markdown.js";
import { countCvPages, generateCoverLetterPdf, generatePdf } from "./pdf.js";

// ── Folder-mirror engine ────────────────────────────────────────────────────
// Writes a one-way, human-browsable + AI-readable copy of all CVs/letters/profile
// into a user-chosen folder. workspace.json stays canonical; this folder is
// disposable output (external edits are overwritten on the next pass). Runs async,
// debounced and single-flight so it never blocks the UI, and degrades gracefully
// (a missing/unwritable folder never aborts or rolls back the canonical save).

const DEBOUNCE_MS = 500;
const MAX_DELAY_MS = 5000;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Make a single path segment safe on macOS / Linux / Windows.
export function sanitizeSegment(name: string): string {
  let s = (name ?? "").normalize("NFC").trim();
  s = s.replace(/[/\\?%*:|"<>]/g, "-"); // OS-illegal characters
  s = s.replace(/[\u0000-\u001f]/g, ""); // ASCII control characters
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[. ]+$/g, ""); // Windows forbids a trailing dot/space
  s = s.replace(/^\.+/, ""); // strip leading dots so "."/".." can't become a segment
  if (!s) s = "Untitled";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(s)) s = `${s}_`;
  return s;
}

function jobFolderBase(company?: string, role?: string): string {
  const c = sanitizeSegment(company || "Untitled Company");
  const r = sanitizeSegment(role || "Untitled Role");
  let combined = `${c} — ${r}`;
  if (combined.length > 80) combined = combined.slice(0, 80).trim();
  return combined || "Untitled";
}

// "Jane Doe" -> "Jane_Doe" so the documents a recruiter receives are
// named after the candidate (e.g. Jane_Doe_CV.pdf) instead of generic cv.pdf.
function nameSlug(profile: Profile): string {
  const slug = sanitizeSegment(profile.fullName || "").replace(/\s+/g, "_");
  return slug || "Candidate";
}

// A master CvDocument and a job CvVersion both carry title/template/style/sections,
// which is all the renderers read — treat the master as a version for rendering.
function asRenderable(cv: CvDocument | CvVersion): CvVersion {
  return cv as unknown as CvVersion;
}

type FolderIndex = Record<string, string>; // applicationId -> Jobs/ subfolder name

export class MirrorService {
  private status: MirrorSyncStatus = { state: "disabled" };
  private onStatusCb?: (status: MirrorSyncStatus) => void;
  // Hash of the last successfully written source per output path / doc trio — lets
  // us skip unchanged work (PDF/DOCX rendering is expensive).
  private sigCache = new Map<string, string>();
  private pending?: AppData;
  private debounceTimer?: NodeJS.Timeout;
  private firstScheduledAt = 0;
  private running = false;
  private queued = false;

  onStatus(cb: (status: MirrorSyncStatus) => void) {
    this.onStatusCb = cb;
  }

  getStatus(): MirrorSyncStatus {
    return this.status;
  }

  private setStatus(partial: Partial<MirrorSyncStatus>) {
    this.status = { ...this.status, ...partial };
    this.onStatusCb?.(this.status);
  }

  private isEnabled(data: AppData): boolean {
    return Boolean(data.settings.workspaceFolder?.enabled && data.settings.workspaceFolder?.rootPath);
  }

  // Called after every DataStore save. Cheap: stores the latest data and (re)arms a
  // debounce; the actual disk work happens in flush().
  schedule(data: AppData) {
    if (!this.isEnabled(data)) {
      // Turning the mirror off must cancel any armed flush + drop the stale snapshot,
      // otherwise a previously-scheduled run could still write after the user disabled it.
      this.pending = undefined;
      this.queued = false;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
      }
      if (this.status.state !== "disabled") this.setStatus({ state: "disabled", rootPath: undefined });
      return;
    }
    this.pending = data;
    const now = Date.now();
    if (!this.debounceTimer) this.firstScheduledAt = now;
    else clearTimeout(this.debounceTimer);
    const sinceFirst = now - this.firstScheduledAt;
    const delay = sinceFirst >= MAX_DELAY_MS ? 0 : Math.min(DEBOUNCE_MS, MAX_DELAY_MS - sinceFirst);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.flush();
    }, delay);
  }

  // Force a full re-mirror now (used on first folder selection / "Re-sync now"):
  // clears the skip cache so every artifact is rewritten, waits out any in-flight
  // pass, then reconciles to completion so the returned status is accurate.
  async resync(data: AppData): Promise<MirrorSyncStatus> {
    this.sigCache.clear();
    this.pending = data;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 50));
    await this.flush();
    return this.status;
  }

  // Hard-delete the on-disk mirror this app wrote into the user's chosen folder. Used by
  // "Reset everything": removes ONLY the app-managed entries (Me/, Jobs/, and the
  // .jobcentral index) so unrelated files the user keeps in the same folder survive.
  // Cancels any armed flush and waits out an in-flight one first, so a debounced write
  // can't re-create the files after we delete them. Best-effort: a failed delete (e.g.
  // permissions) must not block the store reset.
  async purge(root: string): Promise<void> {
    this.pending = undefined;
    this.queued = false;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 50));
    this.sigCache.clear();
    for (const rel of ["Me", "Jobs", ".jobcentral"]) {
      // Best-effort: a failed delete (permissions, locked file) must not block the
      // store reset, but log it so a silent leftover folder isn't a mystery later.
      await rm(path.join(root, rel), { recursive: true, force: true }).catch((error) => {
        console.warn(`[mirror] purge: could not remove ${rel}:`, (error as Error).message);
      });
    }
    this.setStatus({ state: "disabled", rootPath: undefined });
  }

  private async flush() {
    if (this.running) {
      this.queued = true;
      return;
    }
    const data = this.pending;
    if (!data) return;
    this.running = true;
    try {
      const snapshot = structuredClone(data);
      await this.reconcile(snapshot);
    } catch (error) {
      this.setStatus({ state: "error", lastError: (error as Error).message });
    } finally {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.flush();
      }
    }
  }

  private async loadIndex(root: string): Promise<FolderIndex> {
    try {
      const raw = await readFile(path.join(root, ".jobcentral", "folder-index.json"), "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return {};
      // The index lives in a user-writable folder, and its values feed rename()/rm().
      // Trust nothing: keep only entries that are a single safe path segment, so a
      // hand-edited "../.." can never escape Jobs/ during cleanup or rename.
      const safe: FolderIndex = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== "string" || !value) continue;
        if (value === "." || value === ".." || value.includes("/") || value.includes("\\")) continue;
        if (path.basename(value) !== value) continue;
        safe[key] = value;
      }
      return safe;
    } catch {
      return {};
    }
  }

  private async saveIndex(root: string, index: FolderIndex) {
    const dir = path.join(root, ".jobcentral");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "folder-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }

  // Write a text file only if its content changed since we last wrote it.
  private async writeText(abs: string, content: string) {
    const h = sha(content);
    if (this.sigCache.get(abs) === h) return;
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    this.sigCache.set(abs, h);
  }

  // Delete generated files we no longer own in a managed directory — e.g. a cover
  // letter the user deleted, or a job's CV that was unlinked. Only touches the given
  // extensions and only files whose stem isn't in keepStems, so user files in our
  // managed folders aren't collateral. Keeps the mirror a true reflection of state.
  private async pruneDirExtras(dir: string, keepStems: Set<string>, exts: string[]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!exts.includes(ext)) continue;
      const stem = entry.slice(0, entry.length - ext.length);
      if (keepStems.has(stem)) continue;
      const abs = path.join(dir, entry);
      try {
        await rm(abs, { force: true });
      } catch {
        /* best-effort */
      }
      this.sigCache.delete(abs);
      this.sigCache.delete(path.join(dir, stem));
    }
  }

  // Write a CV as .md + .pdf + .docx, skipping the (expensive) render when the
  // source signature is unchanged.
  // `targetPages` (the master's page count) fits a tailored variant into the same number of pages
  // as the master — the SAME fit-to-target the live preview and the manual export apply, so the
  // mirrored job-folder PDF matches what the user sees on screen (without it the folder PDF was
  // exported unscaled and spilled onto extra pages). Undefined for the master itself.
  private async writeCvTrio(base: string, profile: Profile, cv: CvDocument | CvVersion, targetPages?: number) {
    const md = cvToMarkdown(profile, cv);
    const sig = sha(`${md}::${cv.template}::${JSON.stringify(cv.style)}::${profile.photoDataUrl ?? ""}::tp${targetPages ?? 0}`);
    if (this.sigCache.get(base) === sig) return;
    await mkdir(path.dirname(base), { recursive: true });
    await writeFile(`${base}.md`, md, "utf8");
    await generatePdf(profile, asRenderable(cv), `${base}.pdf`, targetPages);
    await writeFile(`${base}.docx`, cvDocx(profile, asRenderable(cv)));
    this.sigCache.set(base, sig);
  }

  // Write a cover/motivation letter as .md + .pdf + .docx, with the same skip cache.
  private async writeLetterTrio(base: string, profile: Profile, letter: CoverLetter, job?: JobPost) {
    const md = coverLetterToMarkdown(profile, letter, job);
    const sig = sha(`${md}::${profile.fullName}::${profile.email}`);
    if (this.sigCache.get(base) === sig) return;
    await mkdir(path.dirname(base), { recursive: true });
    await writeFile(`${base}.md`, md, "utf8");
    await generateCoverLetterPdf(profile, letter, job, `${base}.pdf`);
    await writeFile(`${base}.docx`, coverLetterDocx(profile, letter, job));
    this.sigCache.set(base, sig);
  }

  private async reconcile(data: AppData) {
    const root = data.settings.workspaceFolder?.rootPath;
    if (!this.isEnabled(data) || !root) {
      this.setStatus({ state: "disabled", rootPath: undefined });
      return;
    }
    this.setStatus({ state: "syncing", rootPath: root, lastError: undefined });

    // Guard: the chosen folder's parent must still exist. If the user deleted/moved
    // the location we surface an error rather than silently resurrecting it elsewhere.
    if (!(await pathExists(path.dirname(root)))) {
      this.setStatus({ state: "error", lastError: "The selected folder location no longer exists." });
      return;
    }

    const meDir = path.join(root, "Me");
    const refDir = path.join(meDir, "reference-letters");
    const lettersDir = path.join(meDir, "cover-letters");
    const jobsDir = path.join(root, "Jobs");
    await mkdir(refDir, { recursive: true });
    await mkdir(lettersDir, { recursive: true });
    await mkdir(jobsDir, { recursive: true });

    const profile = data.profile;

    // ── Me/ ──────────────────────────────────────────────────────────────────
    await this.writeText(
      path.join(meDir, "profile.md"),
      profileToMarkdown({
        profile,
        master: data.masterCv,
        sourceDocuments: data.sourceDocuments,
        approvedFacts: data.pendingProfileFacts,
      }),
    );
    await this.writeCvTrio(path.join(meDir, "master-cv"), profile, data.masterCv);
    // Bilingual: the other-language master (if it exists) mirrors alongside, suffixed
    // by language — e.g. master-cv.de.{md,pdf,docx} next to master-cv.{md,pdf,docx}.
    if (data.masterCvTranslation) {
      await this.writeCvTrio(path.join(meDir, `master-cv.${data.masterCvTranslation.language}`), profile, data.masterCvTranslation);
    }

    const refUsed = new Set<string>();
    const refStems = new Set<string>();
    for (const doc of data.sourceDocuments) {
      let name = sanitizeSegment(doc.name.replace(/\.[a-z0-9]+$/i, "")) || "document";
      while (refUsed.has(name.toLowerCase())) name = `${name} (${doc.id.slice(-4)})`;
      refUsed.add(name.toLowerCase());
      refStems.add(name);
      await this.writeText(path.join(refDir, `${name}.md`), sourceDocumentToMarkdown(doc));
    }
    await this.pruneDirExtras(refDir, refStems, [".md"]);

    const jobsById = new Map(data.jobPosts.map((job) => [job.id, job]));
    const lettersByJob = new Map<string, CoverLetter[]>();
    for (const letter of data.coverLetters) {
      const list = lettersByJob.get(letter.jobId) ?? [];
      list.push(letter);
      lettersByJob.set(letter.jobId, list);
    }

    // All cover letters, aggregated under Me/cover-letters/.
    const letterUsed = new Set<string>();
    const letterStems = new Set<string>();
    for (const letter of data.coverLetters) {
      const job = jobsById.get(letter.jobId);
      let base = sanitizeSegment(letter.title || (job ? `${job.company} - ${job.title}` : "motivation")) || "motivation";
      while (letterUsed.has(base.toLowerCase())) base = `${base} (${letter.id.slice(-4)})`;
      letterUsed.add(base.toLowerCase());
      letterStems.add(base);
      await this.writeLetterTrio(path.join(lettersDir, base), profile, letter, job);
    }
    await this.pruneDirExtras(lettersDir, letterStems, [".md", ".pdf", ".docx"]);

    // ── Jobs/ ──────────────────────────────────────────────────────────────────
    const cvById = new Map(data.cvVersions.map((cv) => [cv.id, cv]));
    // Measure the master ONCE so every tailored variant fits into the master's page count, exactly
    // as the preview/manual export do. Non-fatal: if measurement fails, variants export unscaled.
    const masterPages = await countCvPages(profile, data.masterCv).catch((error) => {
      console.warn("mirror — could not measure master page count; variants exported unscaled", error);
      return undefined;
    });
    const oldIndex = await this.loadIndex(root);
    const newIndex: FolderIndex = {};
    const usedNames = new Map<string, string>(); // folderName(lower) -> appId

    for (const application of data.applications) {
      const job = jobsById.get(application.jobPostId);
      const baseName = jobFolderBase(job?.company, job?.title);
      let folderName = baseName;
      let n = 2;
      while (usedNames.has(folderName.toLowerCase()) && usedNames.get(folderName.toLowerCase()) !== application.id) {
        folderName = `${baseName} (${n++})`;
      }
      usedNames.set(folderName.toLowerCase(), application.id);

      // Reconcile a rename: the canonical company/role changed → rename the existing
      // folder instead of orphaning it.
      const prior = oldIndex[application.id];
      if (prior && prior !== folderName) {
        const priorAbs = path.join(jobsDir, prior);
        const nextAbs = path.join(jobsDir, folderName);
        if ((await pathExists(priorAbs)) && !(await pathExists(nextAbs))) {
          try {
            await rename(priorAbs, nextAbs);
            // Reseat skip-cache keys so renamed files aren't needlessly rewritten.
            // Match on a path boundary so a folder isn't confused with a sibling whose
            // name it's a prefix of (e.g. "Acme — Eng" vs "Acme — Eng (2)").
            for (const key of [...this.sigCache.keys()]) {
              if (key === priorAbs || key.startsWith(priorAbs + path.sep)) {
                this.sigCache.set(nextAbs + key.slice(priorAbs.length), this.sigCache.get(key)!);
                this.sigCache.delete(key);
              }
            }
          } catch {
            /* best-effort: fall through and write into the new folder */
          }
        }
      }

      const dir = path.join(jobsDir, folderName);
      await mkdir(dir, { recursive: true });
      newIndex[application.id] = folderName;

      // The candidate's own documents carry their name (Jane_Doe_CV.pdf) so the
      // files are recruiter-ready straight out of the folder. Internal files
      // (job-posting/notes/timeline) keep generic names.
      const docStem = nameSlug(profile);
      const cvStem = `${docStem}_CV`;
      const letterStem = `${docStem}_Motivation`;
      const keepStems = new Set<string>(["notes", "timeline"]);
      if (job) {
        await this.writeText(path.join(dir, "job-posting.md"), jobToMarkdown(job));
        keepStems.add("job-posting");
      }
      const cv = application.cvVersionId ? cvById.get(application.cvVersionId) : undefined;
      if (cv) {
        await this.writeCvTrio(path.join(dir, cvStem), profile, cv, masterPages);
        keepStems.add(cvStem);
      }
      const letters = lettersByJob.get(application.jobPostId) ?? [];
      if (letters[0]) {
        await this.writeLetterTrio(path.join(dir, letterStem), profile, letters[0], job);
        keepStems.add(letterStem);
      }
      await this.writeText(path.join(dir, "notes.md"), notesToMarkdown(application, job));
      await this.writeText(path.join(dir, "timeline.md"), applicationTimelineToMarkdown(application, job));
      // Drop a stale cv.*/motivation.* if the CV or letter was unlinked/removed.
      await this.pruneDirExtras(dir, keepStems, [".md", ".pdf", ".docx"]);
    }

    // Orphan cleanup: remove folders we created for applications that no longer exist.
    // loadIndex() already guarantees `folder` is a single safe segment, so the
    // recursive rm cannot escape Jobs/.
    for (const [appId, folder] of Object.entries(oldIndex)) {
      if (!newIndex[appId]) {
        const orphanAbs = path.join(jobsDir, folder);
        try {
          await rm(orphanAbs, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
        for (const key of [...this.sigCache.keys()]) {
          if (key === orphanAbs || key.startsWith(orphanAbs + path.sep)) this.sigCache.delete(key);
        }
      }
    }

    await this.saveIndex(root, newIndex);
    this.setStatus({ state: "ok", rootPath: root, lastSyncedAt: new Date().toISOString(), lastError: undefined });
  }

  // Resolve the absolute path a Library "open in file manager" action should reveal.
  async resolvePath(
    data: AppData,
    target: "root" | "me" | "application",
    applicationId?: string,
  ): Promise<string | undefined> {
    const root = data.settings.workspaceFolder?.rootPath;
    if (!root) return undefined;
    if (target === "me") return path.join(root, "Me");
    if (target === "application" && applicationId) {
      const index = await this.loadIndex(root);
      const folder = index[applicationId];
      return folder ? path.join(root, "Jobs", folder) : path.join(root, "Jobs");
    }
    return root;
  }
}

export const mirror = new MirrorService();
