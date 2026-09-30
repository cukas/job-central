import { cvEntriesForSection, hydrateCvSections } from "./cvModel.js";
import { mentionsHomeRegion } from "./homeRegion.js";
import type { CvDocument, CvSection, Profile } from "./types.js";

export interface CvImportAnalysis {
  cleanedText: string;
  profile: Profile;
  cv: CvDocument;
  sectionCounts: Array<{ kind: CvSection["kind"]; title: string; entries: number; lines: number }>;
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

const templateTitles: Record<CvSection["kind"], string> = {
  profile: "Profile",
  languages: "Languages",
  experience: "Professional Experience",
  skills: "Skills",
  education: "Education",
  projects: "Projects",
  speaking: "Teaching & Speaking",
  certificates: "Certificates",
  interests: "Interests",
  courses: "Courses",
  awards: "Awards",
  organisations: "Organisations",
  publications: "Publications",
  references: "References",
  declaration: "Declaration",
  custom: "Custom",
};

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
  "Certificates",
  "Certifications",
  "Courses",
  "Awards",
  "Publications",
];

function headingPattern() {
  // Allow a leading "// " or "#" decoration before the heading word — the deterministic
  // renderer (and many CVs) emit "// Profile", "// Education", etc. Dropping the marker
  // here lets sectionKind match the bare word.
  return new RegExp(`(^|\\n)[ \\t]*(?:\\/\\/[ \\t]*|#+[ \\t]*)?(${headingWords.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:?\\s*(?=\\n|$)`, "gi");
}

function isPageMarker(line: string) {
  return /^page\s+\d+(\s+of\s+\d+)?$/i.test(line) ||
    /^\d+\s*\/\s*\d+$/.test(line) ||
    /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) ||
    /^-\s*-\s*\d+\s+of\s+\d+/i.test(line) ||
    /^[-–—]\s*\d+\s*[-–—]$/.test(line);
}

export function sectionKind(line: string): CvSection["kind"] | undefined {
  // Strip leading "// " / "#" heading decoration and trailing ":" / "|" before matching,
  // so "// Professional Experience" resolves the same as "Professional Experience".
  const normalized = line.replace(/^[\s/#>]+/, "").replace(/[:|]+$/g, "").trim();
  return sectionHeadings.find(([, pattern]) => pattern.test(normalized))?.[0];
}

function isDateLine(line: string) {
  return /^(\d{1,2}[./]\d{4}|\d{4})\s*[-–—]\s*(present|heute|aktuell|\d{1,2}[./]\d{4}|\d{4})/i.test(line);
}

function normalizeLine(line: string) {
  return line
    .replace(/\s{2,}/g, " ")
    .replace(/^[-–—*]\s*/, "- ")
    .replace(/^-\s*(?=\S)/, "- ")
    .trim();
}

function isLanguageLine(line: string) {
  return /^(german|deutsch|english|englisch|french|franzoesisch|französisch|italian|italienisch)\b/i.test(line);
}

export function isContactLine(line: string, homeRegion = "") {
  if (line.length > 90 && /[.!?)]/.test(line)) return false;
  return /@|linkedin\.com|github\.com|https?:\/\/|www\.|\+\d|^\d[\d\s()./-]{6,}\d$|\b[a-z0-9-]+\.(?:dev|com|ch|io|net|org)\b|zurich|zürich|zuerich|switzerland|schweiz/i.test(line) || mentionsHomeRegion(line, homeRegion);
}

function shouldAppendWrappedLine(previous: string, line: string) {
  if (!previous || sectionKind(previous) || sectionKind(line) || isDateLine(line)) return false;
  if (isContactLine(line) || isLanguageLine(line)) return false;
  if (line.startsWith("- ")) return false;
  if (previous.startsWith("- ")) return true;
  if (/[.:;!?)]$/.test(previous)) return false;
  if (/^(and|or|with|for|to|in|of|und|oder|mit|fuer|für)\b/i.test(line)) return true;
  return previous.length > 48 && line.length > 18 && /^[a-zäöü]/.test(line);
}

export function normalizeImportedCvText(text: string) {
  const cleaned = text
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/\t+/g, "\n")
    .replace(/[•●▪◦]/g, "\n- ")
    .replace(/([^\n])\s+[-–—*](?=\S)/g, "$1\n- ")
    .replace(headingPattern(), (_match, prefix: string, heading: string) => `${prefix}${heading}\n`);

  const rawLines = cleaned
    .split(/\n+/)
    .filter((line) => !isPageMarker(line.trim()))
    .map(normalizeLine)
    .filter((line) => line && !isPageMarker(line));

  const lines: string[] = [];
  for (const line of rawLines) {
    const previous = lines[lines.length - 1] ?? "";
    if (shouldAppendWrappedLine(previous, line)) {
      lines[lines.length - 1] = `${previous} ${line.replace(/^-\s*/, "")}`.replace(/\s{2,}/g, " ").trim();
    } else {
      lines.push(line);
    }
  }

  return lines.join("\n").trim();
}

