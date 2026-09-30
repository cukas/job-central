/* eslint-disable */
// electron-builder afterSign hook: notarize + staple the macOS app so it opens
// cleanly on other people's Macs (Gatekeeper blocks signed-but-NON-notarized apps
// that were downloaded). CommonJS (.cjs) because the package is "type": "module".
//
// Credentials (either works):
//   1) A notarytool keychain profile — set APPLE_KEYCHAIN_PROFILE. Create it once with:
//        xcrun notarytool store-credentials "<profile>" \
//          --apple-id "<you@example.com>" --team-id "<TEAM_ID>" --password "<app-specific-pw>"
//      This keeps the app-specific password out of the environment and logs.
//   2) Env vars — APPLE_ID, APPLE_APP_PASSWORD (or APPLE_APP_SPECIFIC_PASSWORD), APPLE_TEAM_ID.
//
// With none of the above set, notarization is skipped (the build is still Developer-ID
// signed — recipients can right-click → Open, just without the one-click experience).
const { execFileSync } = require("node:child_process");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const profile = process.env.APPLE_KEYCHAIN_PROFILE;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  let options;
  if (profile) {
    options = { tool: "notarytool", appPath, keychainProfile: profile };
  } else if (appleId && appleIdPassword && teamId) {
    options = { tool: "notarytool", appPath, appleId, appleIdPassword, teamId };
  } else {
    console.log(
      "notarize: no credentials (set APPLE_KEYCHAIN_PROFILE, or APPLE_ID + APPLE_APP_PASSWORD + APPLE_TEAM_ID) — skipping notarization. The app is still Developer-ID signed.",
    );
    return;
  }

  const { notarize } = require("@electron/notarize");
  console.log(`notarize: submitting ${appName}.app to Apple (this can take a few minutes)…`);
  await notarize(options);

  // Staple the ticket so the app also verifies offline (no network round-trip on launch).
  console.log("notarize: stapling ticket…");
  execFileSync("xcrun", ["stapler", "staple", appPath], { stdio: "inherit" });
  console.log("notarize: done — notarized and stapled.");
};
