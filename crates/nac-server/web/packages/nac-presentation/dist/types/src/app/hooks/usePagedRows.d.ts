/**
 * Lets a long list be drawn a stretch at a time, growing as the reader nears
 * the end of what is on screen.
 *
 * Everything is already in hand — this is about what the browser is asked to
 * lay out, not about what has been fetched — so growing costs a slice and
 * needs no loader: rows appear as if they had always been below the fold.
 *
 * The list starts over whenever `key` names something else, e.g. another
 * session, because a stretch measured out for one list says nothing about the
 * next.
 */
export declare function usePagedRows<T>(rows: readonly T[], { key, step,
/** Rows that must be drawn whatever the reader has scrolled to, e.g. up to
 *  a selected one reached from elsewhere. */
atLeast, }: {
    key: string;
    step?: number;
    atLeast?: number;
}): {
    visible: readonly T[];
    hasMore: boolean;
    /** Put on an element after the last row; only rendered while `hasMore`. */
    sentinelRef: import("react").Dispatch<import("react").SetStateAction<HTMLElement | null>>;
};
