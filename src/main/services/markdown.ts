import type {
  CoverLetter,
  CvSection,
  JobApplication,
  JobPost,
  Profile,
  ProfileFact,
  SourceDocument,
} from "../../shared/types.js";

// One-way Markdown serializers for the folder mirror. CvDocument/CvVersion (the
// structured JSON in workspace.json) stays the canonical source of truth — these
// render a clean, AI-readable + human-browsable Markdown copy alongside the PDF and
// DOCX. They NEVER invent content; everything comes straight from the stored data.

// Accepts either a master CvDocument or a job-specific CvVersion — only these fields
// are needed to render Markdown, and both shapes carry them.
interface CvLike {
  title: string;
  headline?: string;
  sections: CvSection[];
}

const STATUS_LABELS: Record<JobApplication["status"], string> = {
  watching: "Watching",
  evaluating: "Evaluating",
  applied: "Applied",
  follow_up: "Follow-up",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  ghosted: "Ghosted",
  archived: "Archived",
};

// Render one CV section's plain-text content as Markdown: "- "/"•"/"* " lines become
// bullets, "Company | Role | Dates" header lines become bold, the rest are paragraphs.
function renderSectionBody(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }
    if (/^[-•*]\s+/.test(line)) {
      out.push(`- ${line.replace(/^[-•*]\s+/, "")}`);
    } else if (line.includes(" | ")) {
      out.push(`**${line}**`);
    } else {
      out.push(line);
    }
  }
  // Collapse 3+ blank lines down to a single blank line.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function contactLine(profile: Profile): string {
  return [profile.email, profile.phone, profile.location, profile.linkedin, profile.github, profile.website]
    .map((value) => (value ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

export function cvToMarkdown(profile: Profile, cv: CvLike): string {
  const out: string[] = [];
  out.push(`# ${profile.fullName || cv.title || "Curriculum Vitae"}`);
  const headline = (cv.headline?.trim()) || profile.headline?.trim();
  if (headline) out.push(`**${headline}**`);
  const contact = contactLine(profile);
  if (contact) out.push(contact);
  const personal = [profile.nationality, profile.workPermit, profile.dateOfBirth]
    .map((value) => (value ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  if (personal) out.push(`*${personal}*`);
  out.push("");
  for (const section of cv.sections.filter((s) => s.enabled && s.content.trim())) {
    out.push(`## ${section.title}`);
    out.push("");
    out.push(renderSectionBody(section.content));
    out.push("");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function coverLetterToMarkdown(profile: Profile, letter: CoverLetter, job?: JobPost): string {
  const out: string[] = [];
  out.push(`# ${letter.title || "Motivation Letter"}`);
  const contact = contactLine(profile);
  if (contact) out.push(`*${contact}*`);
  if (job) out.push(`\n**${job.company} · ${job.title}**`);
  out.push("");
  for (const paragraph of letter.content.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (trimmed) out.push(`${trimmed.replace(/\n/g, "  \n")}\n`);
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function jobToMarkdown(job: JobPost): string {
  const out: string[] = [];
  out.push(`# ${job.title}`);
  out.push(`**${job.company}**${job.location ? ` — ${job.location}` : ""}`);
  if (job.url) out.push(`\n[Apply / source](${job.url})`);
  if (typeof job.score === "number") out.push(`\nFit score: ${job.score}/100`);
  if (job.fitReason?.trim()) out.push(`\n> ${job.fitReason.trim().replace(/\n/g, "\n> ")}`);
  out.push("\n## Job description\n");
  out.push((job.description || "_No description captured._").trim());
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function applicationTimelineToMarkdown(application: JobApplication, job?: JobPost): string {
  const out: string[] = [];
  out.push(`# Timeline — ${job ? `${job.company} · ${job.title}` : "Application"}`);
  out.push("");
  out.push(`- **Status:** ${STATUS_LABELS[application.status]}`);
  out.push(`- **Priority:** ${application.priority}`);
  if (application.appliedAt) out.push(`- **Applied:** ${application.appliedAt}`);
  if (application.nextActionAt) out.push(`- **Next action:** ${application.nextActionAt}`);
  out.push("");
  out.push("## History");
  out.push("");
  const events = [...application.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!events.length) {
    out.push("_No events yet._");
  } else {
    for (const event of events) {
      const when = event.createdAt.slice(0, 16).replace("T", " ");
      out.push(`- **${when}** — ${event.title}${event.detail ? `: ${event.detail}` : ""}`);
    }
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function notesToMarkdown(application: JobApplication, job?: JobPost): string {
  const heading = `# Notes — ${job ? `${job.company} · ${job.title}` : "Application"}\n`;
  const body = application.notes?.trim() ? `\n${application.notes.trim()}\n` : "\n_No notes yet._\n";
  return `${heading}${body}`;
}

// Deterministic synthesis of profile.md from data the user already provided.
// NO LLM, NO invented prose — facts only, with source attribution. Approved
// captured facts (from AI chats, after user review) are appended verbatim.
export function profileToMarkdown(input: {
  profile: Profile;
  master: CvLike;
  sourceDocuments: SourceDocument[];
  approvedFacts: ProfileFact[];
}): string {
  const { profile, master, sourceDocuments, approvedFacts } = input;
  const out: string[] = [];
  out.push(`# ${profile.fullName} — Candidate Profile`);
  out.push("");
  out.push("> Generated by Job-central from the information you provided. Everything below is");
  out.push("> drawn from your own data — nothing here is invented. Use it as the factual basis");
  out.push("> for tailoring CVs and letters.");
  out.push("");

  out.push("## Contact & personal");
  out.push("");
  const contactRows: Array<[string, string | undefined]> = [
    ["Email", profile.email],
    ["Phone", profile.phone],
    ["Location", profile.location],
    ["LinkedIn", profile.linkedin],
    ["GitHub", profile.github],
    ["Website", profile.website],
    ["Nationality", profile.nationality],
    ["Work permit", profile.workPermit],
    ["Date of birth", profile.dateOfBirth],
  ];
  for (const [label, value] of contactRows) {
    if (value && value.trim()) out.push(`- **${label}:** ${value.trim()}`);
  }
  out.push("");

  const roles = (profile.targetRoles ?? []).map((r) => r.trim()).filter(Boolean);
  if (roles.length) {
    out.push("## Target roles");
    out.push("");
    for (const role of roles) out.push(`- ${role}`);
    out.push("");
  }

  // Pull the master CV's own sections through as the verified career record.
  for (const section of master.sections.filter((s) => s.enabled && s.content.trim())) {
    out.push(`## ${section.title}`);
    out.push("");
    out.push(renderSectionBody(section.content));
    out.push("");
  }

  if (sourceDocuments.length) {
    out.push("## Reference material on file");
    out.push("");
    out.push("Full text of these documents lives in `Me/reference-letters/`.");
    out.push("");
    for (const doc of sourceDocuments) {
      out.push(`- **${doc.name}** (${doc.kind}, ~${doc.words} words)`);
    }
    out.push("");
  }

  const facts = approvedFacts.filter((f) => f.status === "approved");
  if (facts.length) {
    out.push("## Additional facts captured from your conversations");
    out.push("");
    out.push("_You reviewed and approved each of these._");
    out.push("");
    for (const fact of facts) {
      out.push(`- **[${fact.category}]** ${fact.assertion}`);
    }
    out.push("");
  }

  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

// Reference documents (Zeugnisse / imported CVs) are written verbatim as Markdown
// so the raw source is browsable + AI-readable in Me/reference-letters/.
export function sourceDocumentToMarkdown(doc: SourceDocument): string {
  return `# ${doc.name}\n\n_${doc.kind} · ~${doc.words} words · added ${doc.addedAt.slice(0, 10)}_\n\n${doc.text.trim()}\n`;
}
