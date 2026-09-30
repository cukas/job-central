import { BrowserWindow, app } from "electron";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { cvPersonalDataItems, cvSectionContentHtml } from "../../shared/cvRender.js";
import { CV_CONTACT_ICON_SVG, CV_PERSONAL_ICON_SVG, CV_PAPER_CSS, cvFontStack } from "../../shared/cvPaperCss.js";
import type { CoverLetter, CvDocument, CvVersion, JobPost, Profile } from "../../shared/types.js";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Use the SAME shared font stack as the live preview so the export renders in the identical
// typeface (otherwise the preview/PDF wrap text differently and paginate differently).
function pdfFontFamily(font: string) {
  return cvFontStack(font);
}

function ensurePdfPath(filePath: string) {
  return filePath.toLowerCase().endsWith(".pdf") ? filePath : `${filePath}.pdf`;
}

export function cvHtml(profile: Profile, cv: CvDocument | CvVersion) {
  const accent = cv.style.accentColor;
  const fontFamily = pdfFontFamily(cv.style.font);
  const density = cv.style.density === "compact" ? "1.32" : "1.48";
  // Per-page print margin (the header/footer space), applied via @page + preferCSSPageSize
  // so EVERY page gets it. printToPDF's own `margins` option only reliably lands the TOP
  // margin on page 1 (continuation pages lost it). 58px≈15.3mm / 42px≈11.1mm @96dpi — these
  // match the preview's paper padding, so text wraps the same on screen and in the PDF.
  const pageMargin = cv.style.density === "compact" ? "11.1mm" : "15.3mm";
  const showContactIcons = cv.style.showContactIcons !== false;
  const avatar = profile.photoDataUrl && cv.style.showPhoto
    ? `<img src="${profile.photoDataUrl}" alt="" />`
    : escapeHtml(profile.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2));
  // Same contact rows (and lucide icons) the on-screen <CvPreview> renders.
  const contactItems = [
    ["email", profile.email],
    ["phone", profile.phone],
    ["location", profile.location],
    ["linkedin", profile.linkedin],
    ["github", profile.github],
    ["website", profile.website],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `<span>${showContactIcons ? (CV_CONTACT_ICON_SVG[key] ?? "") : ""}${escapeHtml(value)}</span>`)
    .join("");
  // Swiss recruiters expect nationality + work-permit status (and often DOB) near the top.
  // Same shared items + icon style as the live preview's header, so they never drift.
  const personalData = cvPersonalDataItems(profile)
    .map(({ key, value }) => `<span>${showContactIcons ? (CV_PERSONAL_ICON_SVG[key] ?? "") : ""}${escapeHtml(value)}</span>`)
    .join("");
  const sections = cv.sections
    .filter((section) => section.enabled)
    .map(
      (section) => `
        <section class="cv-section">
          <h3>${escapeHtml(section.title)}</h3>
          ${cvSectionContentHtml(section, { groupSameEmployer: cv.style.groupSameEmployer })}
        </section>`,
    )
    .join("");

  // The PDF reuses the EXACT same markup + stylesheet (CV_PAPER_CSS) as the live
  // <CvPreview>, so the export matches the builder for every template. The inline
  // block below only adds print-context values: the @page box, the theme variables
  // the shared CSS references (resolved for white paper), and page-break rules.
  return `<!doctype html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(profile.fullName)} — CV</title>
      <meta name="author" content="${escapeHtml(profile.fullName)}" />
      <style>
        @page { size: A4; margin: ${pageMargin}; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body { color: #050506; font-family: ${fontFamily}; font-size: 16px; line-height: ${density}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        ${CV_PAPER_CSS}
        /* Print overrides — placed AFTER the shared CSS so they win (otherwise the
           shared .paper rule's default --accent/padding would clobber these). The
           @page margin (above, via preferCSSPageSize) supplies the per-page top/bottom/
           side space on EVERY page, so the paper itself carries no padding. */
        .paper { --accent: ${accent}; --text: #1f2937; --muted: #4b5563; --panel-3: #e9e9ec; --line: #d1d5db; width: 100%; min-height: 0; box-shadow: none; padding: 0; font-family: ${fontFamily}; }
        .paper .portrait { background: #e9e9ec; color: #555; }
        .paper .cv-entry:not(.cv-entry--flow), .paper .cv-language-entry { break-inside: avoid; }
        .paper .cv-section h3 { break-after: avoid; }
        /* Full-bleed templates use negative header margins to counter paper padding;
           with padding:0 that overflows, so neutralise it for print. */
        .paper.template-executive .cv-header, .paper.template-slate .cv-header { margin-left: 0; margin-right: 0; }
        .paper.template-sidebar .cv-header { margin: 0 0 24px; }
        a { color: inherit; text-decoration-color: ${accent}; }
      </style>
    </head>
    <body>
      <div class="paper template-${escapeHtml(cv.template)} density-${escapeHtml(cv.style.density)}">
        <header class="cv-header">
          ${cv.style.showPhoto ? `<div class="portrait large">${avatar}</div>` : ""}
          <div>
            <h2>${escapeHtml(profile.fullName)}</h2>
            <p>${escapeHtml(("headline" in cv && cv.headline?.trim()) ? cv.headline : profile.headline)}</p>
            <div class="cv-contact">${contactItems}</div>
            ${personalData ? `<div class="personal-data">${personalData}</div>` : ""}
          </div>
        </header>
        ${sections}
      </div>
    </body>
  </html>`;
}

