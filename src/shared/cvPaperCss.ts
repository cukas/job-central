// SINGLE SOURCE OF TRUTH for the CV "paper" look (templates, density, sections).
//
// Used by BOTH:
//  - the live preview (App.tsx <CvPreview> injects it as a <style>, scoped under
//    `.paper` so it wins over any older copies still in styles.css), and
//  - the PDF export (services/pdf.ts embeds it),
// so the on-screen CV and the exported PDF can never drift apart again.
//
// Every rule is scoped under `.paper` (the CV root element carries
// `class="paper template-<x> density-<y>"`). The accent colour comes from the
// `--accent` custom property, set inline on the paper element / in the print CSS.

export const CV_PAPER_CSS = `
.paper { background: #fff; color: #050506; padding: 58px 58px 72px; --accent: #55a8e8; }

.paper .portrait { width: 96px; height: 96px; border-radius: 999px; flex: 0 0 auto; background: var(--panel-3, #e9e9ec); color: var(--muted, #555); display: grid; place-items: center; font-weight: 850; font-size: 25px; overflow: hidden; }
.paper .portrait.large { width: 110px; height: 110px; }
.paper .portrait img { width: 100%; height: 100%; object-fit: cover; }

.paper .cv-header { display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: center; margin-bottom: 42px; }
.paper .cv-header h2 { margin: 0 0 10px; font-size: 42px; color: #050506; }
.paper .cv-header p { margin: 0 0 16px; font-size: 24px; line-height: 1.15; }
.paper .cv-contact { display: flex; flex-wrap: wrap; gap: 10px 20px; font-size: 14px; }
.paper .cv-contact span { display: inline-flex; align-items: center; gap: 6px; }
.paper .cv-contact svg { color: var(--accent); flex: 0 0 auto; }
.paper .personal-data { display: flex; flex-wrap: wrap; gap: 9px 18px; margin-top: 11px; font-size: 13px; color: #4b5563; }
.paper .personal-data span { display: inline-flex; align-items: center; gap: 6px; }
.paper .personal-data svg { color: var(--accent); flex: 0 0 auto; }

.paper .cv-section { margin-bottom: 34px; }
.paper .cv-section h3 { margin: 0 0 12px; padding-bottom: 7px; border-bottom: 2px solid var(--accent); font-size: 19px; text-transform: uppercase; }
.paper .cv-section p { margin: 0 0 10px; white-space: pre-line; line-height: 1.48; }
.paper .cv-section ul { margin: 0 0 10px 18px; padding: 0; line-height: 1.48; }
.paper .cv-section ol { margin: 0 0 10px 18px; padding: 0; line-height: 1.48; }
.paper .cv-section li { margin-bottom: 4px; }

.paper .cv-entry { margin: 0 0 16px; break-inside: avoid; }
.paper .cv-entry p { margin: 0 0 6px; line-height: 1.36; }
.paper .cv-entry ul, .paper .cv-entry ol { margin: 6px 0 0 18px; padding: 0; }
.paper .cv-entry li { margin: 3px 0; line-height: 1.36; }

/* Career entries (experience/education) FLOW across a page break instead of jumping the
   whole role to the next page (which leaves a gap). The heading stays glued to its first
   bullet (no orphaned title), each bullet stays whole, and the rest of the bullets continue
   on the next page. Placed AFTER the .cv-entry rule above so this break-inside override wins
   (same specificity, later source order). PDF-only effect — the live preview paginates via
   JS sheets, so it must mirror this split itself (Slice B). */
.paper .cv-entry--flow { break-inside: auto; orphans: 2; widows: 2; }
.paper .cv-entry--flow .cv-entry-heading { break-inside: avoid; break-after: avoid; }
.paper .cv-entry--flow ul, .paper .cv-entry--flow ol { break-inside: auto; }
.paper .cv-entry--flow li, .paper .cv-entry--flow p { break-inside: avoid; }

/* Preview-only: when the JS paginator continues a split role on a fresh page, that fragment is a
   .cv-entry--cont (heading dropped). Its first list/paragraph sits flush at the page top - no
   leftover top margin. (No such element exists in the PDF, where one .cv-entry--flow div flows via
   the CSS break rules above, so this rule is inert there.) */
.paper .cv-entry--cont > ul:first-child, .paper .cv-entry--cont > p:first-child { margin-top: 0; }
.paper .cv-entry-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: baseline; margin-bottom: 6px; }
.paper .cv-entry-heading strong, .paper .cv-entry-heading span, .paper .cv-entry-heading time, .paper .cv-language-entry strong, .paper .cv-language-entry span { display: block; }
.paper .cv-entry-heading span, .paper .cv-entry-heading time, .paper .cv-skill-entry span, .paper .cv-language-entry span { color: #4b5563; }

/* Same-employer grouping (CvStyle.groupSameEmployer): the employer + total span print once,
   the roles nest underneath. Indentation only - no left rule - so the block stays neutral
   across every template. The company heading is glued to its first role (break-after: avoid,
   inherited from .cv-entry--flow), while the role list itself may still flow across a page. */
.paper .cv-company-heading { margin-bottom: 10px; }
.paper .cv-company-roles { margin-left: 18px; }
.paper .cv-role { margin: 0 0 13px; break-inside: auto; }
.paper .cv-role:last-child { margin-bottom: 0; }
.paper .cv-role .cv-entry-heading { margin-bottom: 4px; break-inside: avoid; break-after: avoid; }
.paper .cv-role p { margin: 0 0 6px; line-height: 1.36; }
.paper .cv-role ul, .paper .cv-role ol { margin: 6px 0 0 18px; padding: 0; }
.paper .cv-role li { margin: 3px 0; line-height: 1.36; }
.paper.density-compact .cv-company-heading { margin-bottom: 7px; }
.paper.density-compact .cv-role { margin-bottom: 9px; }

.paper .cv-skill-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 46px; row-gap: 14px; }
.paper .cv-skill-entry { margin: 0; line-height: 1.4; }
.paper .cv-skill-entry strong { display: inline; margin: 0; font-size: 15px; }
.paper .cv-skill-entry p { color: #111827; }
.paper .cv-skill-entry ul { margin-top: 3px; }

.paper .cv-language-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 52px; }
.paper .cv-language-entry { display: grid; gap: 2px; break-inside: avoid; }
.paper .cv-language-entry strong { font-weight: 800; }
.paper .cv-language-entry span { color: #4b5563; }
.paper .cv-language-entry p { margin: 4px 0 0; }

/* ===== templates (each template class sits on the .paper element) ===== */
.paper.template-executive { border-top: 0; padding-top: 0; }
.paper.template-executive .cv-header { margin: 0 -58px 36px; padding: 48px 58px 40px; background: #121212; color: #fff; }
.paper.template-executive .cv-header h2, .paper.template-executive .cv-header p, .paper.template-executive .cv-contact { color: #fff; }
.paper.template-executive .cv-section h3 { border-bottom-color: var(--accent); color: #111; }

.paper.template-minimal .cv-header { border-bottom: 1px solid #111; padding-bottom: 24px; grid-template-columns: 1fr; }
.paper.template-minimal .cv-section h3 { border-bottom-width: 1px; font-size: 15px; letter-spacing: 0; }
.paper.template-minimal .portrait { display: none; }

.paper.template-sidebar { display: grid; grid-template-columns: 220px 1fr; gap: 34px; }
.paper.template-sidebar .cv-header { align-content: start; grid-template-columns: 1fr; margin: -58px 0 -72px -58px; padding: 58px 26px 72px; background: var(--accent); color: #fff; }
.paper.template-sidebar .cv-header h2, .paper.template-sidebar .cv-header p, .paper.template-sidebar .cv-contact { color: #fff; }
.paper.template-sidebar .cv-contact { display: grid; gap: 8px; }
.paper.template-sidebar .cv-section { grid-column: 2; }

.paper.template-classic .cv-header { grid-template-columns: 1fr; text-align: center; border-bottom: 1px solid #1f2937; padding-bottom: 28px; }
.paper.template-classic .portrait { margin: 0 auto 8px; }
.paper.template-classic .cv-header h2, .paper.template-classic .cv-section h3 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; }
.paper.template-classic .cv-section h3 { border-bottom: 1px solid #1f2937; letter-spacing: 0; text-transform: none; font-size: 20px; }

.paper.template-swiss .cv-section h3 { border-bottom-color: #111; letter-spacing: 0.12em; }
.paper.template-swiss .cv-header { align-items: start; border-bottom: 3px solid #111; padding-bottom: 22px; }
.paper.template-swiss .cv-header h2 { letter-spacing: 0; }

.paper.template-compact { padding: 44px; }
.paper.template-compact .cv-header h2 { font-size: 34px; }
.paper.template-compact .cv-header { margin-bottom: 24px; }
.paper.template-compact .cv-section { margin-bottom: 18px; }
.paper.template-compact .cv-section h3 { font-size: 15px; }

.paper.template-ats .cv-header { grid-template-columns: 1fr; border-bottom: 2px solid #111; padding-bottom: 18px; }
.paper.template-ats .portrait { display: none; }
.paper.template-ats .cv-section h3 { color: #111; border-bottom: 1px solid #111; letter-spacing: 0.02em; font-size: 14px; text-transform: uppercase; }
.paper.template-ats .cv-header h2 { letter-spacing: 0; }

.paper.template-zurich .cv-header { border-bottom: 3px solid var(--accent); padding-bottom: 20px; }
.paper.template-zurich .cv-section h3 { color: #111; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
.paper.template-zurich .cv-section h3::before { content: ""; display: inline-block; width: 14px; height: 3px; background: var(--accent); margin-right: 8px; vertical-align: middle; }

.paper.template-modern .cv-header { grid-template-columns: 1fr; border: 0; }
.paper.template-modern .cv-header h2 { color: var(--accent); }
.paper.template-modern .cv-section { margin-bottom: 26px; }
.paper.template-modern .cv-section h3 { color: #111; border: 0; border-left: 3px solid var(--accent); padding-left: 10px; letter-spacing: 0.04em; }

.paper.template-slate { border-top: 0; padding-top: 0; }
.paper.template-slate .cv-header { margin: 0 -58px 32px; padding: 44px 58px 34px; background: #1f2937; color: #fff; grid-template-columns: 1fr auto; }
.paper.template-slate .cv-header h2, .paper.template-slate .cv-header p, .paper.template-slate .cv-contact { color: #fff; }
.paper.template-slate .cv-section h3 { color: #1f2937; border-bottom: 2px solid var(--accent); }

.paper.template-editorial { padding: 64px; }
.paper.template-editorial .cv-header { grid-template-columns: 1fr; border-bottom: 1px solid #111; padding-bottom: 22px; }
.paper.template-editorial .cv-header h2 { font-size: 40px; font-weight: 800; letter-spacing: -0.01em; }
.paper.template-editorial .cv-section { margin-bottom: 30px; }
.paper.template-editorial .cv-section h3 { border: 0; border-top: 1px solid #111; padding-top: 8px; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #111; }

.paper.template-techmono .cv-header h2 { font-family: "SFMono-Regular", "JetBrains Mono", "Menlo", monospace; letter-spacing: -0.02em; }
.paper.template-techmono .cv-section h3 { font-family: "SFMono-Regular", "JetBrains Mono", "Menlo", monospace; color: var(--accent); border-bottom: 1px dashed #cbd5e1; text-transform: none; font-size: 14px; }
.paper.template-techmono .cv-section h3::before { content: "// "; color: var(--accent); }

.paper.template-elegant { font-family: Georgia, "Times New Roman", serif; }
.paper.template-elegant .cv-header h2 { font-family: Georgia, serif; font-weight: 700; }
.paper.template-elegant .cv-section { line-height: 1.5; }
.paper.template-elegant .cv-section h3 { font-family: Georgia, serif; font-style: italic; font-weight: 700; color: #111; border-bottom: 1px solid var(--accent); letter-spacing: 0; text-transform: none; }

/* ===== density: "compact" tightens spacing + line-height ("comfortable" = the defaults above) =====
   Lives HERE in the single source of truth - NOT styles.css, where the old copy was silently
   overridden by these very .paper rules (same specificity, later source order), which is why
   density appeared to do nothing. Scoped .paper.density-compact (two classes on the same
   element) so it out-specifies the base .paper rules, and placed LAST so it also wins over
   equal-specificity per-template rules. Applies to BOTH the live preview and the embedded-CSS
   PDF. Page padding/margins are already density-aware (inline in the preview, @page in the PDF),
   so only text spacing is tuned here. */
/* compact keeps the SAME font size and heading sizes as comfortable (no shrinking — that looked
   cramped/ugly); it only tightens the vertical gaps a little, so the CV reads identically, just
   slightly denser. */
.paper.density-compact .cv-header { margin-bottom: 30px; }
.paper.density-compact .cv-section { margin-bottom: 24px; }
.paper.density-compact .cv-section p, .paper.density-compact .cv-section ul, .paper.density-compact .cv-section ol { line-height: 1.4; }
.paper.density-compact .cv-entry { margin-bottom: 11px; }
.paper.density-compact .cv-entry p, .paper.density-compact .cv-entry li { line-height: 1.3; }
.paper.density-compact .cv-skill-grid { row-gap: 11px; }
.paper.density-compact .cv-language-grid { gap: 8px 52px; }
`;

