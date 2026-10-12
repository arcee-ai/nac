interface MarkdownRendererProps {
    children: string;
    /** Fade newly painted prose while the turn is still streaming. */
    streaming?: boolean;
}
/**
 * Heavy half of the markdown support: the parser plus the syntax highlighter.
 * Always reach it through `lib/markdown`, which loads this chunk on demand.
 *
 * A live message is parsed block by block so a delta only costs the block it
 * landed in; a finished one is parsed as a single document, which is both the
 * canonical reading of the text and cheap now that it is parsed once.
 */
declare const MarkdownRenderer: import("react").MemoExoticComponent<({ children, streaming, }: MarkdownRendererProps) => import("react").JSX.Element>;
export default MarkdownRenderer;
