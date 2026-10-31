import type React from "react";
import { IconName } from "../icon";
interface ToolsAndReasoningBadgeProps {
    /** "Total activity: 12.3s" once done, or the live step, e.g. "Reading index.tsx…". */
    label: string;
    /** Leads with a ModelLoader. A finished group trails a chevron instead. */
    inProgress: boolean;
    /** The group is open in Insights. It says nothing about the group running. */
    selected?: boolean;
    /** Image in the round plate after the label, such as a site's favicon. */
    avatarUrl?: string | null;
    /** Glyph in the same plate when there is no `avatarUrl`. */
    leadingIcon?: IconName;
    disabled?: boolean;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    /** Id of the Insights panel the badge opens. */
    controls?: string;
    className?: string;
}
/**
 * Stands in the transcript for one group of reasoning and tool calls. While
 * the group runs it shows the live step after a ModelLoader; once done it
 * shows how long the work took, and a chevron into Insights fades in on hover
 * or keyboard focus. The chevron keeps its place at rest, so nothing shifts.
 *
 * The live label changes on every step, so the badge is deliberately not a
 * live region.
 */
declare const ToolsAndReasoningBadge: React.FC<ToolsAndReasoningBadgeProps>;
export default ToolsAndReasoningBadge;
