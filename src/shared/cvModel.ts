import type { CvEntry, CvField, CvRichTextBlock, CvSection, StructuredCvSection } from "./types.js";

type CvSectionKind = CvSection["kind"];

export interface CvEntryDraft {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  body: string;
  visible?: boolean;
}

let idCounter = 0;

function makeId(prefix: string) {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

function textBlock(id: string, type: CvRichTextBlock["type"], text: string): CvRichTextBlock {
  return { id, type, runs: text ? [{ text }] : [] };
}

function blockText(block: CvRichTextBlock) {
  return block.runs.map((run) => run.text).join("");
}

function getField(entry: CvEntry, key: CvField["key"]) {
  return entry.fields.find((field) => field.key === key)?.value ?? "";
}

function field(key: CvField["key"], label: string, value: string): CvField {
  return { key, label, value };
}

function dateLine(line: string) {
  return /^((?:\d{1,2}[/.]\d{4}|\d{4})\s*(?:[-–—]\s*(?:\d{1,2}[/.]\d{4}|\d{4}|present|heute|aktuell|current))?)(?:\s+|$)/i.test(line);
}

// A "Company | Title | Dates" experience header (pipe-delimited, spaces around
// the pipe — the format the AI emits and the format CVs are pasted in).
function pipeHeader(line: string) {
  return /\s\|\s/.test(line);
}

// True when a string contains a year or month/year, optionally as a range ending
// in present/heute/etc. — used to pick the date segment out of a pipe header and
// to tell a job header apart from a body sentence.
function looksLikeDate(value: string) {
  return /(?:\d{1,2}[/.]\d{4}|\d{4})(?:\s*[-–—]\s*(?:\d{1,2}[/.]\d{4}|\d{4}|present|heute|aktuell|current|now|today))?/i.test(value);
}

function isBulletLine(line: string) {
  return /^\s*(?:[-*•]|\d+\.)\s+/.test(line);
}

function splitDateTitle(line: string) {
  const match = line.match(/^((?:\d{1,2}[/.]\d{4}|\d{4})\s*(?:[-–—]\s*(?:\d{1,2}[/.]\d{4}|\d{4}|present|heute|aktuell|current))?)\s*(.*)$/i);
  if (!match) return { meta: "", title: line };
  return { meta: match[1].trim(), title: match[2].trim() };
}

function titleish(line: string) {
  return line.length <= 72 && !line.startsWith("-") && !/[.!?]$/.test(line) && !/,\s*(and|or)\s+/i.test(line);
}

// A "Role — Org · Dates" header whose date sits at the END after a middot — the
// format the deterministic renderer (renderExperienceEntry) emits, as opposed to
// the AI's "Company | Role | Dates" pipe header or a date-leading line. The strong
// signal is a dated trailing "· <date/range>" segment (body prose never ends that
// way); length is NOT a reliable cap here since "Role — Org" headers run long, so
// we only also require the title part not to read like a full sentence.
function middotDatedHeader(line: string) {
  const dot = line.lastIndexOf("·");
  if (dot <= 0 || isBulletLine(line) || !looksLikeDate(line.slice(dot + 1))) return false;
  const head = line.slice(0, dot).trim();
  return head.length > 0 && !/[.!?]$/.test(head);
}

function splitTitleSubtitle(value: string) {
  const [title, ...rest] = value.split(",").map((part) => part.trim()).filter(Boolean);
  return { title: title || value, subtitle: rest.join(", ") };
}

// Strip markdown emphasis (**bold**, __, `code`) and stray table pipes that AI
// output injects, so structured CV fields hold clean plain text instead of
// showing literal "**KYBURZ**" or "| **MAS". Bold is handled by the rich-text
// model, not by these markers.
export function stripContentMarkdown(value: string, options?: { trim?: boolean }): string {
  const cleaned = value
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/^\s*\|\s*/, "")
    .replace(/\s*\|\s*$/, "");
  // Trimming is wanted when cleaning AI/parser output, but it must NOT run on the
  // live round-trip of editable structured fields: a space typed at the end of a
  // title/subtitle would be stripped on the next render, so the space key appears
  // dead (the user can only insert spaces mid-word with the mouse). Callers editing
  // live fields pass { trim: false }.
  return options?.trim === false ? cleaned : cleaned.trim();
}

function linesFromContent(content: string) {
  return content.split(/\n/).map((line) => stripContentMarkdown(line.trim())).filter(Boolean);
}

