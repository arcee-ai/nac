// Rewriting the math a model wrote into the one shape remark-math reads.
//
// Two things have to be settled before the parser runs, and neither can be fixed
// afterwards:
//
// - Models write `\(x\)` and `\[x\]` as often as they write dollars, and to
//   markdown those are escaped brackets. By the time remark-math looks at the
//   tree the delimiters are gone and the text says `(x)`.
// - remark-math pairs single dollars far too eagerly. In "costs $5 instead of
//   $10" it reads "5 instead of" as math, so prose about money silently turns
//   into italics and ligatures. Dollars are therefore paired here, under the
//   stricter rule Pandoc uses, and every one left over is escaped so remark-math
//   cannot pair it with the next.
//
// Code is the one place none of this applies: a fenced block, an indented block
// and an inline span are all copied out untouched, `$` and backslashes and all.

import {
  BLANK,
  FENCE,
  INDENTED_CODE,
  closesFence,
  lineAt,
  nextLine,
} from "@/app/lib/markdown-lines";

/** A blank line ends the paragraph, so no one span may straddle it. */
const BLANK_LINE = /\n[ \t]*\n/;
/** What a display block may have between the line start and its delimiter. */
const BLOCK_PREFIX = /^[ \t>]*$/;

export interface NormalizedMath {
  /** The source with every math span written the way remark-math reads it. */
  source: string;
  /**
   * Whether any math was found at all — what decides whether MathJax is loaded
   * for this text, which is the whole reason the flag is reported.
   */
  hasMath: boolean;
}

interface MathSpan {
  /** Index of the opening delimiter. */
  start: number;
  /** Index just past the closing delimiter. */
  end: number;
  /** What sits between the delimiters, verbatim. */
  content: string;
  display: boolean;
}

/**
 * Normalize the math in one markdown source, and say whether it has any.
 *
 * Anything that does not parse as a span is left as prose, which is what makes
 * a half-arrived stream readable: the delimiters of an unfinished formula show
 * as themselves until the closing one lands, rather than flashing broken math.
 */
