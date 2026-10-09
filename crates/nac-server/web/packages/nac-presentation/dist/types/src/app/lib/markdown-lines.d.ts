/** Opening or closing fence: up to three spaces, then three or more ` or ~. */
export declare const FENCE: RegExp;
export declare const LIST_ITEM: RegExp;
export declare const INDENTED_CODE: RegExp;
export declare const BLANK: RegExp;
/**
 * A `$$` that opens display math, as micromark reads it: alone on its line bar
 * the indent, because a dollar anywhere in the info string rejects the fence.
 * `$$x$$` is therefore inline math rather than a one-line block.
 */
export declare const MATH_FENCE: RegExp;
/** Its closing line: the sequence again, then nothing but trailing space. */
export declare const CLOSING_MATH_FENCE: RegExp;
/** Whether `line` closes the fenced block that `opener` started. */
export declare function closesFence(line: string, opener: string): boolean;
/** The line that `index` is the start of, without its line ending. */
export declare function lineAt(source: string, index: number): string;
/** Index just past the line `index` is on, line ending included. */
export declare function nextLine(source: string, index: number): number;
