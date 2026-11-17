export interface NormalizedMath {
    /** The source with every math span written the way remark-math reads it. */
    source: string;
    /**
     * Whether any math was found at all — what decides whether MathJax is loaded
     * for this text, which is the whole reason the flag is reported.
     */
    hasMath: boolean;
}
/**
 * Normalize the math in one markdown source, and say whether it has any.
 *
 * Anything that does not parse as a span is left as prose, which is what makes
 * a half-arrived stream readable: the delimiters of an unfinished formula show
 * as themselves until the closing one lands, rather than flashing broken math.
 */
export declare function normalizeMath(source: string): NormalizedMath;
