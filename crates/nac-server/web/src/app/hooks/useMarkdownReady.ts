import { useEffect, useState } from "react";

import { loadMarkdownRenderer, markdownRendererArrived } from "@/app/lib/markdownChunk";

/**
 * Whether markdown can be painted as prose, and a request for the chunk that
 * makes it so while it cannot.
 *
 * True from the first render once the chunk is in memory, so the second session
 * a user opens is not held back for a load that already happened. A chunk that
 * fails to arrive also reads as ready: the fallback source is then the best
 * paint there will be, and waiting longer only keeps it hidden.
 */
export function useMarkdownReady(): boolean {
  const [ready, setReady] = useState(markdownRendererArrived);

  useEffect(() => {
    if (ready) return undefined;
    let live = true;
    void loadMarkdownRenderer().finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);

  return ready;
}