export function cvLines(text: string) {
  return normalizeImportedCvText(text).split(/\n/).map((line) => line.trim()).filter(Boolean);
}

function looksLikeName(line: string) {
  const words = line.split(/\s+/);
  return words.length >= 2 &&
    words.length <= 5 &&
    line.length <= 70 &&
    !isContactLine(line) &&
    !isLanguageLine(line) &&
    !sectionKind(line) &&
    !/\b(engineer|developer|architect|manager|lead|senior|frontend|backend|fullstack|consultant)\b/i.test(line) &&
    !/\d{2,}/.test(line);
}

export function profileFromCvText(text: string, current: Profile): Profile {
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
  const location = lines.find((line) => /zurich|zürich|zuerich|switzerland|schweiz/i.test(line) || mentionsHomeRegion(line, current.location)) ?? current.location;
  const website = websiteCandidates[0] ?? current.website;
  const nameLine = lines.find(looksLikeName);
  const headlineStart = lines.findIndex((line) =>
    line !== nameLine &&
    line.length <= 120 &&
    !isContactLine(line, current.location) &&
    !sectionKind(line) &&
    !/^(native|fluent|german|english|deutsch|englisch)$/i.test(line)
  );
  const headline = headlineStart >= 0
    ? lines.slice(headlineStart, headlineStart + 3)
      .filter((line) => !isContactLine(line, current.location) && !sectionKind(line) && !looksLikeName(line))
      .join(" ")
      .slice(0, 140)
    : current.headline;

  return {
    ...current,
    fullName: nameLine || current.fullName,
    headline: headline || current.headline,
    email,
    phone,
    location,
    linkedin,
    github,
    website,
    updatedAt: new Date().toISOString(),
  };
}

function addBucket(buckets: Map<CvSection["kind"], string[]>, kind: CvSection["kind"], line: string) {
  buckets.set(kind, [...(buckets.get(kind) ?? []), line]);
}

function dateOnly(line: string) {
  return isDateLine(line) && !line.replace(/^(\d{1,2}[./]\d{4}|\d{4})\s*[-–—]\s*(present|heute|aktuell|\d{1,2}[./]\d{4}|\d{4})/i, "").trim();
}

function combineDatedLines(kind: CvSection["kind"], lines: string[]) {
  const nextLines: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    const afterNext = lines[index + 2];
    if (kind === "experience" && !line.startsWith("- ") && next && dateOnly(next) && afterNext && !afterNext.startsWith("- ") && !isDateLine(afterNext)) {
      nextLines.push(`${next} ${line}, ${afterNext}`);
      index += 2;
      continue;
    }
    if (dateOnly(line) && next && !next.startsWith("- ") && !isDateLine(next)) {
      nextLines.push(`${line} ${next}`);
      index += 1;
      continue;
    }
    if (line !== "- -") nextLines.push(line);
  }
  return nextLines;
}

function inferLooseSections(lines: string[], buckets: Map<CvSection["kind"], string[]>) {
  if (!buckets.has("languages")) {
    const languages = lines.filter((line) => /^(german|deutsch|english|englisch|french|franzoesisch|französisch|italian|italienisch)\b/i.test(line));
    if (languages.length) buckets.set("languages", languages);
  }
  if (!buckets.has("skills")) {
    const skills = lines.filter((line) => /(react|typescript|javascript|node|next\.js|vue|express|python|ai|llm|claude|copilot|css|html|frontend|architecture)/i.test(line));
    if (skills.length) buckets.set("skills", [...new Set(skills)].slice(0, 18));
  }
  if (!buckets.has("education")) {
    const education = lines.filter((line) => /(university|universitaet|universität|bachelor|master|hslu|eth|fh|degree|diploma|apprenticeship|lehre|ausbildung|informatik|hci)/i.test(line));
    if (education.length) buckets.set("education", education);
  }
  if (!buckets.has("speaking")) {
    const speaking = lines.filter((line) => /(talk|conference|workshop|teaching|speaker|lecturer|vortrag|unterricht|webinar)/i.test(line));
    if (speaking.length) buckets.set("speaking", speaking);
  }
  if (!buckets.has("projects")) {
    const projects = lines.filter((line) => /(project|projekt|open source|github\.com|launched|built)/i.test(line));
    if (projects.length) buckets.set("projects", [...new Set(projects)].slice(0, 18));
  }
  if (!buckets.has("experience")) {
    const start = lines.findIndex((line) => /(\d{1,2}[./]\d{4}|\d{4}|present|heute|aktuell|lead|engineer|architect|developer|manager)/i.test(line));
    if (start >= 0) {
      const experience = lines.slice(start).filter((line) => !sectionKind(line) && !isContactLine(line));
      if (experience.length) buckets.set("experience", experience.slice(0, 100));
    }
  }
}

