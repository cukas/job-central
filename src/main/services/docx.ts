import { cvPersonalDataLine } from "../../shared/cvRender.js";
import type { CoverLetter, CvVersion, JobPost, Profile } from "../../shared/types.js";

// Minimal, dependency-free .docx writer. A .docx is just a ZIP of XML parts, so
// we hand-roll a "stored" (uncompressed) ZIP — ATS parsers read the text layer
// of a real Word document far more reliably than a PDF, which is the whole point.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

// Build a ZIP archive using only the "stored" method (no compression). Word
// opens stored .docx files exactly like compressed ones.
function zipStore(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    nameBuf.copy(local, 30);
    locals.push(local, entry.data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + entry.data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12); // central dir size
  eocd.writeUInt32LE(offset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, eocd]);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// A WordprocessingML paragraph. `runs` are [text, bold] pairs; sz is half-points.
function paragraph(text: string, opts: { bold?: boolean; sz?: number; color?: string; spaceBefore?: number; bullet?: boolean } = {}): string {
  const { bold, sz, color, spaceBefore, bullet } = opts;
  const rPr =
    `<w:rPr>${bold ? "<w:b/>" : ""}${sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : ""}${color ? `<w:color w:val="${color}"/>` : ""}</w:rPr>`;
  const spacing = spaceBefore ? `<w:spacing w:before="${spaceBefore}"/>` : "";
  const indent = bullet ? `<w:ind w:left="284" w:hanging="284"/>` : "";
  const pPr = spacing || indent ? `<w:pPr>${spacing}${indent}</w:pPr>` : "";
  const body = bullet ? `•  ${text}` : text;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(body)}</w:t></w:r></w:p>`;
}

function sectionParagraphs(title: string, content: string, accent: string): string[] {
  const out: string[] = [];
  // Standard, parser-friendly heading.
  out.push(paragraph(title.toUpperCase(), { bold: true, sz: 26, color: accent, spaceBefore: 240 }));
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("- ") || line.startsWith("• ") || line.startsWith("* ")) {
      out.push(paragraph(line.replace(/^[-•*]\s+/, ""), { sz: 20, bullet: true }));
    } else if (line.includes(" | ")) {
      // Experience "Company | Role | Dates" header line.
      out.push(paragraph(line, { bold: true, sz: 21, spaceBefore: 80 }));
    } else {
      out.push(paragraph(line, { sz: 20 }));
    }
  }
  return out;
}

export function cvDocx(profile: Profile, cv: CvVersion): Buffer {
  const accent = (cv.style.accentColor || "#2563eb").replace("#", "");
  const contact = [profile.email, profile.phone, profile.location, profile.linkedin, profile.github, profile.website]
    .map((value) => (value ?? "").trim())
    .filter(Boolean)
    .join("   |   ");
  const personalData = cvPersonalDataLine(profile);

  const paragraphs: string[] = [];
  paragraphs.push(paragraph(profile.fullName, { bold: true, sz: 44 }));
  if (profile.headline?.trim()) paragraphs.push(paragraph(profile.headline.trim(), { sz: 26, color: accent }));
  if (contact) paragraphs.push(paragraph(contact, { sz: 18 }));
  if (personalData) paragraphs.push(paragraph(personalData, { sz: 18, color: "595959" }));

  for (const section of cv.sections.filter((item) => item.enabled && item.content.trim())) {
    paragraphs.push(...sectionParagraphs(section.title, section.content, accent));
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs.join("")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>` +
    `</w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ]);
}

// Same minimal-ZIP DOCX path, for a cover/motivation letter.
export function coverLetterDocx(profile: Profile, letter: CoverLetter, job?: JobPost): Buffer {
  const accent = "f97316";
  const contact = [profile.email, profile.phone, profile.location, profile.website]
    .map((value) => (value ?? "").trim())
    .filter(Boolean)
    .join("   |   ");

  const paragraphs: string[] = [];
  paragraphs.push(paragraph(profile.fullName, { bold: true, sz: 36 }));
  if (contact) paragraphs.push(paragraph(contact, { sz: 18, color: "595959" }));
  const subject = job ? `${job.company} · ${job.title}` : letter.title;
  if (subject?.trim()) paragraphs.push(paragraph(subject.trim(), { sz: 22, color: accent, spaceBefore: 200 }));

  for (const block of letter.content.split(/\n{2,}/)) {
    const text = block.trim();
    if (text) paragraphs.push(paragraph(text.replace(/\n/g, " "), { sz: 21, spaceBefore: 120 }));
  }

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs.join("")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418"/></w:sectPr>` +
    `</w:body></w:document>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ]);
}
