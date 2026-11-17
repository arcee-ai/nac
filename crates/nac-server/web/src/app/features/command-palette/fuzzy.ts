/**
 * Fuzzy-ish matching for the palette: every query character must appear in
 * order. Matches at word starts and runs of adjacent characters score higher,
 * and an exact substring beats a scattered one. Returns null for no match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  const substring = haystack.indexOf(needle);
  if (substring >= 0) {
    const wordStart = substring === 0 || /[\s/·_\-.]/.test(haystack[substring - 1] ?? "");
    return 1000 - substring + (wordStart ? 200 : 0) + needle.length * 4;
  }
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    if (char === " ") continue;
    const index = haystack.indexOf(char, from);
    if (index < 0) return null;
    const wordStart = index === 0 || /[\s/·_\-.]/.test(haystack[index - 1] ?? "");
    score += 10 + (index === previous + 1 ? 8 : 0) + (wordStart ? 12 : 0);
    previous = index;
    from = index + 1;
  }
  // Prefer compact matches over ones spread across a long string.
  return score - Math.min(from - needle.length, 60);
}

/**
 * Best score of `query` across a label and its extra search words. Extra words
 * only count when the query appears in them as written (at any word), so a
 * long keyword list cannot turn every two letters into a scattered match.
 */
export function bestScore(query: string, label: string, keywords?: string): number | null {
  const own = fuzzyScore(query, label);
  const needle = query.trim().toLowerCase();
  const extra =
    keywords && needle && keywords.toLowerCase().includes(needle) ? 500 + needle.length * 4 : null;
  if (own === null) return extra;
  return extra === null ? own : Math.max(own, extra);
}