export function defaultEntryForSection(section: Pick<CvSection, "id" | "kind">): CvEntryDraft {
  const id = `${section.id}_entry_${makeId("entry")}`;
  if (section.kind === "experience") return { id, title: "New employer", subtitle: "Job title", meta: "MM/YYYY - Present", body: "- Add impact, scope, and proof points.", visible: true };
  if (section.kind === "languages") return { id, title: "New language", subtitle: "Fluent", meta: "", body: "", visible: true };
  if (section.kind === "skills") return { id, title: "New skill group", subtitle: "Expert", meta: "", body: "Add tools, strengths, and keywords.", visible: true };
  if (section.kind === "education") return { id, title: "Degree or program", subtitle: "School", meta: "MM/YYYY - MM/YYYY", body: "", visible: true };
  if (section.kind === "speaking") return { id, title: "Talk or course", subtitle: "Host", meta: "MM/YYYY", body: "Describe topic, audience, and outcome.", visible: true };
  if (section.kind === "projects") return { id, title: "Project name", subtitle: "Role / stack / link", meta: "", body: "Describe the problem, your role, and the result.", visible: true };
  if (section.kind === "certificates") return { id, title: "Certificate name", subtitle: "Issuer", meta: "YYYY", body: "", visible: true };
  if (section.kind === "courses") return { id, title: "Course name", subtitle: "Provider", meta: "YYYY", body: "", visible: true };
  if (section.kind === "awards") return { id, title: "Award name", subtitle: "Issuer", meta: "YYYY", body: "Why it matters.", visible: true };
  if (section.kind === "organisations") return { id, title: "Organisation", subtitle: "Role", meta: "YYYY - Present", body: "", visible: true };
  if (section.kind === "publications") return { id, title: "Publication title", subtitle: "Publisher / link", meta: "YYYY", body: "Short context.", visible: true };
  if (section.kind === "references") return { id, title: "Reference name", subtitle: "Relationship", meta: "", body: "Contact details or available on request.", visible: true };
  if (section.kind === "declaration") return { id, title: "Declaration", subtitle: "", meta: "", body: "I confirm that the information provided is accurate.", visible: true };
  if (section.kind === "profile") return { id, title: "Professional Summary", subtitle: "", meta: "", body: "Add another professional summary paragraph.", visible: true };
  return { id, title: "New entry", subtitle: "", meta: "", body: "", visible: true };
}

