// Line shapes of CommonMark block structure.
//
// Two passes over streamed markdown need to agree on these: the block splitter,
// which may only cut where a block really ends, and the math normalizer, which
// may only rewrite delimiters outside of code. Both above all have to recognise
// a fence, so they read the rules from here rather than each keeping a copy.

/** Opening or closing fence: up to three spaces, then three or more ` or ~. */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
export const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
export const INDENTED_CODE = /^(?: {4}|\t)/;
export const BLANK = /^[ \t]*$/;

/**
 * A `$$` that opens display math, as micromark reads it: alone on its line bar
 * the indent, because a dollar anywhere in the info string rejects the fence.
 * `$$x$$` is therefore inline math rather than a one-line block.
 */
export const MATH_FENCE = /^ {0,3}\$\$[^$]*$/;
/** Its closing line: the sequence again, then nothing but trailing space. */
export const CLOSING_MATH_FENCE = /^ {0,3}\$\$+[ \t]*$/;

/** Whether `line` closes the fenced block that `opener` started. */
export function closesFence(line: string, opener: string): boolean {
  const match = CLOSING_FENCE.exec(line);
  if (!match) return false;
  const found = match[1];
  return found[0] === opener[0] && found.length >= opener.length;
}

/** The line that `index` is the start of, without its line ending. */
export function lineAt(source: string, index: number): string {
  const end = source.indexOf("\n", index);
  return source.slice(index, end === -1 ? source.length : end);
}

/** Index just past the line `index` is on, line ending included. */
export function nextLine(source: string, index: number): number {
  const end = source.indexOf("\n", index);
  return end === -1 ? source.length : end + 1;
}
