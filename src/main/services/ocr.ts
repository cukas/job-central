// On-device OCR for scanned/image PDFs via Apple's Vision framework.
//
// Many uploaded documents — Arbeitszeugnisse, reference letters, diplomas — are scanned
// signed pages with NO text layer, so pdf-parse returns essentially nothing. We render
// each page with PDFKit and recognise text with VNRecognizeTextRequest (the same engine
// as macOS Live Text): high quality, German-aware, free, and fully on-device — the
// document never leaves the machine.
//
// The Swift helper is written to a temp file and run with `swift` (no compile/packaging
// step). If OCR is unavailable (non-macOS, or no Swift toolchain) or fails, ocrPdf
// returns "" and the caller falls back to whatever text layer exists.

import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Bump the version suffix when this source changes so the cached temp copy is refreshed.
const SCRIPT_VERSION = "v1";

const VISION_OCR_SWIFT = String.raw`
import Foundation
import CoreGraphics
import PDFKit
import Vision

// usage: swift vision-ocr.swift <pdfPath>
guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write("usage: vision-ocr <pdf>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let doc = PDFDocument(url: url) else {
    FileHandle.standardError.write("cannot open pdf\n".data(using: .utf8)!)
    exit(3)
}

func recognize(_ image: CGImage) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["de-DE", "en-US"]
    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    do { try handler.perform([request]) } catch { return "" }
    guard let results = request.results else { return "" }
    return results.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

let scale: CGFloat = 2.0 // ~144dpi — enough detail for accurate OCR without huge bitmaps
var pages = [String]()
for index in 0..<doc.pageCount {
    guard let page = doc.page(at: index) else { continue }
    let bounds = page.bounds(for: .mediaBox)
    let width = Int(bounds.width * scale)
    let height = Int(bounds.height * scale)
    guard width > 0, height > 0,
          let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                              bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    guard let image = ctx.makeImage() else { continue }
    let text = recognize(image)
    if !text.isEmpty { pages.append(text) }
}
print(pages.joined(separator: "\n\n"))
`;

let cachedScriptPath: string | null = null;

function ensureScript(): string {
  if (cachedScriptPath && existsSync(cachedScriptPath)) return cachedScriptPath;
  const scriptPath = path.join(tmpdir(), `jobcentral-vision-ocr-${SCRIPT_VERSION}.swift`);
  if (!existsSync(scriptPath)) writeFileSync(scriptPath, VISION_OCR_SWIFT, "utf8");
  cachedScriptPath = scriptPath;
  return scriptPath;
}

/**
 * OCR a PDF on-device with Apple Vision. Returns recognised text, or "" when OCR is
 * unavailable (non-macOS / no Swift toolchain) or fails — callers fall back to the text
 * layer. Never throws.
 */
export async function ocrPdf(filePath: string): Promise<string> {
  if (process.platform !== "darwin") return "";
  try {
    const script = ensureScript();
    const { stdout } = await execFileAsync("swift", [script, filePath], {
      timeout: 180000, // a 12-page accurate OCR pass can take a while; cap so it can't hang
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return ""; // swift missing, render/recognise error, or timeout → graceful no-OCR
  }
}
