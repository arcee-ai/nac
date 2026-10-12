/**
 * Cut markdown at the blank lines that CommonMark treats as hard boundaries.
 *
 * A stream only ever appends, so every block but the last is final and can be
 * parsed once and memoized; that is what turns re-rendering a growing message
 * from quadratic into linear. Ambiguity is always resolved by *not* splitting —
 * an over-long block only costs a little work, whereas a wrong cut would change
 * what the text means.
 *
 * The one thing a caller gives up is document-wide context: a link reference
 * definition is only visible to the block it sits in. Finished messages are
 * rendered whole precisely so the archived transcript keeps that.
 */
export declare function splitMarkdownBlocks(source: string): string[];
