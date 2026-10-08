interface MarkdownProps {
    children: string;
    /** Fade newly painted prose while the turn is still streaming. */
    streaming?: boolean;
    className?: string;
}
/** Markdown block used by transcript messages and thread episodes. */
export declare function Markdown({ children, streaming, className }: MarkdownProps): import("react").JSX.Element;
export {};
