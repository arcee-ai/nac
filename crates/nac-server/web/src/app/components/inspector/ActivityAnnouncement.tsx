import { useEffect, useState } from "react";

/** One coalesced announcement for cross-run activity transitions. */
export function ActivityAnnouncement({ summary }: { summary: string }) {
  const [announced, setAnnounced] = useState(summary);

  useEffect(() => {
    if (summary === announced) return;
    const timer = window.setTimeout(() => setAnnounced(summary), 500);
    return () => window.clearTimeout(timer);
  }, [summary, announced]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {announced}
    </div>
  );
}
