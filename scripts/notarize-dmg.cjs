/* eslint-disable */
// electron-builder afterAllArtifactBuild hook: sign + notarize + staple the .dmg.
//
// The afterSign hook (notarize.cjs) notarizes the .app, but electron-builder builds the
// DMG AFTER that and (with built-in notarization disabled) leaves the DMG unsigned — so
// Gatekeeper's signature check on the downloaded DMG fails. Here we close that gap:
// code-sign the DMG with the Developer ID, notarize it, and staple the ticket, so the
// DMG itself opens cleanly (online and offline). CommonJS (.cjs) — the package is ESM.
//
// Credentials resolve the same way as notarize.cjs: APPLE_KEYCHAIN_PROFILE, or
// APPLE_ID + APPLE_APP_PASSWORD (or APPLE_APP_SPECIFIC_PASSWORD) + APPLE_TEAM_ID. With
// none set, the DMG is left as-is (the .app inside is still signed).
const { execFileSync } = require("node:child_process");

function developerIdIdentity() {
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  try {
    const out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
    return out.match(/"(Developer ID Application: [^"]+)"/)?.[1];
  } catch {
    return undefined;
  }
}

function notaryAuthArgs() {
  if (process.env.APPLE_KEYCHAIN_PROFILE) return ["--keychain-profile", process.env.APPLE_KEYCHAIN_PROFILE];
  const appleId = process.env.APPLE_ID;
  const password = process.env.APPLE_APP_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (appleId && password && teamId) return ["--apple-id", appleId, "--password", password, "--team-id", teamId];
  return undefined;
}

exports.default = async function afterAllArtifactBuild(buildResult) {
  if (process.platform !== "darwin") return [];
  const dmgs = (buildResult.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  if (!dmgs.length) return [];

  const auth = notaryAuthArgs();
  if (!auth) {
    console.log("notarize-dmg: no credentials — leaving the DMG un-notarized (the app inside is still signed).");
    return [];
  }
  const identity = developerIdIdentity();

  for (const dmg of dmgs) {
    if (identity) {
      console.log(`notarize-dmg: signing ${dmg}…`);
      execFileSync("codesign", ["--force", "--timestamp", "--sign", identity, dmg], { stdio: "inherit" });
    } else {
      console.log("notarize-dmg: no Developer ID identity found — notarizing the unsigned DMG.");
    }
    console.log(`notarize-dmg: submitting ${dmg} to Apple (a few minutes)…`);
    execFileSync("xcrun", ["notarytool", "submit", dmg, ...auth, "--wait"], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
    console.log(`notarize-dmg: ${dmg} signed, notarized, and stapled.`);
  }
  return [];
};
