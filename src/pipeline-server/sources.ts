// Configured automated sources for background ingest. ONLY open/API sources belong here;
// Cloudflare-protected sites (Workday, jobs.ch, Indeed) are handled by the in-app
// browser "Grab jobs" using the user's own session, not server-side.
//
//   scope "swiss"  — curated Swiss employer, keep ALL roles (no location filter).
//   scope "global" — multinational, fetched whole then trimmed to CH/EU-remote.
import { ashbyAdapter } from "./adapters/ashby.js";
import { greenhouseAdapter } from "./adapters/greenhouse.js";
import { leverAdapter } from "./adapters/lever.js";
import { personioAdapter } from "./adapters/personio.js";
import { recruiteeAdapter } from "./adapters/recruitee.js";
import { smartRecruitersAdapter } from "./adapters/smartrecruiters.js";
import type { ScopedAdapter } from "./types.js";

export function buildAdapters(): ScopedAdapter[] {
  const swiss: ScopedAdapter[] = [
    { scope: "swiss", adapter: leverAdapter("frontify", "Frontify") },
    { scope: "swiss", adapter: leverAdapter("anybotics", "ANYbotics") },
    { scope: "swiss", adapter: greenhouseAdapter("scandit", "Scandit") },
    { scope: "swiss", adapter: greenhouseAdapter("ledgy", "Ledgy") },
    { scope: "swiss", adapter: greenhouseAdapter("squirro", "Squirro") },
    { scope: "swiss", adapter: personioAdapter("brandleadership", "Brack / Competec") },
    { scope: "swiss", adapter: personioAdapter("felfel", "FELFEL", "com") },
    { scope: "swiss", adapter: personioAdapter("planted", "Planted", "com") },
    { scope: "swiss", adapter: ashbyAdapter("smallpdf", "Smallpdf") },
    { scope: "swiss", adapter: recruiteeAdapter("climeworks", "Climeworks") },
    { scope: "swiss", adapter: recruiteeAdapter("vshn", "VSHN") },
    { scope: "swiss", adapter: recruiteeAdapter("elca", "ELCA") },
  ];
  const global: ScopedAdapter[] = [
    { scope: "global", adapter: greenhouseAdapter("onrunning", "On") },
    { scope: "global", adapter: greenhouseAdapter("proton", "Proton") },
    { scope: "global", adapter: leverAdapter("sonarsource", "SonarSource") },
    { scope: "global", adapter: smartRecruitersAdapter("nexthink", "Nexthink") },
    { scope: "global", adapter: smartRecruitersAdapter("sportradar", "Sportradar") },
    { scope: "global", adapter: greenhouseAdapter("gitlab", "GitLab") },
    { scope: "global", adapter: greenhouseAdapter("getyourguide", "GetYourGuide") },
    { scope: "global", adapter: ashbyAdapter("deepl", "DeepL") },
    { scope: "global", adapter: ashbyAdapter("confluent", "Confluent") },
  ];
  return [...swiss, ...global];
}
