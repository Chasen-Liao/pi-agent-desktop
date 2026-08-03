/** Whitespace tokens, drop length <= 2 (ASCII-oriented v1). */
export function jaccardSimilarity(a: string, b: string): number {
  const na = a.normalize("NFC").toLowerCase();
  const nb = b.normalize("NFC").toLowerCase();
  const setA = tokens(na);
  const setB = tokens(nb);
  if (setA.size === 0 || setB.size === 0) {
    return na.trim().replace(/\s+/g, " ") === nb.trim().replace(/\s+/g, " ") ? 1 : 0;
  }
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

function tokens(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((t) => t.length > 2));
}
