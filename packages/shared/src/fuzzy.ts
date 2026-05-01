/**
 * Fuzzy string matching: token-set ratio over normalized strings.
 *
 * Token-set ratio is robust to word order and length differences, which is exactly
 * what we want for clinical free-text fields ("sore throat" vs "throat is sore").
 *
 * Returns a score in [0, 1].
 */

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "to", "for", "with", "is", "are", "was", "were",
  "in", "on", "at", "by", "from", "as", "or", "be", "has", "had", "have", "this",
]);

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s./]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/**
 * Token-set ratio: focuses on the intersection of token sets, downweighting
 * extra "filler" words that wouldn't hurt clinical meaning. Scaled to [0,1].
 */
export function tokenSetRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const at = new Set(tokenize(a));
  const bt = new Set(tokenize(b));
  if (at.size === 0 && bt.size === 0) return 1;
  if (at.size === 0 || bt.size === 0) return 0;
  const intersection = new Set([...at].filter((t) => bt.has(t)));
  const union = new Set([...at, ...bt]);
  // Jaccard-style similarity over token sets.
  return intersection.size / union.size;
}

/**
 * Levenshtein distance — used as a finer-grained backup for short strings
 * (e.g. medication names where typos matter more than word-set overlap).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0: number[] = new Array(b.length + 1);
  const v1: number[] = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(
        (v1[j] ?? 0) + 1,
        (v0[j + 1] ?? 0) + 1,
        (v0[j] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j] ?? 0;
  }
  return v0[b.length] ?? 0;
}

export function levenshteinRatio(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

/**
 * Hybrid fuzzy score: max(token-set, levenshtein-ratio).
 * - Token-set wins for long phrases with reordering ("nasal congestion and sore throat").
 * - Levenshtein wins for short strings with typos ("amoxicillin" vs "amoxicilin").
 */
export function fuzzyScore(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 1;
  if (a == null || b == null) return 0;
  return Math.max(tokenSetRatio(a, b), levenshteinRatio(a, b));
}

export function fuzzyEquals(a: string | null | undefined, b: string | null | undefined, threshold = 0.8): boolean {
  return fuzzyScore(a, b) >= threshold;
}