// SINGLE SOURCE OF TRUTH for the CV font stack, used by BOTH the live preview (App.tsx) and the
// PDF export (services/pdf.ts), so the two render in the IDENTICAL typeface. Previously the preview
// mapped "system" → SF Pro while the PDF mapped it → Arial; the different glyph widths wrapped text
// onto different lines and paginated differently, so the PDF never matched the preview. Both run in
// Electron's Chromium, so `-apple-system` resolves to the same face in each.
const CV_FONT_STACKS: Record<string, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  classic: 'Georgia, "Times New Roman", serif',
  grotesk: 'Arial, Helvetica, sans-serif',
  mono: 'Menlo, "Courier New", monospace',
};
export function cvFontStack(font: string | undefined | null): string {
  const key = (font || "system").trim();
  if (CV_FONT_STACKS[key]) return CV_FONT_STACKS[key];
  // Custom font name: sanitise to a valid font-family token (safe both in a React style object AND
  // an HTML <style> string), then fall back to the system stack.
  const safe = key.replace(/[^a-zA-Z0-9 _-]/g, "").trim();
  return safe ? `"${safe}", ${CV_FONT_STACKS.system}` : CV_FONT_STACKS.system;
}

// Inline (lucide-style) contact icons for the PDF, so the exported header matches
// the React preview (which renders the same lucide icons as SVG).
const ICON_ATTRS =
  'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
export const CV_CONTACT_ICON_SVG: Record<string, string> = {
  email: `<svg ${ICON_ATTRS}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`,
  phone: `<svg ${ICON_ATTRS}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  location: `<svg ${ICON_ATTRS}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  linkedin: `<svg ${ICON_ATTRS}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>`,
  github: `<svg ${ICON_ATTRS}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`,
  website: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>`,
};

// Icons for the "personal data" header row (nationality / work permit / date of birth),
// so it matches the contact row's icon style in the PDF. Keys match cvPersonalDataItems().
export const CV_PERSONAL_ICON_SVG: Record<string, string> = {
  nationality: `<svg ${ICON_ATTRS}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>`,
  workPermit: `<svg ${ICON_ATTRS}><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/></svg>`,
  dateOfBirth: `<svg ${ICON_ATTRS}><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`,
};
