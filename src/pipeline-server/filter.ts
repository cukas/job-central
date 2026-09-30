// CH/European-remote location filter. Applied only to the global ATS boards
// at ingest, so they add reach without flooding the app with US/onsite roles.
// Curated Swiss employers (scope "swiss") and the user's Adzuna feed are kept whole.

const CH_TOKENS = [
  "switzerland", "schweiz", "suisse", "svizzera", "zurich", "zürich", "zuerich",
  "geneva", "genève", "genf", "ginevra", "basel", "bern", "berne", "lausanne",
  "lugano", "st. gallen", "st gallen", "sankt gallen", "winterthur", "zug",
  "lucerne", "luzern", "fribourg", "neuchâtel", "neuchatel", "sion", "biel",
  "bienne", "chur", "rotkreuz", "opfikon", "glattbrugg", "schlieren", "baar",
  "wallisellen", "kemptthal", "ticino", "vaud", "valais",
];

const NON_EU_NAMES = [
  "united states", "usa", "u.s.", "canada", "india", "singapore", "australia",
  "brazil", "mexico", "japan", "china", "philippines", "united arab", "dubai",
  "new york", "san francisco", "boston", "seattle", "los angeles", "toronto",
  "bengaluru", "bangalore", "hong kong", "taiwan", "new zealand", "south africa",
];

const NON_EU_CODES = new Set([
  "us", "usa", "ca", "au", "sg", "in", "jp", "cn", "hk", "tw", "ae", "nz",
  "br", "mx", "kr", "za", "ph",
]);

export function keepSwissOrRemote(location: string, remote: boolean): boolean {
  const loc = (location || "").toLowerCase();
  if (CH_TOKENS.some((t) => loc.includes(t))) return true;
  const tokens = new Set(loc.split(/[^a-z]+/).filter(Boolean));
  if (tokens.has("ch")) return true; // Switzerland country code (whole-token)
  if (remote || loc.includes("remote")) {
    if (NON_EU_NAMES.some((n) => loc.includes(n))) return false;
    for (const code of NON_EU_CODES) if (tokens.has(code)) return false;
    return true;
  }
  return false;
}
