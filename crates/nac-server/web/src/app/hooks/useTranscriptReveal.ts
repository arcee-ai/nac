import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";

import { inFlight } from "@/app/effect/remote";
import { useMarkdownReady } from "@/app/hooks/useMarkdownReady";
import { atomIds } from "@/app/services/queries/keys";

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
 * A conversation arrives in pieces — the snapshot, the chunk that turns its text
 * into prose, then a read per turn for the files that turn's run wrote — and
 * every piece lands in its own paint. Revealing on the first of them shows the
 * messages as raw source, without their snapshots, and then rewrites them in
 * place; this holds the whole thing back until there is nothing left to add.
 *
 * One-way per session: a refetch later in the session is an update to a
 * transcript that is already on screen, and hiding it again for that would be a
 * flicker rather than a load.
 *
 * None of it applies to a conversation that is already in hand. Switching
 * between chats a few times would otherwise mean waiting behind the same rows
 * over and over for a transcript the cache could have drawn at once.
 */
export function useTranscriptReveal(
  sessionId: string,
  /** False while there is nothing to reveal yet, e.g. before the snapshot. */
  hasContent: boolean,
): boolean {
  const markdownReady = useMarkdownReady();
  // Everything a session reads lives under its atom id, the per-turn snapshot
  // changes included, so this covers the reads that only start once the
  // messages are in the tree without having to name them one by one.
  const fetching = useAtomValue(inFlight(atomIds.session(sessionId)));
  // Held as the session it belongs to, so switching sessions closes the gate in
  // the same render as the switch rather than a paint later.
  const [shown, setShown] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const cached = useRef(false);
  const revealed = shown === sessionId;

  useEffect(() => {
    // Whether the chat was already in hand the moment it was opened, which is
    // what tells apart a load from a return to somewhere the user has been.
    if (opened.current !== sessionId) {
      opened.current = sessionId;
      cached.current = hasContent;
    }
    if (revealed || !hasContent || !markdownReady) return undefined;
    // A cached chat waits for nothing — what is being refetched around it only
    // updates a conversation that is already drawn — and least of all for a
    // frame it would spend blank.
    if (cached.current) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setShown(sessionId);
      });
      return () => {
        cancelled = true;
      };
    }
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
