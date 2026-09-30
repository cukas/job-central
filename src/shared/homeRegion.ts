export function homeRegionTerms(location = ""): string[] {
  return location
    .split(/[,;/|]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3);
}

export function wholeWordPattern(alternatives: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

export function mentionsHomeRegion(text: string, location = ""): boolean {
  const terms = homeRegionTerms(location).map(escapeRegExp);
  return terms.length > 0 && wholeWordPattern(terms).test(text);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
