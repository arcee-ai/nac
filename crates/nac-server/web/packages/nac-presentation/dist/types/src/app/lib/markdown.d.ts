interface MarkdownProps {
    children: string;
    /** Fade newly painted prose while the turn is still streaming. */
    streaming?: boolean;
    className?: string;
    taskReferences?: boolean;
}
/** Markdown block used by transcript messages and thread episodes. */
export declare function Markdown({ children, streaming, className, taskReferences, }: MarkdownProps): import("react").JSX.Element;
export {};
