/**
 * Fuzzy-ish matching for the palette: every query character must appear in
 * order. Matches at word starts and runs of adjacent characters score higher,
 * and an exact substring beats a scattered one. Returns null for no match.
 */
export declare function fuzzyScore(query: string, text: string): number | null;
/**
 * Best score of `query` across a label and its extra search words. Extra words
 * only count when the query appears in them as written (at any word), so a
 * long keyword list cannot turn every two letters into a scattered match.
 */
export declare function bestScore(query: string, label: string, keywords?: string): number | null;
