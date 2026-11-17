import type React from "react";
export declare enum CodeChangesBadgeSize {
    Small = "small",
    Medium = "medium",
    Large = "large"
}
interface CodeChangesBadgeProps {
    /** Lines added. Left out, the badge drops the green count. */
    additions?: number | null;
    /** Lines removed. Left out, the badge drops the red count. */
    deletions?: number | null;
    size?: CodeChangesBadgeSize;
    className?: string;
}
/** The counts as a screen reader says them, e.g. "279 additions, 84 deletions". */
export declare function codeChangesLabel(additions?: number | null, deletions?: number | null): string;
/**
 * How many lines a change added and removed: `+additions` in the success
 * tone, `-deletions` in the error tone. Either count may be left out; with
 * neither the badge renders nothing. The signed numbers are for sight only,
 * assistive technology reads the counts spelled out.
 */
declare const CodeChangesBadge: React.FC<CodeChangesBadgeProps>;
export default CodeChangesBadge;