export function normalizeMath(source: string): NormalizedMath {
  let out = "";
  let hasMath = false;
  let index = 0;

  while (index < source.length) {
    if (index === 0 || source[index - 1] === "\n") {
      const code = codeBlockEnd(source, index);
      if (code !== null) {
        out += source.slice(index, code);
        index = code;
        continue;
      }
    }

    const char = source[index];

    if (char === "\\") {
      const span =
        source[index + 1] === "("
          ? delimited(source, index, "\\(", "\\)", false)
          : source[index + 1] === "["
            ? delimited(source, index, "\\[", "\\]", true)
            : null;
      if (span) {
        out += written(source, span);
        hasMath = true;
        index = span.end;
        continue;
      }
      // Every other escape is copied as a pair, so `\\(` is not read as `\(`.
      out += source.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (char === "`") {
      const end = codeSpanEnd(source, index);
      out += source.slice(index, end);
      index = end;
      continue;
    }

    if (char === "$") {
      const span =
        source[index + 1] === "$"
          ? delimited(source, index, "$$", "$$", true)
          : dollarText(source, index);
      if (span) {
        out += written(source, span);
        hasMath = true;
        index = span.end;
        continue;
      }
      // A dollar that pairs with nothing is prose. Escaping it is what keeps
      // remark-math from reaching past it to the next one; `\$` still renders
      // as a dollar, with or without the math plugins.
      out += "\\$";
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return { source: out, hasMath };
}

/**
 * A span written the way remark-math reads it. Inline math is always `$…$`.
 *
 * Display math becomes a `$$` block whenever it has a line to itself, which is
 * what centres it and lets a wide formula scroll. Anywhere else — mid-sentence,
 * or in a table cell — breaking the line would take the surrounding markdown
 * with it, so there it stays inline.
 */
function written(source: string, span: MathSpan): string {
  if (!span.display) return `$${span.content}$`;

  const prefix = blockPrefix(source, span.start);
  if (prefix === null || !BLANK.test(lineAt(source, span.end))) {
    return `$$${span.content}$$`;
  }

  // The prefix carries the blockquote markers and the list indent that put the
  // formula where it is, so the fence lines it gets need it too.
  const lines = span.content
    .split("\n")
    .map((line) =>
      (line.startsWith(prefix) ? line.slice(prefix.length) : line.trimStart()).trimEnd(),
    );
  while (lines.length > 0 && !lines[0]) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();

  // The opening fence needs none of it: the prefix it sits behind was copied
  // out before this span was reached.
  const body = lines.map((line) => prefix + line);
  return ["$$", ...body, `${prefix}$$`].join("\n");
}

/**
 * A span between a fixed pair of delimiters.
 *
 * A blank line is only allowed when the opening delimiter ends its line, which
 * is how the rows of an aligned environment get to keep the blank lines between
 * them: laid out that way the span is a block, and a block runs to its closing
 * delimiter the same way a code fence does. Written inline it is a paragraph
 * instead, where a blank line means the delimiter was never closed at all.
 *
 * A dollar inside `\(…\)` refuses the rewrite: dollars mean nothing to TeX, so a
 * span that has one cannot be honestly re-delimited with them.
 */
function delimited(
  source: string,
  start: number,
  open: string,
  close: string,
  display: boolean,
): MathSpan | null {
  const from = start + open.length;
  const closeAt = source.indexOf(close, from);
  if (closeAt === -1) return null;
  const content = source.slice(from, closeAt);
  if (!content.trim()) return null;
  const block = BLANK.test(lineAt(source, from));
  if (!block && BLANK_LINE.test(content)) return null;
  if (open !== "$$" && content.includes("$")) return null;
  return { start, end: closeAt + close.length, content, display };
}

/**
 * A single-dollar span, under Pandoc's rule: the opening dollar is followed by
 * something other than whitespace, the closing one is preceded by something
 * other than whitespace and is not the start of another amount. That is what
 * tells `$x + y$` from "between $5 and $10".
 */
function dollarText(source: string, start: number): MathSpan | null {
  const from = start + 1;
  const first = source[from];
  if (first === undefined || /\s/.test(first)) return null;

  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    // `\$` is a literal dollar to TeX, so it belongs to the content.
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      if (BLANK.test(lineAt(source, index + 1))) return null;
      continue;
    }
    if (char !== "$") continue;

    const content = source.slice(from, index);
    // Math never contains a bare dollar, so a candidate that fails here is not
    // a closing delimiter and there is no later one either.
    if (/\s$/.test(content)) return null;
    if (/\d/.test(source[index + 1] ?? "")) return null;
    return { start, end: index + 1, content, display: false };
  }
  return null;
}

/** The line prefix `index` sits behind, or null if prose comes first. */
function blockPrefix(source: string, index: number): string | null {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const prefix = source.slice(start, index);
  return BLOCK_PREFIX.test(prefix) ? prefix : null;
}

/**
 * Index just past the code block that starts at `start`, or null if none does.
 * Whatever is in one is text to markdown and math to nobody.
 */
function codeBlockEnd(source: string, start: number): number | null {
  const line = lineAt(source, start);

  const fence = FENCE.exec(line);
  if (fence) {
    let index = nextLine(source, start);
    while (index < source.length) {
      const current = lineAt(source, index);
      index = nextLine(source, index);
      if (closesFence(current, fence[1])) break;
    }
    return index;
  }

  // An indented block only opens after a blank line. The same indent elsewhere
  // continues a paragraph, where a dollar may well be opening math.
  if (!INDENTED_CODE.test(line) || !afterBlankLine(source, start)) return null;
  let index = start;
  let end = start;
  while (index < source.length) {
    const current = lineAt(source, index);
    if (!INDENTED_CODE.test(current) && !BLANK.test(current)) break;
    index = nextLine(source, index);
    // Trailing blank lines belong to whatever follows the block.
    if (!BLANK.test(current)) end = index;
  }
  return end;
}

/** Whether the line before the one starting at `start` is blank or absent. */
function afterBlankLine(source: string, start: number): boolean {
  if (start === 0) return true;
  const previous = source.lastIndexOf("\n", start - 2) + 1;
  return BLANK.test(source.slice(previous, start - 1));
}

/**
 * Index just past the inline code span starting at `start`. A run of backticks
 * is closed by a run of exactly the same length; one that is never closed is
 * literal, so only the backticks themselves are consumed.
 */
function codeSpanEnd(source: string, start: number): number {
  let size = 0;
  while (source[start + size] === "`") size += 1;
  const run = "`".repeat(size);

  let from = start + size;
  for (;;) {
    const at = source.indexOf(run, from);
    if (at === -1) return start + size;
    let after = at + size;
    if (source[after] !== "`") return after;
    // A longer run does not close a shorter one; keep looking past it.
    while (source[after] === "`") after += 1;
    from = after;
  }
}
