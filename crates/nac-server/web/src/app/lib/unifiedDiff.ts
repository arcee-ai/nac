import type { WorkspaceDiffLine } from "@/app/types/api";

/** A row of a parsed diff, shaped like the Files panel's diff lines. */
export interface UnifiedDiffLine extends WorkspaceDiffLine {
  kind: "insert" | "delete" | "context";
}

export interface UnifiedDiffHunk {
  lines: UnifiedDiffLine[];
}

export interface UnifiedDiff {
  hunks: UnifiedDiffHunk[];
  additions: number;
  deletions: number;
}

/** A count left out of a range is 1, e.g. `@@ -5 +5 @@`. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

const line = (
  kind: UnifiedDiffLine["kind"],
  content: string,
  oldLineno: number | null,
  newLineno: number | null,
): UnifiedDiffLine => ({
  kind,
  content,
  old_lineno: oldLineno,
  new_lineno: newLineno,
  has_trailing_newline: true,
});

/**
 * One file's unified diff, numbered from its hunk headers. The rows a header
 * counts belong to its hunk, so a deleted line that starts with `--` is not
 * taken for a file header. Both writers of the mutation tools' diffs read the
 * same: diffy (local) writes a blank context line without its space, Python's
 * difflib (SSH) keeps it, and both keep a CRLF file's `\r` on every line.
 */
export function parseUnifiedDiff(text: string): UnifiedDiff {
  const diff: UnifiedDiff = { hunks: [], additions: 0, deletions: 0 };
  const rows = text.split("\n");
  if (rows.at(-1) === "") rows.pop();
  let hunk: UnifiedDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const row of rows) {
    const header = HUNK_HEADER.exec(row);
    if (header) {
      [oldLine, oldLeft, newLine, newLeft] = [header[1], header[2], header[3], header[4]].map(
        (value) => Number(value ?? 1),
      );
      hunk = { lines: [] };
      diff.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    // "\ No newline at end of file" is about the row before it.
    if (row.startsWith("\\")) {
      const last = hunk.lines.at(-1);
      if (last) last.has_trailing_newline = false;
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) continue;
    const content = row.slice(1).replace(/\r$/u, "");
    if (row.startsWith("+")) {
      hunk.lines.push(line("insert", content, null, newLine));
      newLine += 1;
      newLeft -= 1;
      diff.additions += 1;
    } else if (row.startsWith("-")) {
      hunk.lines.push(line("delete", content, oldLine, null));
      oldLine += 1;
      oldLeft -= 1;
      diff.deletions += 1;
    } else if (row === "" || row.startsWith(" ")) {
      hunk.lines.push(line("context", content, oldLine, newLine));
      oldLine += 1;
      newLine += 1;
      oldLeft -= 1;
      newLeft -= 1;
    }
  }
  diff.hunks = diff.hunks.filter((candidate) => candidate.lines.length > 0);
  return diff;
}