export function parseLegacyCvEntries(section: Pick<CvSection, "id" | "title" | "kind" | "content">): CvEntryDraft[] {
  const lines = linesFromContent(section.content);
  if (!lines.length) return [];

  if (section.kind === "profile") {
    const blocks = section.content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return (blocks.length ? blocks : [section.content.trim()]).map((block, index) => ({
      id: `${section.id}_entry_${index}`,
      title: index === 0 ? "Professional Summary" : `Professional Summary ${index + 1}`,
      subtitle: "",
      meta: "",
      body: block,
      visible: true,
    }));
  }

  if (section.kind === "experience") {
    // A new job starts at a "Company | Title | Dates" header or a line that opens
    // with a date range. Bullets and body prose never start a new entry — that is
    // why a flat "header / bullets / header / bullets" blob must split here into
    // one entry per job instead of collapsing into a single giant entry.
    const isEntryHeader = (line: string) =>
      !isBulletLine(line) && (dateLine(line) || (pipeHeader(line) && looksLikeDate(line)) || middotDatedHeader(line));
    const chunks: string[][] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (isEntryHeader(line) && current.length) {
        chunks.push(current);
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length) chunks.push(current);
    return chunks.map((chunk, index) => {
      const header = chunk[0];
      if (pipeHeader(header)) {
        // "Company | Title | Dates" → employer / job title / dates. The date can be
        // any segment (usually last); the rest are company then job-title parts.
        const parts = header.split("|").map((part) => part.trim()).filter(Boolean);
        const dateIndex = parts.findIndex(looksLikeDate);
        const meta = dateIndex >= 0 ? parts[dateIndex] : "";
        const rest = parts.filter((_, partIndex) => partIndex !== dateIndex);
        return {
          id: `${section.id}_entry_${index}`,
          title: rest[0] || section.title,
          subtitle: rest.slice(1).join(", "),
          meta,
          body: chunk.slice(1).join("\n"),
          visible: true,
        };
      }
      if (middotDatedHeader(header)) {
        // "Role — Org · Dates": pull the trailing date into meta and keep the rest
        // as the title, so each job becomes its own entry instead of every bullet
        // piling into one list at the bottom.
        const dot = header.lastIndexOf("·");
        const meta = header.slice(dot + 1).trim();
        const split = splitTitleSubtitle(header.slice(0, dot).trim());
        return { id: `${section.id}_entry_${index}`, title: split.title, subtitle: split.subtitle, meta, body: chunk.slice(1).join("\n"), visible: true };
      }
      const first = splitDateTitle(header);
      const titleLine = first.title || chunk[1] || section.title;
      const split = splitTitleSubtitle(titleLine);
      return { id: `${section.id}_entry_${index}`, title: split.title, subtitle: split.subtitle, meta: first.meta, body: chunk.slice(first.title ? 1 : 2).join("\n"), visible: true };
    });
  }

  if (section.kind === "skills") {
    // Preferred format (what the AI is instructed to emit): one group per line as
    // "Group: item, item, item". Split each such line into its own entry so the
    // editor shows a clean per-group list instead of one giant blob. A label is a
    // short prefix before the first colon; everything after is the item list.
    // Lines without a colon are treated as wrapped continuation of the group above.
    const grouped: CvEntryDraft[] = [];
    let group: CvEntryDraft | undefined;
    for (const line of lines) {
      const match = line.match(/^([A-Za-zÄÖÜäöü][^:]{0,39}):\s*(\S.*)$/);
      if (match) {
        if (group) grouped.push(group);
        group = { id: `${section.id}_entry_${grouped.length}`, title: match[1].trim(), subtitle: "", meta: "", body: match[2].trim(), visible: true };
      } else if (group) {
        group.body = `${group.body} ${line.trim()}`.trim();
      } else {
        group = { id: `${section.id}_entry_${grouped.length}`, title: "", subtitle: "", meta: "", body: line.trim(), visible: true };
      }
    }
    if (group) grouped.push(group);
    if (grouped.filter((entry) => entry.title).length >= 2) return grouped;

    // Fallback: legacy "heading on its own line, details on the lines below" format.
    const entries: CvEntryDraft[] = [];
    let current: CvEntryDraft | undefined;
    lines.forEach((line, index) => {
      const previousBodyLine = current?.body.split(/\n/).filter(Boolean).at(-1) ?? "";
      const nextLine = lines[index + 1] ?? "";
      const nextLooksLikeDetail = nextLine.includes(",") || /^[a-zäöü]/.test(nextLine);
      const headingCandidate = line.length <= 48 &&
        /^[A-ZÄÖÜ]/.test(line) &&
        !line.includes(",") &&
        !line.endsWith("-") &&
        nextLooksLikeDetail &&
        !previousBodyLine.endsWith(",");
      if (headingCandidate && (!current || current.body.trim())) {
        if (current) entries.push(current);
        current = { id: `${section.id}_entry_${entries.length}`, title: line, subtitle: "", meta: "", body: "", visible: true };
      } else {
        current ??= { id: `${section.id}_entry_${entries.length}`, title: "", subtitle: "", meta: "", body: "", visible: true };
        current.body = [current.body, line].filter(Boolean).join("\n");
      }
    });
    if (current) entries.push(current);
    return entries.length ? entries : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim(), visible: true }];
  }

  if (section.kind === "languages") {
    if (lines.length > 1 && lines.every((line) => /^[^-–—:]+\s*[-–—:]\s*.*/.test(line))) {
      return lines.map((line, index) => {
        const [title, ...rest] = line.split(/\s*[-–—:]\s*/).map((part) => part.trim());
        return { id: `${section.id}_entry_${index}`, title: title || section.title, subtitle: rest.join(" - "), meta: "", body: "", visible: true };
      });
    }
    const blocks = section.content
      .split(/\n{2,}/)
      .map((block) => block.split(/\n/).map((line) => line.trim()).filter(Boolean))
      .filter((block) => block.length);
    const sourceBlocks = blocks.length > 1 ? blocks : [];
    if (!sourceBlocks.length) {
      for (let index = 0; index < lines.length; index += 2) sourceBlocks.push(lines.slice(index, index + 2));
    }
    const entries = sourceBlocks.map((block, index) => ({
      id: `${section.id}_entry_${index}`,
      title: block[0] ?? section.title,
      subtitle: block[1] ?? "",
      meta: "",
      body: block.slice(2).join("\n"),
      visible: true,
    }));
    return entries.length ? entries : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim(), visible: true }];
  }

  if (section.kind === "education" || section.kind === "speaking") {
    // Education/speaking entries arrive in three shapes, often mixed:
    //   • a degree/talk line followed by a "School | Dates" detail line (the format
    //     the deterministic renderer emits and CVs are pasted in) — ONE entry,
    //   • a single "04.2019 – 03.2022 Degree, School" leading-date line (our own
    //     serialization) — ONE entry,
    //   • a bare title line with no dates — ONE entry.
    // So we can't split per line (that turns each 2-line entry into two). Instead
    // we hold a title-only line "pending" so the next "School | Dates" line can fill
    // its subtitle + dates before it is flushed.
    const entries: CvEntryDraft[] = [];
    let pending: CvEntryDraft | null = null;
    const flush = () => { if (pending) { entries.push(pending); pending = null; } };
    const mk = (fields: Partial<CvEntryDraft>): CvEntryDraft => ({ id: "", title: "", subtitle: "", meta: "", body: "", visible: true, ...fields });
    for (const line of lines) {
      // "School | Dates" — date trailing after a pipe. Becomes the subtitle + dates
      // of the pending title; otherwise stands on its own as a school-only entry.
      const pipeIdx = line.indexOf(" | ");
      if (pipeIdx > 0 && looksLikeDate(line.slice(pipeIdx + 3)) && !looksLikeDate(line.slice(0, pipeIdx))) {
        const school = line.slice(0, pipeIdx).trim();
        const date = line.slice(pipeIdx + 3).trim();
        if (pending && !pending.meta) {
          pending.subtitle = pending.subtitle ? `${pending.subtitle}, ${school}` : school;
          pending.meta = date;
          flush();
        } else {
          flush();
          const split = splitTitleSubtitle(school);
          entries.push(mk({ title: split.title, subtitle: split.subtitle, meta: date }));
        }
        continue;
      }
      // Leading-date line: "04.2019 – 03.2022 Degree, School".
      const dated = splitDateTitle(line);
      if (dated.meta) {
        flush();
        const split = splitTitleSubtitle(dated.title || section.title);
        entries.push(mk({ title: split.title, subtitle: split.subtitle, meta: dated.meta }));
        continue;
      }
      // Plain title line (degree/talk with no dates): start a new entry and hold it
      // open so a following "School | Dates" detail line can complete it.
      flush();
      const split = splitTitleSubtitle(line);
      pending = mk({ title: split.title, subtitle: split.subtitle });
    }
    flush();
    const withIds = entries.map((entry, index) => ({ ...entry, id: `${section.id}_entry_${index}` }));
    return withIds.length ? withIds : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim(), visible: true }];
  }

  if (section.kind === "projects") {
    // A project block is "Project Name" or "Project Name · tool, tool" (the renderer
    // and AI format) or "Project Name | tool" followed by an optional summary line and
    // "- " bullets. A header is a non-bullet, title-shaped line that EITHER opens the
    // section, follows a bullet (the previous project's bullets ended), or carries a
    // "·" / "|" separator. Detecting it structurally — instead of only matching the
    // literal keywords "open source/github" — is what stops a tailored project
    // from collapsing its whole "Name · tools" line into the description body.
    const splitProjectHeader = (line: string): { title: string; subtitle: string } => {
      const dot = line.indexOf("·");
      if (dot > 0) return { title: line.slice(0, dot).trim(), subtitle: line.slice(dot + 1).trim() };
      if (pipeHeader(line)) {
        const parts = line.split("|").map((part) => part.trim()).filter(Boolean);
        return { title: parts[0] ?? line, subtitle: parts.slice(1).join(", ") };
      }
      return splitTitleSubtitle(line);
    };
    const entries: CvEntryDraft[] = [];
    let current: CvEntryDraft | undefined;
    let prevWasBullet = false;
    lines.forEach((line) => {
      // For a "Name · tools" / "Name | tools" header only the NAME before the separator
      // must look title-shaped; the tool list after it may run long, so the 72-char title
      // cap is applied to the head only (a tool-heavy header would otherwise fall into the
      // body). Plain lines (no separator) are still capped as a whole so prose stays body.
      const dot = line.indexOf("·");
      const pipe = line.search(/\s\|\s/);
      const sepIdx = dot >= 0 ? dot : pipe;
      const headPart = sepIdx >= 0 ? line.slice(0, sepIdx).trim() : line;
      const headerShaped = !isBulletLine(line) && titleish(headPart);
      const isHeader = headerShaped && (!current || prevWasBullet || sepIdx >= 0 || /open source|github\.com/i.test(line));
      if (isHeader) {
        if (current) entries.push(current);
        const split = splitProjectHeader(line);
        current = { id: `${section.id}_entry_${entries.length}`, title: split.title, subtitle: split.subtitle, meta: "", body: "", visible: true };
      } else {
        current ??= { id: `${section.id}_entry_${entries.length}`, title: section.title, subtitle: "", meta: "", body: "", visible: true };
        current.body = [current.body, line].filter(Boolean).join("\n");
      }
      prevWasBullet = isBulletLine(line);
    });
    if (current) entries.push(current);
    return entries.length ? entries : [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim(), visible: true }];
  }

  return [{ id: `${section.id}_entry_0`, title: section.title, subtitle: "", meta: "", body: section.content.trim(), visible: true }];
}

