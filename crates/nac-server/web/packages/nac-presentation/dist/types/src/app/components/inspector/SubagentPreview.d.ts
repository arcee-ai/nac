import { IconName } from "../../atoms";
/**
 * The subagent's own conversation, the same turns the chat transcript draws,
 * including the load shimmer and the live model pill. The parent's runtime
 * store is left alone: this view reads the child's snapshot and its own stream.
 */
export declare function SubagentPreview({ sessionId, title, fallbackText, icon, }: {
    sessionId: string;
    title: string;
    fallbackText: string | null;
    icon: IconName;
}): import("react").JSX.Element;
