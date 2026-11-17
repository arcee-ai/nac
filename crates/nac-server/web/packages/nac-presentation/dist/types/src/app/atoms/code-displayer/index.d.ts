import type React from "react";
import { type CodeToken } from "../../lib/highlight";
/** The diff's own line vocabulary, as `WorkspaceDiffLine.kind` spells it. */
export type CodeDisplayerLineKind = "insert" | "delete" | "context";
export interface CodeDisplayerLine {
    /** Left out, the line is context. */
    kind?: CodeDisplayerLineKind;
    /** The gutter's number; a deleted line usually keeps its old one. Left out, the gutter is blank. */
    number?: number | null;
    /** The line's text, drawn plain when there are no tokens. */
    content: string;
    /** The same text split into syntax colours, e.g. one line of `highlightDiff`. */
    tokens?: CodeToken[] | null;
    /** Drawn after the code, e.g. a "No newline at end of file" note. */
    trailing?: React.ReactNode;
}
interface CodeDisplayerProps {
    /** Names the diff for assistive technology, e.g. "Changes to index.tsx". */
    "aria-label": string;
    /** Runs of adjacent lines; a muted … row stands between two runs. */
    hunks: CodeDisplayerLine[][];
    className?: string;
}
/**
 * A diff with line numbers, as the Create and Edit Insights items draw it
 * under their file button. An inserted line sits on the success tint and a
 * deleted one on the error tint, each behind a 2px rule of its tone; a context
 * line keeps a clear rule so every line's code starts at the same place. Long
 * lines wrap instead of scrolling sideways. The caller passes the hunks, with
 * tokens when it wants syntax colours.
 *
 * It is a named group rather than a region: a transcript can show many diffs,
 * and each would otherwise become a landmark.
 */
declare const CodeDisplayer: React.FC<CodeDisplayerProps>;
export default CodeDisplayer;
