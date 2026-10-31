/**
 * Binds what a person selected in a rendered reply to the exact range of the
 * stored message text the server validates: Unicode scalar offsets plus the
 * SHA-256 of the complete text. The server re-checks both; this only finds
 * the range the person meant.
 */
/** Must match the server's documented excerpt bound. */
export declare const MAX_EXCERPT_CHARS = 4000;
export declare const MAX_QUESTION_CHARS = 2000;
export interface SelectionBinding {
    /** Unicode scalar offsets into the stored message text. */
    start: number;
    end: number;
    excerpt: string;
}
/**
 * Map rendered selected text onto the stored text. Whitespace runs compare as
 * one space and Markdown markup in the source may be skipped; every other
 * character must match exactly. `hint` (0..1) prefers the occurrence nearest
 * to where the selection sat in the rendered block. Null when the selection
 * does not map, for example across a link target or a rendered formula.
 */
export declare function bindSelection(sourceText: string, renderedSelection: string, hint?: number): SelectionBinding | null;
/**
 * SHA-256 of the UTF-8 text, as lowercase hex. Pure so it also works where
 * `crypto.subtle` is unavailable (plain-HTTP hosts that are not localhost).
 */
export declare function sha256Hex(text: string): string;