function countEntries(kind: CvSection["kind"], content: string) {
  const lines = content.split(/\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return 0;
  if (kind === "profile") return content.split(/\n{2,}/).filter((block) => block.trim()).length || 1;
  if (kind === "experience") return Math.max(1, lines.filter(isDateLine).length);
  if (kind === "languages") return Math.max(1, content.split(/\n{2,}/).filter((block) => block.trim()).length || Math.ceil(lines.length / 2));
  if (kind === "skills") return Math.max(1, lines.filter((line) => !line.startsWith("- ")).length);
  return Math.max(1, lines.length);
}

export function sectionsFromCvText(text: string, baseSections: CvSection[]) {
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

  let hadHeadings = false;
  for (const line of lines) {
    const matched = sectionKind(line);
    if (matched) {
      current = matched;
      hadHeadings = true;
      continue;
    }
    const beforeMainContent = !current || current === "profile";
    if (
      line === importedProfile.fullName ||
      line === importedProfile.headline ||
      (beforeMainContent && importedProfile.headline.includes(line)) ||
      (beforeMainContent && isContactLine(line))
    ) {
      continue;
    }
    current ??= "profile";
    addBucket(buckets, current, line);
  }

  if (buckets.size === 0 || [...buckets.values()].every((bucketLines) => !bucketLines.join("").trim())) {
    buckets.set("profile", lines.filter((line) => !isContactLine(line) && !sectionKind(line)).slice(0, 12));
  }
  // Keyword-scraping into projects/skills/education/experience is a LAST RESORT for
  // CVs with no recognizable headings. When real "// Section" headings were found the
  // buckets are authoritative — inferring extra sections only fabricates noise (e.g. a
  // phantom Projects section scraped from contact links and experience bullets).
  if (!hadHeadings) inferLooseSections(lines, buckets);

  const merged = baseSections.map((section) => {
    const bucketLines = buckets.get(section.kind);
    const preparedLines = bucketLines ? combineDatedLines(section.kind, bucketLines) : undefined;
    const content = section.kind === "profile"
      ? preparedLines?.join(" ").replace(/\s{2,}/g, " ").trim()
      : preparedLines?.join("\n").trim();
    return content ? { ...section, content, structured: undefined, enabled: true } : section;
  });
  for (const [kind, bucketLines] of buckets.entries()) {
    if (merged.some((section) => section.kind === kind) || !bucketLines.join("").trim()) continue;
    const preparedLines = combineDatedLines(kind, bucketLines);
    merged.push({
      id: `section_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: templateTitles[kind] ?? kind,
      kind,
      content: preparedLines.join("\n").trim(),
      enabled: true,
    });
  }
  return hydrateCvSections(merged);
}

// Build sections from an AI-structured map of `kind -> canonical section text` (the
// same canonical format the deterministic parser emits). Each provided kind replaces
// its section's content and is re-hydrated into structured entries; sections the AI
// didn't return are left untouched. Mirrors how the rest of the app applies AI CV output.
export function sectionsFromAiSections(aiSections: Record<string, string>, baseSections: CvSection[]) {
  const merged = baseSections.map((section) => {
    const content = aiSections[section.kind]?.trim();
    return content ? { ...section, content, structured: undefined, enabled: true } : section;
  });
  for (const [kind, value] of Object.entries(aiSections)) {
    const content = value?.trim();
    if (!content || merged.some((section) => section.kind === kind)) continue;
    if (!(kind in templateTitles)) continue;
    merged.push({
      id: `section_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: templateTitles[kind as CvSection["kind"]] ?? kind,
      kind: kind as CvSection["kind"],
      content,
      enabled: true,
    });
  }
  return hydrateCvSections(merged);
}

export function analyzeImportedCvDocument(
  text: string,
  currentProfile: Profile,
  currentCv: CvDocument,
  aiSections?: Record<string, string>,
): CvImportAnalysis {
  const cleanedText = normalizeImportedCvText(text);
  const profile = profileFromCvText(cleanedText, currentProfile);
  const cv = {
    ...currentCv,
    sections: aiSections && Object.values(aiSections).some((value) => value?.trim())
      ? sectionsFromAiSections(aiSections, currentCv.sections)
      : sectionsFromCvText(cleanedText, currentCv.sections),
    updatedAt: new Date().toISOString(),
  };
  const sectionCounts = cv.sections
    .filter((section) => section.enabled && section.content.trim())
    .map((section) => ({
      kind: section.kind,
      title: section.title,
      entries: cvEntriesForSection(section).length || countEntries(section.kind, section.content),
      lines: section.content.split(/\n/).filter((line) => line.trim()).length,
    }));

  return { cleanedText, profile, cv, sectionCounts };
}
