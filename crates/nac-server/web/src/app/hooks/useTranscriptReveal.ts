import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

import { useMarkdownReady } from "@/app/hooks/useMarkdownReady";
import { queryKeys } from "@/app/services/queries";

/**
 * How long a transcript may stay hidden. A session with a run streaming into it
 * refetches on every delta, so "nothing in flight" is a state it may never
 * reach, and a wait past this reads as a hang rather than as a load.
 */
const REVEAL_DEADLINE_MS = 1500;

/**
 * Whether the transcript is ready to be shown, as opposed to still being
 * assembled behind a loader.
 *
 * A conversation arrives in pieces: the snapshot, the chunk that turns its text
 * into prose, then a read per turn for the files that turn's run wrote, and
 * every piece lands in its own paint. Revealing on the first of them shows the
 * messages as raw source, without their snapshots, and then rewrites them in
 * place; this holds the whole thing back until there is nothing left to add.
 *
 * One-way per session: a refetch later in the session is an update to a
 * transcript that is already on screen, and hiding it again for that would be a
 * flicker rather than a load.
 *
 * A conversation already in the cache is shown in the same render as the tab
 * switch. Waiting a frame (or a microtask) would fade the transcript out and
 * flash the loader even though there is nothing to assemble.
 */
export function useTranscriptReveal(
  sessionId: string,
  /** False while there is nothing to reveal yet, e.g. before the snapshot. */
  hasContent: boolean,
): boolean {
  const markdownReady = useMarkdownReady();
  // Everything a session reads is keyed under its root, the per-turn snapshot
  // changes included, so this covers the reads that only start once the
  // messages are in the tree without having to name them one by one.
  const fetching = useIsFetching({ queryKey: queryKeys.sessionRoot(sessionId) });
  const [shown, setShown] = useState<string | null>(() =>
    hasContent ? sessionId : null,
  );
  const [openId, setOpenId] = useState(sessionId);

  // Adjust during render so a cached return never commits a hidden frame.
  // React discards that render and retries with the new state.
  if (openId !== sessionId) {
    setOpenId(sessionId);
    setShown(hasContent ? sessionId : null);
  }

  const revealed = shown === sessionId;

  useEffect(() => {
    if (revealed || !hasContent || !markdownReady) return undefined;
    if (fetching > 0) return undefined;
    // Two frames: the first paints the prose and the rows whose reads have just
    // landed, the second hands over a transcript that is already complete.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(sessionId));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [revealed, hasContent, markdownReady, fetching, sessionId]);

  useEffect(() => {
    if (revealed || !hasContent) return undefined;
    const deadline = setTimeout(() => setShown(sessionId), REVEAL_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [revealed, hasContent, sessionId]);

  return revealed;
}
