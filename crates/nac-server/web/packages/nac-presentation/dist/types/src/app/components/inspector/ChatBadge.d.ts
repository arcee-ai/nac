import { type ReactNode } from "react";
interface ChatBadgeProps {
    label: string;
    /** Shimmers the label while the step the badge stands for is still running. */
    pending?: boolean;
    /** Highlighted when the matching side-panel tab is selected (e.g. a workset). */
    active?: boolean;
    /** Rendered after the label, e.g. the diff counts of a snapshot. */
    trailing?: ReactNode;
    /**
     * Rendered above the label, inside the same rule, e.g. the files a snapshot
     * touched. Unlike `body` it is always visible and is not a disclosure.
     */
    preface?: ReactNode;
    /** When given, the badge becomes a disclosure for this body. */
    body?: string;
    onClick?: () => void;
}
/**
 * The inline marker the model message uses for its non-prose steps: reasoning,
 * a saved workset, a snapshot. Only reasoning has a body to expand.
 */
export declare function ChatBadge({ label, pending, active, trailing, preface, body, onClick, }: ChatBadgeProps): import("react").JSX.Element;
/** The `+n -m` pair the snapshot badge carries. */
export declare function CodeChangesBadge({ additions, deletions, }: {
    additions: number;
    deletions: number;
}): import("react").JSX.Element;
export {};
