import type { WorkspaceDiffLine } from "../types/api";
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
/**
 * One file's unified diff, numbered from its hunk headers. The rows a header
 * counts belong to its hunk, so a deleted line that starts with `--` is not
 * taken for a file header. Both writers of the mutation tools' diffs read the
 * same: diffy (local) writes a blank context line without its space, Python's
 * difflib (SSH) keeps it, and both keep a CRLF file's `\r` on every line.
 */
export declare function parseUnifiedDiff(text: string): UnifiedDiff;
