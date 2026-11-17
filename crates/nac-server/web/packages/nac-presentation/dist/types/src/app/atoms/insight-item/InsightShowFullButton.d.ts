import type React from "react";
interface InsightShowFullButtonProps {
    /** Reads "Hide" while the full content shows. */
    expanded: boolean;
    /** Spins in place of the chevron and ignores clicks. */
    loading?: boolean;
    /** Id of the element whose content the link swaps. */
    controls?: string;
    onClick?: () => void;
}
/**
 * The "Show full" and "Hide" link of the Insights items. It is one button
 * through every state, so focus stays on it while the content loads; it is
 * disabled with `aria-disabled` for that reason. It keeps its own width in a
 * stretching column.
 */
declare const InsightShowFullButton: React.FC<InsightShowFullButtonProps>;
export default InsightShowFullButton;
