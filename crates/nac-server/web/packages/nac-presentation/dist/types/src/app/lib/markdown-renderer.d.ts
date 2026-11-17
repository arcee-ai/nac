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
 * canonical reading of the text and cheap now that it is parsed once. A message
 * that streamed in this view stays in blocks once it settles: switching would
 * remount every paragraph and code block the moment the stream ends, and the
 * code would repaint plain before it is highlighted again. One that may define
 * a link reference or a footnote switches all the same, as only the whole
 * document resolves those.
 */
declare const MarkdownRenderer: import("react").MemoExoticComponent<({ children, streaming, }: MarkdownRendererProps) => import("react").JSX.Element>;
export default MarkdownRenderer;
