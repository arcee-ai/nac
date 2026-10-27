/**
 * What git says about a path, named the way the design names its states. Each
 * value is the letter `git status --porcelain` reports for it.
 */
export declare enum GitStatus {
    Changed = "M",
    Added = "A",
    Deleted = "D",
    ChangedName = "R",
    Copied = "C",
    ChangedType = "T",
    Conflict = "U",
    NotTracked = "?",
    Ignored = "!"
}
interface GitStatusTone {
    /** Spelled out, as the letter's hover text. */
    title: string;
    /** The colour of the name the status belongs to. */
    name: string;
    /** The same colour as a fill, for a glyph that sits beside the name. */
    fill: string;
    /** The letter's own colour; paths git leaves alone dim it below the name. */
    letter: string;
}
export declare const GIT_STATUS_TONE: Record<GitStatus, GitStatusTone>;
/**
 * The status behind a porcelain code. The server trims it to one letter; a
 * code this list does not know still means the path differs from HEAD, so it
 * reads as changed rather than as clean.
 */
export declare function gitStatusOf(code: string | null | undefined): GitStatus | null;
/**
 * The status letter at the end of a file row. The row's name already speaks
 * for the file, so the letter stays out of the accessible name and explains
 * itself on hover instead.
 */
export default function GitStatusLabel({ status, className, }: {
    status: GitStatus;
    className?: string;
}): import("react").JSX.Element;
export {};
