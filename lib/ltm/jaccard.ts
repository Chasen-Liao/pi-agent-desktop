/**
 * Similarity for the supersede check in SqliteBackend.remember().
 *
 * v1 scored whitespace tokens only. CJK text has no whitespace, so every
 * Chinese memory was a single giant token and two different memories scored
 * ~0 — the supersede path never fired for Chinese. Now CJK runs are tokenized
 * into character bigrams and pairs carrying CJK are scored with the Dice
 * coefficient (higher than Jaccard for near-duplicates: bigram sets are large,
 * so Jaccard under-scores them and the threshold stays out of reach).
 */
const CJK_DICE_THRESHOLD = 0.5;
const LATIN_JACCARD_THRESHOLD = 0.7;

// Han (incl. Ext-A), Hiragana, Katakana, Hangul — the scripts written without
// word spacing, so they need character-level tokenization.
const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
const CJK_RUN = new RegExp(`${CJK_CHAR.source}+`, "g");

function hasCJK(text: string): boolean {
  return CJK_CHAR.test(text);
}

function cjkBigrams(text: string): Set<string> {
  const set = new Set<string>();
  // Bigrams come only from contiguous CJK runs — bigramming Latin words too
  // ("alpha beta gamma" -> "ta" shared via alphabetagamma/delta) pollutes the
  // token set and makes disjoint English strings score > 0.
  for (const run of text.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) set.add(run.slice(i, i + 2));
  }
  return set;
}

function latinTokens(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((t) => t.length > 2));
}

function dice(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

export function jaccardSimilarity(a: string, b: string): number {
  const na = a.normalize("NFC").toLowerCase();
  const nb = b.normalize("NFC").toLowerCase();
  const bigramsA = cjkBigrams(na);
  const bigramsB = cjkBigrams(nb);

  // Both sides carry CJK: score the CJK bigrams alone. Scoring the union with
  // Latin tokens lets one shared term ("SQLite") push semantically different
  // records ("你好 SQLite" / "您好 SQLite") to exactly 0.5, silently marking a
  // distinct memory non-latest.
  if (bigramsA.size > 0 && bigramsB.size > 0) {
    return dice(bigramsA, bigramsB);
  }

  const setA = new Set([...bigramsA, ...latinTokens(na)]);
  const setB = new Set([...bigramsB, ...latinTokens(nb)]);
  if (setA.size === 0 || setB.size === 0) {
    // Single-char CJK has no bigrams; fall back to the v1 rule so identical
    // strings still score 1 (regression guard: jaccardSimilarity("好","好") === 1).
    return na.trim().replace(/\s+/g, " ") === nb.trim().replace(/\s+/g, " ") ? 1 : 0;
  }
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

/** Supersede decision: Dice 0.5 for CJK-containing pairs, Jaccard 0.7 for Latin (unchanged v1 behavior). */
export function isNearDuplicate(a: string, b: string): boolean {
  return jaccardSimilarity(a, b) >= (hasCJK(a) || hasCJK(b) ? CJK_DICE_THRESHOLD : LATIN_JACCARD_THRESHOLD);
}