export function entryDraftToStructured(sectionKind: CvSectionKind, entry: CvEntryDraft, order: number): CvEntry {
  const bodyLines = entry.body.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const bullets: CvRichTextBlock[] = [];
  const blocks: CvRichTextBlock[] = [];
  bodyLines.forEach((line, index) => {
    const bullet = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.+)$/);
    if (bullet) bullets.push(textBlock(`${entry.id}_bullet_${index}`, "bullet", bullet[1]));
    else blocks.push(textBlock(`${entry.id}_block_${index}`, "paragraph", line));
  });
  const links = [...entry.body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\b(https?:\/\/[^\s)]+)/g)]
    .map((match) => ({ label: match[1] ?? match[3] ?? "Link", url: match[2] ?? match[3] ?? "" }))
    .filter((link) => link.url);

  return {
    id: entry.id,
    kind: sectionKind,
    fields: [
      field("title", "Title", entry.title),
      field("subtitle", "Subtitle", entry.subtitle),
      field("date", "Dates", entry.meta),
    ],
    blocks,
    bullets,
    links,
    visible: entry.visible ?? true,
    order,
  };
}

export function entryDraftFromStructured(entry: CvEntry): CvEntryDraft {
  const orderFromId = (id: string) => Number(id.match(/_(?:block|bullet)_(\d+)$/)?.[1] ?? "0");
  const lines = [
    ...entry.blocks.map((block) => ({ order: orderFromId(block.id), text: blockText(block), bullet: false })),
    ...entry.bullets.map((block) => ({ order: orderFromId(block.id), text: blockText(block), bullet: true })),
  ]
    .sort((a, b) => a.order - b.order)
    .map((line) => line.bullet ? `- ${line.text}` : line.text)
    .filter((line) => line !== "- " && line.trim());
  return {
    id: entry.id,
    title: getField(entry, "title"),
    subtitle: getField(entry, "subtitle"),
    meta: getField(entry, "date"),
    body: lines.join("\n"),
    visible: entry.visible,
  };
}

