import { hydrateCvSection } from "./cvModel.js";
import type { CvEntry, CvRichTextBlock, CvSection, Profile } from "./types.js";

// The Swiss "personal data" header items: nationality · work permit · date of birth.
// Single source of truth so the live preview (CvHeaderBlock), the PDF and the DOCX export
// all use the SAME values. DOB is shown DD.MM.YYYY (Swiss convention); ISO input reformatted.
export type CvPersonalDataItem = { key: "nationality" | "workPermit" | "dateOfBirth"; value: string };

export function cvPersonalDataItems(profile: Pick<Profile, "nationality" | "workPermit" | "dateOfBirth">): CvPersonalDataItem[] {
  const raw = (profile.dateOfBirth ?? "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dob = iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : raw;
  const items: CvPersonalDataItem[] = [
    { key: "nationality", value: (profile.nationality ?? "").trim() },
    { key: "workPermit", value: (profile.workPermit ?? "").trim() },
    { key: "dateOfBirth", value: dob },
  ];
  return items.filter((item) => item.value);
}

// Plain joined line (used by the DOCX export, which has no inline icons).
export function cvPersonalDataLine(profile: Pick<Profile, "nationality" | "workPermit" | "dateOfBirth">) {
  return cvPersonalDataItems(profile).map((item) => item.value).join(" · ");
}

export function escapeCvHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(value: string) {
  return escapeCvHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderRichBlock(block: CvRichTextBlock) {
  return block.runs.map((run) => {
    let html = run.marks?.length || run.link ? escapeCvHtml(run.text) : renderInline(run.text);
    for (const mark of run.marks ?? []) {
      if (mark === "bold") html = `<strong>${html}</strong>`;
      if (mark === "italic") html = `<em>${html}</em>`;
    }
    if (!run.link) return html;
    try {
      const url = new URL(run.link);
      return url.protocol === "http:" || url.protocol === "https:" ? `<a href="${escapeCvHtml(url.href)}">${html}</a>` : html;
    } catch {
      return html;
    }
  }).join("");
}

function renderPlainContent(content: string) {
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };

  for (const rawLine of content.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*•])\s+(.+)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (bullet || numbered) {
      const nextList = bullet ? "ul" : "ol";
      if (list !== nextList) {
        closeList();
        html.push(`<${nextList}>`);
        list = nextList;
      }
      html.push(`<li>${renderInline((bullet ?? numbered)?.[1] ?? line)}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  return html.join("");
}

function getField(entry: CvEntry, key: string) {
  return entry.fields.find((field) => field.key === key)?.value.trim() ?? "";
}

function renderEntryBody(entry: CvEntry) {
  const paragraphs = entry.blocks
    .filter((block) => block.runs.some((run) => run.text.trim()))
    .map((block) => `<p>${renderRichBlock(block)}</p>`);
  const bullets = entry.bullets
    .filter((block) => block.runs.some((run) => run.text.trim()))
    .map((block) => `<li>${renderRichBlock(block)}</li>`);
  return `${paragraphs.join("")}${bullets.length ? `<ul>${bullets.join("")}</ul>` : ""}`;
}

function renderStructuredEntry(entry: CvEntry, sectionKind: CvSection["kind"]) {
  const title = getField(entry, "title");
  const subtitle = getField(entry, "subtitle");
  const date = getField(entry, "date");
  const body = renderEntryBody(entry);

  if (sectionKind === "profile") return body;
  if (sectionKind === "languages") {
    return `<div class="cv-language-entry"><strong>${renderInline(title)}</strong>${subtitle ? `<span>${renderInline(subtitle)}</span>` : ""}${body}</div>`;
  }
  if (sectionKind === "skills") {
    // Compact: render the group label inline with its items on one flowing line
    // (instead of a stacked label + block), so Skills stays short and the CV fits.
    const blockItems = [...entry.blocks, ...entry.bullets]
      .filter((block) => block.runs.some((run) => run.text.trim()))
      .map((block) => renderRichBlock(block))
      .join(", ");
    // Fall back to subtitle for legacy entries that stored items there; never let
    // (title||subtitle) be undefined (skill entries can have neither).
    const items = blockItems || (subtitle ? renderInline(subtitle) : "");
    const label = (title || "").replace(/:\s*$/, "");
    return `<div class="cv-entry cv-skill-entry">${label ? `<strong>${renderInline(label)}:</strong> ` : ""}${items}</div>`;
  }

  // Career sections (experience/education) may FLOW across a page break in the PDF:
  // the heading stays glued to its first bullet, but the remaining bullets continue on
  // the next page instead of the whole role jumping over and leaving a gap. Every other
  // section keeps the atomic `break-inside: avoid` (a hard cut). See cvPaperCss.ts.
  const flow = sectionKind === "experience" || sectionKind === "education";
  return `<div class="cv-entry${flow ? " cv-entry--flow" : ""}">
    <div class="cv-entry-heading">
      <div>${title ? `<strong>${renderInline(title)}</strong>` : ""}${subtitle ? `<span>${renderInline(subtitle)}</span>` : ""}</div>
      ${date ? `<time>${renderInline(date)}</time>` : ""}
    </div>
    ${body}
  </div>`;
}

// ── Same-employer grouping ────────────────────────────────────────────────────────────────
// A promotion path (Frontend → Senior → Lead at one company) is three entries that all repeat
// the employer. With `groupSameEmployer` on, consecutive entries sharing an employer render as
// ONE company block: employer + total span once, each role nested with its own dates + bullets.
// The stored entries are untouched — this is purely a rendering choice, reversible at any time.

const PERIOD_SEPARATOR = /\s*(?:[–—−-]|\bbis\b|\bto\b|\buntil\b)\s*/i;
const PRESENT = /^(?:present|heute|today|now|jetzt|aktuell|current|ongoing|laufend)\.?$/i;

// German + English month names (long, short, and the "Sept." style with a trailing dot), so
// "März 2019" and "Jan 2020" rank by their real month. Without this, two roles in the SAME
// year both collapse to that year and the span can show the wrong endpoint.
const MONTH_NAMES: Record<string, number> = {
  jan: 1, januar: 1, january: 1, jaenner: 1,
  feb: 2, februar: 2, february: 2,
  mar: 3, mär: 3, maerz: 3, märz: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12,
};

// A period endpoint as a sortable month number (year*12+month). "Present" sorts after every
// real date so an ongoing role always wins as the group's end. Returns null when the text is
// not a date we recognise — the caller then prints no span rather than inventing one.
function periodEndpoint(text: string, edge: "start" | "end"): number | null {
  const value = text.trim();
  if (!value) return null;
  if (PRESENT.test(value)) return Number.MAX_SAFE_INTEGER;
  const monthYear = value.match(/(\d{1,2})\s*[./]\s*(\d{4})/);
  if (monthYear) {
    const month = Number(monthYear[1]);
    if (month >= 1 && month <= 12) return Number(monthYear[2]) * 12 + month;
  }
  const namedMonth = value.match(/([A-Za-zÄÖÜäöüß]+)\.?\s+(\d{4})/);
  if (namedMonth) {
    const month = MONTH_NAMES[namedMonth[1].toLowerCase()];
    if (month) return Number(namedMonth[2]) * 12 + month;
  }
  const yearOnly = value.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  if (yearOnly) return Number(yearOnly[1]) * 12 + (edge === "start" ? 1 : 12);
  return null;
}

// Widest span across a group's entries: earliest start … latest end, keeping the ORIGINAL text
// of the two winning endpoints (so "10.2023" stays "10.2023" and "heute" stays "heute" — no
// reformatting, no language guessing). Any unparseable endpoint voids the span.
function groupPeriod(entries: CvEntry[]): string {
  let start: { rank: number; text: string } | null = null;
  let end: { rank: number; text: string } | null = null;
  for (const entry of entries) {
    const date = getField(entry, "date");
    if (!date) return "";
    const parts = date.split(PERIOD_SEPARATOR).map((part) => part.trim()).filter(Boolean);
    const startText = parts[0] ?? "";
    const endText = parts.length > 1 ? parts[parts.length - 1] : startText;
    const startRank = periodEndpoint(startText, "start");
    const endRank = periodEndpoint(endText, "end");
    if (startRank === null || endRank === null) return "";
    if (!start || startRank < start.rank) start = { rank: startRank, text: startText };
    if (!end || endRank > end.rank) end = { rank: endRank, text: endText };
  }
  if (!start || !end) return "";
  return start.text === end.text ? start.text : `${start.text} – ${end.text}`;
}

function employerKey(entry: CvEntry) {
  return getField(entry, "title").toLowerCase().replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
}

// Consecutive runs only: a re-hire after years elsewhere stays its own block, which is what a
// recruiter expects to see (and what the entry order already encodes).
//
// Runs are computed over ALL entries, hidden ones included, and the hidden ones are dropped
// afterwards. A hidden job at another employer therefore still BREAKS the run: hiding it must
// not fuse two separate tenures into one block whose span claims uninterrupted employment.
function groupByEmployer(entries: CvEntry[]): CvEntry[][] {
  const groups: CvEntry[][] = [];
  for (const entry of entries) {
    const previous = groups[groups.length - 1];
    const key = employerKey(entry);
    if (previous && key && employerKey(previous[0]) === key) previous.push(entry);
    else groups.push([entry]);
  }
  return groups;
}

function renderCompanyGroup(entries: CvEntry[]) {
  const employer = getField(entries[0], "title");
  const span = groupPeriod(entries);
  const roles = entries
    .map((entry) => {
      // Inside the block the ROLE is the heading; fall back to the employer for the odd entry
      // that only ever had a title (otherwise the role line would come out empty).
      const role = getField(entry, "subtitle") || getField(entry, "title");
      const date = getField(entry, "date");
      return `<div class="cv-role">
      <div class="cv-entry-heading">
        <div>${role ? `<strong>${renderInline(role)}</strong>` : ""}</div>
        ${date ? `<time>${renderInline(date)}</time>` : ""}
      </div>
      ${renderEntryBody(entry)}
    </div>`;
    })
    .join("");
  return `<div class="cv-entry cv-entry--flow cv-company">
    <div class="cv-entry-heading cv-company-heading">
      <div>${employer ? `<strong>${renderInline(employer)}</strong>` : ""}</div>
      ${span ? `<time>${renderInline(span)}</time>` : ""}
    </div>
    <div class="cv-company-roles">${roles}</div>
  </div>`;
}

export interface CvRenderOptions {
  /** Collapse consecutive experience entries that share an employer into one company block. */
  groupSameEmployer?: boolean;
}

export function cvSectionContentHtml(section: CvSection, options: CvRenderOptions = {}) {
  const hydrated = hydrateCvSection(section);
  if (!hydrated.structured) return renderPlainContent(hydrated.content);
  const ordered = hydrated.structured.entries.slice().sort((a, b) => a.order - b.order);
  const entries = ordered.filter((entry) => entry.visible !== false);

  if (!entries.length) {
    if (hydrated.kind === "languages") return '<div class="cv-language-grid"></div>';
    if (hydrated.kind === "skills") return '<div class="cv-skill-grid"></div>';
    return "";
  }
  if (options.groupSameEmployer && hydrated.kind === "experience") {
    // Runs come from the FULL order (see groupByEmployer), hidden entries are dropped after —
    // never before, or hiding a job in between would merge two separate tenures.
    return groupByEmployer(ordered)
      .map((group) => group.filter((entry) => entry.visible !== false))
      .filter((group) => group.length > 0)
      .map((group) => (group.length > 1 ? renderCompanyGroup(group) : renderStructuredEntry(group[0], hydrated.kind)))
      .join("");
  }
  const html = entries.map((entry) => renderStructuredEntry(entry, hydrated.kind)).join("");
  if (hydrated.kind === "languages") return `<div class="cv-language-grid">${html}</div>`;
  if (hydrated.kind === "skills") return `<div class="cv-skill-grid">${html}</div>`;
  return html;
}
