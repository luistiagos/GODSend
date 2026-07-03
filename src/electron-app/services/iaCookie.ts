export function normalizeIACookiePair(name: string, raw: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";

  const firstPart = trimmed.split(";", 1)[0].trim();
  const expectedPrefix = `${name}=`;
  if (firstPart.toLowerCase().startsWith(expectedPrefix.toLowerCase())) {
    return `${name}=${firstPart.slice(expectedPrefix.length)}`;
  }
  return `${name}=${firstPart}`;
}