function cloneStructuredEntry(entry: CvEntry, id: string, order: number): CvEntry {
  return {
    ...entry,
    id,
    fields: entry.fields.map((item) => ({ ...item })),
    blocks: entry.blocks.map((block, index) => ({
      ...block,
      id: `${id}_block_${index}`,
      runs: block.runs.map((run) => ({ ...run, marks: run.marks ? [...run.marks] : undefined })),
    })),
    bullets: entry.bullets.map((block, index) => ({
      ...block,
      id: `${id}_bullet_${index}`,
      runs: block.runs.map((run) => ({ ...run, marks: run.marks ? [...run.marks] : undefined })),
    })),
    links: entry.links.map((link) => ({ ...link })),
    order,
  };
}

function withStructuredEntries(section: CvSection, entries: CvEntry[]): CvSection {
  const hydrated = hydrateCvSection(section);
  if (!hydrated.structured) return section;
  const structured = {
    ...hydrated.structured,
    entries: entries.map((entry, index) => ({ ...entry, order: index })),
  };
  return hydrateCvSection({ ...hydrated, structured, content: serializeStructuredSection({ ...hydrated, structured }) });
}

// Copy a single entry from one section into another — used by the master ↔ tailored
// compare view to swap one job/project at a time. Works at the structured level so
// rich-text runs (bold etc.) and the title/subtitle/date fields survive the copy intact.
//
// The compare view aligns the SAME job across CVs by CONTENT (org + dates), not by id —
// after AI tailoring a variant's entry ids no longer match the master's. So the caller
// passes the matched target entry explicitly via `targetEntryId`:
//   - targetEntryId given & found  → replace that entry IN PLACE (keeps its own id+order,
//     so the two sides stay aligned and no `${id}_entry_N` collision is possible).
//   - omitted → ALWAYS append under a fresh, target-unique id (never same-id replace: a
//     one-sided master entry can share an index-id like `experience_entry_2` with a
//     DIFFERENT, already-matched variant job, and a same-id replace would clobber it).
export function replaceCvEntryFrom(targetSection: CvSection, sourceSection: CvSection, sourceEntryId: string, targetEntryId?: string): CvSection {
  const source = hydrateCvSection(sourceSection);
  const target = hydrateCvSection(targetSection);
  const sourceEntry = source.structured?.entries.find((entry) => entry.id === sourceEntryId);
  if (!sourceEntry) return targetSection;
  const targetEntries = (target.structured?.entries ?? []).slice().sort((a, b) => a.order - b.order);
  const targetIndex = targetEntryId ? targetEntries.findIndex((entry) => entry.id === targetEntryId) : -1;
  if (targetIndex >= 0) {
    const keep = targetEntries[targetIndex];
    const next = targetEntries.map((entry) => entry.id === keep.id ? cloneStructuredEntry(sourceEntry, keep.id, keep.order) : entry);
    return withStructuredEntries(target, next);
  }
  // Append under a fresh id that can't collide with an existing target entry (master and
  // variant both use `${section.id}_entry_N`, so reusing the source id could clash).
  const used = new Set(targetEntries.map((entry) => entry.id));
  let n = targetEntries.length;
  let newId = `${target.id}_entry_${n}`;
  while (used.has(newId)) newId = `${target.id}_entry_${++n}`;
  return withStructuredEntries(target, [...targetEntries, cloneStructuredEntry(sourceEntry, newId, targetEntries.length)]);
}

