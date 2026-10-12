import type { WorkspaceDiffLine, WorkspaceDiffSection } from "../types/api";
export interface CodeToken {
    text: string;
    /** CSS color, typically a `var(--color-…)` from the nac theme. */
    color: string | null;
    italic?: boolean;
    bold?: boolean;
}
export interface CodeTokenStyle {
    color?: string;
    fontStyle?: "italic";
    fontWeight?: 600;
}
/** Inline style for a highlighted span. */
export declare function tokenStyle(token: CodeToken): CodeTokenStyle;
/** Shiki language id for a path, or null when we should not guess. */
export declare function languageFromPath(path: string): string | null;
/**
 * Tokens per line for a snippet whose language is already known, for callers
 * that have a language name rather than a path.
 */
export declare function highlightSource(language: string, text: string): Promise<CodeToken[][] | null>;
/**
 * Tokens per line for a whole file. Unlike a diff this is a real document, so
 * the tokenizer sees everything it needs and only an unknown language turns
 * the colours off.
 */
export declare function highlightCode(path: string, text: string): Promise<CodeToken[][] | null>;
/**
 * Highlight every hunk of a file diff. Keyed by line object, so a caller can
 * look each rendered row up and fall back to plain text when it is missing.
 */
export declare function highlightDiff(path: string, sections: WorkspaceDiffSection[]): Promise<Map<WorkspaceDiffLine, CodeToken[]>>;
