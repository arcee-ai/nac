import React from "react";
export declare enum CodeBlockSize {
    Small = "code-small",
    Medium = "code-medium",
    Large = "code-large"
}
interface CodeBlockProps {
    code: string;
    /** Shiki language id or alias. Unknown values just render as plain text. */
    language?: string;
    size?: CodeBlockSize;
    title?: React.ReactNode;
    lineNumbers?: boolean;
    /** Wrap long lines instead of scrolling the block sideways. */
    wrap?: boolean;
    copyable?: boolean;
    /** Adds a button that reopens the same block in a full-screen dialog. */
    expandable?: boolean;
    maxHeight?: string;
    className?: string;
}
/**
 * Read-only code viewer with optional chrome. Colouring reuses the Shiki
 * pass behind the diff viewer, so no second highlighter enters the bundle, and
 * the plain text is shown until (or unless) the tokens arrive.
 */
declare const CodeBlock: React.FC<CodeBlockProps> & {
    Size: typeof CodeBlockSize;
};
export default CodeBlock;
