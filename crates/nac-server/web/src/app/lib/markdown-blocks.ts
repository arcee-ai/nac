// Splitting streamed markdown into independently parsable top-level blocks.

/** Opening or closing fence: up to three spaces, then three or more ` or ~. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const BLANK = /^[ \t]*$/;

/** What the block being scanned is, when that decides whether a blank line ends it. */
type BlockKind = "list" | "code" | "other";

function closes(line: string, opener: string): boolean {
  const match = CLOSING_FENCE.exec(line);
  if (!match) return false;
  const found = match[1];
  return found[0] === opener[0] && found.length >= opener.length;
}

/**
 * Whether `line` can still belong to the open block rather than start a new one.
 * Lists absorb blank lines between their items, and so does indented code.
 */
function continues(kind: BlockKind, line: string): boolean {
  if (kind === "list") return LIST_ITEM.test(line) || /^ {2,}\S/.test(line);
  if (kind === "code") return INDENTED_CODE.test(line);
  return false;
}

/**
 * Cut markdown at the blank lines that CommonMark treats as hard boundaries.
 *
 * A stream only ever appends, so every block but the last is final and can be
 * parsed once and memoized; that is what turns re-rendering a growing message
 * from quadratic into linear. Ambiguity is always resolved by *not* splitting —
 * an over-long block only costs a little work, whereas a wrong cut would change
 * what the text means.
 *
 * The one thing a caller gives up is document-wide context: a link reference
 * definition is only visible to the block it sits in. Finished messages are
 * rendered whole precisely so the archived transcript keeps that.
 */
export function splitMarkdownBlocks(source: string): string[] {
  const lines = source.split("\n");
  const blocks: string[] = [];
  let start = 0;
  let openFence: string | null = null;
  let kind: BlockKind | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (openFence !== null) {
      if (closes(line, openFence)) openFence = null;
      continue;
    }

    if (BLANK.test(line)) {
      if (kind === null) continue;
      let next = i + 1;
      while (next < lines.length && BLANK.test(lines[next])) next += 1;
      // Trailing blank lines belong to the tail: the next delta may well turn
      // them back into the middle of a block.
      if (next === lines.length) break;
      if (continues(kind, lines[next])) continue;

      blocks.push(lines.slice(start, i).join("\n"));
      start = next;
      kind = null;
      i = next - 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      openFence = fence[1];
      kind ??= "other";
      continue;
    }
    kind ??= LIST_ITEM.test(line)
      ? "list"
      : INDENTED_CODE.test(line)
        ? "code"
        : "other";
  }

  const tail = lines.slice(start).join("\n");
  if (tail.trim()) blocks.push(tail);
  return blocks;
}