// Load an HTML document into an offscreen window and print from it.
//
// The document goes through a temp FILE, never a `data:` URL: Chromium refuses to navigate to
// any URL longer than 2 MB (url::kMaxURLChars) and fails with ERR_INVALID_URL (-300). A CV
// carries the portrait inline (profile.photoDataUrl is the raw base64 of whatever image file
// the user picked), so any photo over roughly 1.5 MB blew past that limit and killed both the
// PDF export and the preview. file:// has no such cap. The temp file holds personal data, so
// it is always removed again once the render is done.
async function withPrintWindow<T>(html: string, run: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(app.getPath("temp"), "job-central-print-"));
  // The window is opened INSIDE the try: if the constructor throws, the finally still runs and
  // the temp dir (personal CV data) never survives on disk.
  let win: BrowserWindow | undefined;
  try {
    const file = path.join(dir, "document.html");
    await writeFile(file, html, "utf8");
    win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } });
    await win.loadFile(file);
    return await run(win);
  } finally {
    win?.destroy();
    // Never let a cleanup failure replace the real load/print error — that error is the only
    // thing the user sees when a render fails.
    await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
      console.error("[pdf] temp cleanup failed", dir, error);
    });
  }
}

// Render the CV to a PDF buffer at a given scale (scale<1 shrinks the rendering so it
// flows into fewer pages — Chromium's native print `scale`, which genuinely re-paginates).
// Page geometry comes from the CSS @page rule (size+margin) via preferCSSPageSize, so the
// per-page margins land on EVERY page (printToPDF's own `margins` option only applied the
// top margin to page 1). The HTML is loaded once and re-printed at different scales.
async function renderCvPdfBuffer(win: BrowserWindow, scale: number): Promise<Buffer> {
  return win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    scale,
    // ATS-friendly: emit a tagged (accessible) PDF with a logical structure tree
    // and a heading-based outline so applicant-tracking parsers can read the
    // document's reading order and section structure, not just flat text.
    generateTaggedPDF: true,
    generateDocumentOutline: true,
  });
}

async function pdfPageCount(buffer: Buffer): Promise<number> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.total ?? (Array.isArray(result.pages) ? result.pages.length : 0);
  } finally {
    await parser.destroy();
  }
}

// How many A4 pages this CV occupies at natural size — used as the target a tailored
// variant must match, so it never spills an orphan section onto an extra page.
export async function countCvPages(profile: Profile, cv: CvDocument | CvVersion): Promise<number> {
  return withPrintWindow(cvHtml(profile, cv), async (win) => pdfPageCount(await renderCvPdfBuffer(win, 1)));
}

