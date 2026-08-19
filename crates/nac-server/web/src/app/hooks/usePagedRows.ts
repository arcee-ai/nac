import { useCallback, useEffect, useState } from "react";

/**
 * Rows handed over at a time. Enough that reaching the end is a deliberate
 * scroll rather than something that happens while reading the first screen.
 */
const STEP = 50;

/** Grow before the reader arrives, so the list never appears to end early. */
const LOOKAHEAD = "200px";

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
export function usePagedRows<T>(
  rows: readonly T[],
  {
    key,
    step = STEP,
    /** Rows that must be drawn whatever the reader has scrolled to, e.g. up to
     *  a selected one reached from elsewhere. */
    atLeast = 0,
  }: { key: string; step?: number; atLeast?: number },
) {
  const [grown, setGrown] = useState({ key, count: step });
  const count = Math.max(grown.key === key ? grown.count : step, atLeast);
  const hasMore = rows.length > count;
  // The end marker is held in state rather than a ref because the list it sits
  // in comes and goes with the layout — the panel keeps its list column shut on
  // a narrow window — and a ref filled in later would leave the observer
  // watching nothing until something else happened to disturb it.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);

  const grow = useCallback(() => {
    setGrown((previous) => ({
      key,
      count: Math.max(previous.key === key ? previous.count : step, atLeast) + step,
    }));
  }, [key, step, atLeast]);

  // Rebuilt on every growth: an observer reports crossings, and a sentinel that
  // was already in view when the list grew has nothing left to cross. Watching
  // it afresh reads the position it is in now, which is what keeps a list
  // shorter than its container filling up instead of stalling one step in.
  useEffect(() => {
    if (!sentinel || !hasMore) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) grow();
      },
      { rootMargin: LOOKAHEAD },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasMore, grow, count]);

  return {
    visible: hasMore ? rows.slice(0, count) : rows,
    hasMore,
    /** Put on an element after the last row; only rendered while `hasMore`. */
    sentinelRef: setSentinel,
  };
}
