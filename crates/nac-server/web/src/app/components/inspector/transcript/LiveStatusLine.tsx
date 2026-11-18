import { memo, useEffect, useState } from "react";

import { formatElapsed } from "./foldLayout";

/** Ticks once a second, and only itself: nothing around it re-renders. */
export const ElapsedClock = memo(function ElapsedClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span aria-hidden className="shrink-0 type-meta tabular text-basic-muted">
      {formatElapsed(now - since)}
    </span>
  );
});

/**
 * The one line a running turn ends with: what it is doing right now, in a
 * shimmer, and how long the run has taken. It always takes the same height,
 * which the turn's actions take over once it ends, so nothing below it moves
 * when it comes or goes.
 */
export const LiveStatusLine = memo(function LiveStatusLine({
  label,
  since,
}: {
  label: string;
  /** Wall-clock start of the run, when known. */
  since: number | null;
}) {
  return (
    <div className="flex h-8 w-full min-w-0 items-center gap-3 max-md:h-11">
      <p role="status" className="!my-0 min-w-0 truncate type-body-chrome">
        <span className="focus-shimmer">{label}</span>
      </p>
      {since != null && since > 0 ? <ElapsedClock since={since} /> : null}
    </div>
  );
});
