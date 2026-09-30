/* eslint-disable */
// Ensure the Intel (x64) native binary of @napi-rs/canvas is present in node_modules
// before electron-builder cross-builds the x64 macOS app.
//
// Why this exists: pdf-parse loads @napi-rs/canvas to polyfill DOMMatrix/Path2D/ImageData
// for pdfjs in the main (Node) process. @napi-rs/canvas ships its native binary as a
// per-architecture package (@napi-rs/canvas-darwin-arm64, -darwin-x64, …). `npm install`
// on an Apple-Silicon Mac only fetches the arm64 one, so a cross-built x64 app would ship
// WITHOUT a loadable canvas binary — and on an Intel Mac the polyfill fails, throwing
// "ReferenceError: DOMMatrix is not defined" and crashing the app at launch.
//
// We fetch the matching -darwin-x64 package via `npm pack` and extract it straight into
// node_modules. `npm pack` only downloads that one tarball — it never runs npm's
// dependency reconciliation, so the already-installed arm64 binary is left untouched.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const NAPI_DIR = path.join(ROOT, "node_modules", "@napi-rs");
const TARGET = path.join(NAPI_DIR, "canvas-darwin-x64");

function readVersion(pkgDir) {
  return JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
}

const version = readVersion(path.join(NAPI_DIR, "canvas"));

if (fs.existsSync(path.join(TARGET, "package.json")) && readVersion(TARGET) === version) {
  console.log(`ensure-canvas-x64: @napi-rs/canvas-darwin-x64@${version} already present — nothing to do.`);
  process.exit(0);
}

console.log(`ensure-canvas-x64: fetching @napi-rs/canvas-darwin-x64@${version}…`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canvas-x64-"));
try {
  const packed = execFileSync(
    "npm",
    ["pack", `@napi-rs/canvas-darwin-x64@${version}`, "--pack-destination", tmp],
    { encoding: "utf8" },
  );
  const tgz = path.join(tmp, packed.trim().split("\n").pop().trim());

  fs.rmSync(TARGET, { recursive: true, force: true });
  fs.mkdirSync(TARGET, { recursive: true });
  // npm tarballs nest everything under "package/"; strip that one level.
  execFileSync("tar", ["-xzf", tgz, "-C", TARGET, "--strip-components=1"]);
  console.log(`ensure-canvas-x64: installed @napi-rs/canvas-darwin-x64@${version} → ${path.relative(ROOT, TARGET)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