// Drop a single entry from a section (used by the compare view's per-row remove). Returns
// the section unchanged if the entry isn't present.
export function removeCvEntry(section: CvSection, entryId: string): CvSection {
  const hydrated = hydrateCvSection(section);
  const remaining = (hydrated.structured?.entries ?? []).filter((entry) => entry.id !== entryId);
  return withStructuredEntries(hydrated, remaining);
}

export function structuredSectionFromLegacy(section: Pick<CvSection, "id" | "title" | "kind" | "content" | "enabled">, order = 0): StructuredCvSection {
  return {
    schemaVersion: 1,
    kind: section.kind,
    entries: parseLegacyCvEntries(section).map((entry, index) => entryDraftToStructured(section.kind, entry, index)),
    visible: section.enabled,
    order,
  };
}

export function serializeCvEntries(section: Pick<CvSection, "kind">, entries: CvEntryDraft[]) {
  const visibleEntries = entries.filter((entry) => entry.visible !== false);
  if (section.kind === "profile") return visibleEntries.map((entry) => entry.body.trim()).filter(Boolean).join("\n\n");
  if (section.kind === "skills") return visibleEntries.map((entry) => {
    const title = entry.title.trim().toLowerCase() === "skills" ? "" : entry.title.trim();
    // Titled group → one "Group: items" line (items never span lines). Untitled
    // entry → keep its body verbatim incl. newlines so a legacy multi-group blob
    // can still be re-split into per-group entries on the next parse.
    if (!title) return entry.body.trim();
    return `${title}: ${entry.body.replace(/\s*\n\s*/g, " ").trim()}`.replace(/:\s*$/, "");
  }).filter(Boolean).join("\n");
  if (section.kind === "languages") return visibleEntries.map((entry) => [entry.title, entry.subtitle, entry.body].filter(Boolean).join("\n").trim()).join("\n\n");
  return visibleEntries.map((entry) => {
    const title = [entry.title, entry.subtitle].filter(Boolean).join(", ");
    return [entry.meta ? `${entry.meta} ${title}` : title, entry.body].filter(Boolean).join("\n").trim();
  }).join("\n\n");
}

export function serializeStructuredSection(section: Pick<CvSection, "kind"> & { structured?: StructuredCvSection }) {
  if (!section.structured) return "";
  return serializeCvEntries(
    section,
    [...section.structured.entries].sort((a, b) => a.order - b.order).map(entryDraftFromStructured),
  );
}