// Render the CV to a PDF buffer through Chromium's print pipeline, fitting to `targetPages` when
// given. Returns the buffer PLUS the resolved page count and scale. This is the SINGLE Chromium
// print path shared by BOTH the on-disk export (generatePdf) and the on-screen PDF preview
// (cv:preview-pdf): the preview literally renders these same bytes, so preview ≡ export by
// construction — no second paginator, no second scale semantic to drift.
export async function renderCvPdf(
  profile: Profile,
  cv: CvDocument | CvVersion,
  targetPages?: number,
): Promise<{ buffer: Buffer; pageCount: number; scale: number }> {
  return withPrintWindow(cvHtml(profile, cv), async (win) => {
    let scale = 1;
    let buffer = await renderCvPdfBuffer(win, scale);
    let pages = await pdfPageCount(buffer);
    // Fit-to-target: if the CV spills past the master's page count, shrink the rendering in
    // small steps until it fits (the largest scale that fits = the least shrink, so text
    // stays as large as possible). Floor at 0.74 so it never becomes unreadably small.
    if (targetPages && targetPages > 0) {
      for (let guard = 0; pages > targetPages && scale > 0.74 && guard < 9; guard += 1) {
        scale = Math.round((scale - 0.03) * 100) / 100;
        buffer = await renderCvPdfBuffer(win, scale);
        pages = await pdfPageCount(buffer);
      }
    }
    return { buffer, pageCount: pages, scale };
  });
}

export async function generatePdf(profile: Profile, cv: CvVersion, outputPath?: string, targetPages?: number): Promise<string> {
  const exportDir = path.join(app.getPath("userData"), "job-central-data", "exports");
  await mkdir(exportDir, { recursive: true });
  const safeName = cv.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cv";
  const pdfPath = ensurePdfPath(outputPath ?? path.join(exportDir, `${safeName}-${Date.now()}.pdf`));
  await mkdir(path.dirname(pdfPath), { recursive: true });
  const { buffer } = await renderCvPdf(profile, cv, targetPages);
  await writeFile(pdfPath, buffer);
  return pdfPath;
}

export function coverLetterHtml(profile: Profile, letter: CoverLetter, job?: JobPost) {
  const paragraphs = letter.content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");

  return `<!doctype html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        @page { size: A4; margin: 22mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 11.5px; line-height: 1.55; }
        header { margin-bottom: 28px; padding-bottom: 12px; border-bottom: 2px solid #f97316; }
        h1 { margin: 0; font-size: 22px; }
        .meta { margin-top: 6px; color: #4b5563; display: flex; flex-wrap: wrap; gap: 8px 18px; }
        .job { margin: 0 0 26px; color: #374151; }
        p { margin: 0 0 13px; }
      </style>
    </head>
    <body>
      <header>
        <h1>${escapeHtml(profile.fullName)}</h1>
        <div class="meta">
          <span>${escapeHtml(profile.email)}</span>
          <span>${escapeHtml(profile.phone)}</span>
          <span>${escapeHtml(profile.location)}</span>
          <span>${escapeHtml(profile.website)}</span>
        </div>
      </header>
      <div class="job">${job ? `${escapeHtml(job.company)} · ${escapeHtml(job.title)}` : escapeHtml(letter.title)}</div>
      ${paragraphs}
    </body>
  </html>`;
}

export async function generateCoverLetterPdf(profile: Profile, letter: CoverLetter, job?: JobPost, outputPath?: string): Promise<string> {
  const exportDir = path.join(app.getPath("userData"), "job-central-data", "exports");
  await mkdir(exportDir, { recursive: true });
  const safeName = letter.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "motivation";
  const pdfPath = ensurePdfPath(outputPath ?? path.join(exportDir, `${safeName}-letter-${Date.now()}.pdf`));
  await mkdir(path.dirname(pdfPath), { recursive: true });
  return withPrintWindow(coverLetterHtml(profile, letter, job), async (win) => {
    const pdf = await win.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      margins: { marginType: "default" },
      // ATS-friendly: emit a tagged (accessible) PDF with a logical structure tree
      // and a heading-based outline so applicant-tracking parsers can read the
      // document's reading order and section structure, not just flat text.
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    });
    await writeFile(pdfPath, pdf);
    return pdfPath;
  });
}