const stripEmphasis = (value: string) => value.replace(/\*\*/g, "").replace(/__/g, "").replace(/`/g, "");

// Clean markdown noise out of an already-structured entry (fields + rich-text
// run text), so existing data polluted by an AI run shows clean on next load.
function sanitizeStructuredEntry<T extends { fields: { value: string }[]; blocks: { runs: { text: string }[] }[]; bullets: { runs: { text: string }[] }[] }>(entry: T): T {
  const cleanBlock = <B extends { runs: { text: string }[] }>(block: B): B => ({
    ...block,
    runs: block.runs.map((run) => ({ ...run, text: stripEmphasis(run.text) })),
  });
  return {
    ...entry,
    fields: entry.fields.map((field) => ({ ...field, value: stripContentMarkdown(field.value, { trim: false }) })),
    blocks: entry.blocks.map(cleanBlock),
    bullets: entry.bullets.map(cleanBlock),
  };
}

// A legacy skills blob is a single entry whose body packs ≥2 "Group: items"
// lines — the symptom of the old parser. Heal it by re-deriving from content,
// which the current parser splits into one entry per group. Idempotent: once
// split there are no multi-group entries left, so it never re-triggers.
function skillsBlobNeedsResplit(structured: StructuredCvSection): boolean {
  if (structured.kind !== "skills") return false;
  return structured.entries.some((entry) => {
    const groupBlocks = [...entry.blocks, ...entry.bullets].filter((block) =>
      /^[A-Za-zÄÖÜäöü][^:]{0,39}:\s*\S/.test(blockText(block)));
    return groupBlocks.length >= 2;
  });
}

// An experience blob is a single entry that packed several jobs together: the
// extra "Company | Title | Date" headers landed in its body paragraphs (blocks)
// instead of starting their own entry — the symptom of the old parser, which only
// split on a leading date. Heal by re-parsing from content (which keeps the
// header→bullets order), so each job becomes its own entry. Idempotent: once
// split, no entry has a dated pipe header in its blocks, so it never re-triggers.
function experienceBlobNeedsResplit(structured: StructuredCvSection): boolean {
  if (structured.kind !== "experience") return false;
  return structured.entries.some((entry) =>
    entry.blocks.some((block) => {
      const text = blockText(block);
      // A dated pipe header ("Company | Role | Dates") that landed in body prose…
      if (/\s\|\s/.test(text) && /(?:\d{1,2}[/.]\d{4}|\d{4})/.test(text)) return true;
      // …or a dated middot header ("Role — Org · Dates") — the deterministic
      // renderer's format, which the old parser couldn't split. Either means
      // several jobs were packed into one entry; re-parse to one entry per job.
      const dot = text.lastIndexOf("·");
      return dot > 0 && /(?:\d{1,2}[/.]\d{4}|\d{4})/.test(text.slice(dot + 1));
    }),
  );
}

// An education/speaking entry whose title still carries a trailing "| Dates" segment
// is the symptom of the old per-line parser, which left the date stuck in the title
// (and split each 2-line entry into two). Heal by re-parsing from content, which the
// current parser regroups into one entry per school with dates in their own field.
// Idempotent: once regrouped no title holds a dated pipe, so it never re-triggers.
function educationNeedsRegroup(structured: StructuredCvSection): boolean {
  if (structured.kind !== "education" && structured.kind !== "speaking") return false;
  return structured.entries.some((entry) => {
    const title = getField(entry, "title");
    const idx = title.indexOf(" | ");
    return idx > 0 && looksLikeDate(title.slice(idx + 3));
  });
}

export function hydrateCvSection(section: CvSection, order = 0): CvSection {
  const existingStructured = section.structured;
  const hasValidStructured = existingStructured?.schemaVersion === 1 && Array.isArray(existingStructured.entries);
  if (hasValidStructured && existingStructured && educationNeedsRegroup(existingStructured)) {
    // Re-parse from content so the dated "School | Dates" lines regroup with their
    // degree/talk lines into one entry each, dates moved into their own field.
    return hydrateCvSection({ ...section, structured: undefined }, order);
  }
  if (hasValidStructured && existingStructured && experienceBlobNeedsResplit(existingStructured)) {
    // Re-parse from the section's content, which preserves the original
    // header→bullets ordering; the parser now splits it into one entry per job.
    return hydrateCvSection({ ...section, structured: undefined }, order);
  }
  if (hasValidStructured && existingStructured && skillsBlobNeedsResplit(existingStructured)) {
    // Flatten every entry's blocks to one "Group: items" line each, then let the
    // parser re-split. Built directly (not via serialize) so a titled blob heals too.
    const content = existingStructured.entries
      .flatMap((entry) => {
        const prefix = getField(entry, "title").trim();
        const lines = [...entry.blocks, ...entry.bullets].map(blockText).map((line) => line.trim()).filter(Boolean);
        return prefix && !/^[A-Za-zÄÖÜäöü][^:]{0,39}:\s/.test(lines[0] ?? "") ? [`${prefix}: ${lines.join(", ")}`] : lines;
      })
      .filter(Boolean)
      .join("\n");
    return hydrateCvSection({ ...section, content, structured: undefined }, order);
  }
  const structured = hasValidStructured
    ? ({
      ...existingStructured,
      schemaVersion: 1,
      kind: section.kind,
      visible: existingStructured.visible ?? section.enabled,
      entries: existingStructured.entries.map((entry, index) => ({
        ...sanitizeStructuredEntry(entry),
        kind: section.kind,
        visible: entry.visible ?? true,
        order: entry.order ?? index,
      })),
      order,
    } satisfies StructuredCvSection)
    : structuredSectionFromLegacy(section, order);
  return {
    ...section,
    enabled: structured.visible,
    structured,
    content: serializeStructuredSection({ ...section, structured }),
  };
}

export function hydrateCvSections(sections: CvSection[]) {
  return sections.map((section, index) => hydrateCvSection(section, index));
}

export function cvEntriesForSection(section: CvSection): CvEntryDraft[] {
  return hydrateCvSection(section).structured?.entries
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(entryDraftFromStructured) ?? [];
}

function withEntries(section: CvSection, entries: CvEntryDraft[]): CvSection {
  const structured = {
    ...(hydrateCvSection(section).structured ?? structuredSectionFromLegacy(section)),
    entries: entries.map((entry, index) => entryDraftToStructured(section.kind, entry, index)),
  };
  return hydrateCvSection({ ...section, structured, content: serializeCvEntries(section, entries) });
}

export function addCvEntry(section: CvSection): { section: CvSection; entry: CvEntryDraft } {
  const entry = defaultEntryForSection(section);
  const sectionEntries = [...cvEntriesForSection(section), entry];
  return { section: withEntries(section, sectionEntries), entry };
}

export function updateCvEntry(section: CvSection, entryId: string, patch: Partial<CvEntryDraft>) {
  return withEntries(section, cvEntriesForSection(section).map((entry) => entry.id === entryId ? { ...entry, ...patch } : entry));
}

export function duplicateCvEntry(section: CvSection, entryId: string): { section: CvSection; entry?: CvEntryDraft } {
  const hydrated = hydrateCvSection(section);
  const structuredEntries = hydrated.structured?.entries.slice().sort((a, b) => a.order - b.order) ?? [];
  const structuredIndex = structuredEntries.findIndex((entry) => entry.id === entryId);
  if (structuredIndex >= 0) {
    const copyId = `${section.id}_entry_${makeId("copy")}`;
    const copy = cloneStructuredEntry(structuredEntries[structuredIndex], copyId, structuredIndex + 1);
    const nextEntries = [...structuredEntries];
    nextEntries.splice(structuredIndex + 1, 0, copy);
    return { section: withStructuredEntries(hydrated, nextEntries), entry: entryDraftFromStructured(copy) };
  }
  const entries = cvEntriesForSection(hydrated);
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { section };
  const entry = { ...entries[index], id: `${section.id}_entry_${makeId("copy")}`, title: `${entries[index].title} Copy` };
  const next = [...entries];
  next.splice(index + 1, 0, entry);
  return { section: withEntries(section, next), entry };
}

export function deleteCvEntry(section: CvSection, entryId: string) {
  const entries = cvEntriesForSection(section);
  if (entries.length <= 1) return section;
  return withEntries(section, entries.filter((entry) => entry.id !== entryId));
}

export function reorderCvEntries(section: CvSection, fromEntryId: string, toEntryId: string) {
  const hydrated = hydrateCvSection(section);
  const structuredEntries = hydrated.structured?.entries.slice().sort((a, b) => a.order - b.order) ?? [];
  const structuredFromIndex = structuredEntries.findIndex((entry) => entry.id === fromEntryId);
  const structuredToIndex = structuredEntries.findIndex((entry) => entry.id === toEntryId);
  if (structuredFromIndex >= 0 && structuredToIndex >= 0 && structuredFromIndex !== structuredToIndex) {
    const next = [...structuredEntries];
    const [moved] = next.splice(structuredFromIndex, 1);
    next.splice(structuredToIndex, 0, moved);
    return withStructuredEntries(hydrated, next);
  }
  const entries = cvEntriesForSection(hydrated);
  const fromIndex = entries.findIndex((entry) => entry.id === fromEntryId);
  const toIndex = entries.findIndex((entry) => entry.id === toEntryId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return section;
  const next = [...entries];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return withEntries(section, next);
}

export function setCvEntryVisibility(section: CvSection, entryId: string, visible: boolean) {
  const hydrated = hydrateCvSection(section);
  const structuredEntries = hydrated.structured?.entries.slice().sort((a, b) => a.order - b.order) ?? [];
  if (structuredEntries.some((entry) => entry.id === entryId)) {
    return withStructuredEntries(
      hydrated,
      structuredEntries.map((entry) => entry.id === entryId ? { ...entry, visible } : entry),
    );
  }
  return updateCvEntry(hydrated, entryId, { visible });
}

export function setCvSectionVisibility(section: CvSection, visible: boolean) {
  const hydrated = hydrateCvSection(section);
  const structured = { ...hydrated.structured, visible } as StructuredCvSection;
  return hydrateCvSection({ ...hydrated, enabled: visible, structured });
}

export function reorderCvSections(sections: CvSection[], fromId: string, toId: string) {
  const fromIndex = sections.findIndex((section) => section.id === fromId);
  const toIndex = sections.findIndex((section) => section.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return hydrateCvSections(sections);
  const next = [...sections];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return hydrateCvSections(next);
}

export function duplicateCvSection(sections: CvSection[], sectionId: string) {
  const sourceIndex = sections.findIndex((section) => section.id === sectionId);
  if (sourceIndex < 0) return { sections: hydrateCvSections(sections) };
  const source = hydrateCvSection(sections[sourceIndex], sourceIndex);
  const copyId = `section_${makeId("copy")}`;
  const copyBase = {
    ...source,
    id: copyId,
    title: `${source.title} Copy`,
    structured: undefined,
  };
  const sourceEntries = source.structured?.entries.slice().sort((a, b) => a.order - b.order) ?? [];
  const copy = sourceEntries.length
    ? withStructuredEntries({ ...copyBase, structured: { ...source.structured!, entries: [] } }, sourceEntries.map((entry, index) => cloneStructuredEntry(entry, `${copyId}_entry_${index}`, index)))
    : withEntries(
      copyBase,
      cvEntriesForSection(source).map((entry, index) => ({ ...entry, id: `${copyId}_entry_${index}` })),
    );
  const next = [...sections];
  next.splice(sourceIndex + 1, 0, copy);
  return { sections: hydrateCvSections(next), section: copy };
}

export function deleteCvSection(sections: CvSection[], sectionId: string) {
  const next = sections.filter((section) => section.id !== sectionId);
  return next.length ? hydrateCvSections(next) : hydrateCvSections(sections);
}
