import { useEffect } from "react";
import { Link } from "react-router-dom";

import { Badge, BadgeColor, BoxSurface, Loader, SessionAvatar } from "@/app/atoms";
import {
  displaySessionTitle,
  isActiveRun,
  sessionEnvLabel,
  sessionIdShort,
} from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { useSessions } from "@/app/services/queries";
import { trackAttention, useAttention } from "@/app/store/attentionStore";
import { useVisibleSessions } from "@/app/store/sessionFiltersStore";
import type { ManagedSessionSummary } from "@/app/types/api";

/**
 * Placeholder board. The real card grid, filters and launch flow arrive with
 * the app shell; this exists so the data layer can be exercised end to end.
 */
export default function SessionsListPage() {
  const { data, isLoading, error } = useSessions();
  const sessions = useVisibleSessions(data ?? []);

  useEffect(() => {
    if (data) trackAttention(data, null);
  }, [data]);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-3 text-basic-muted">
        <Loader />
        Loading sessions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-error-primary paragraph-medium">
        {error instanceof Error ? error.message : "Failed to load sessions"}
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-[900px]">
      <h1 className="header-medium text-basic-primary">
        Sessions ({sessions.length})
      </h1>
      <BoxSurface title="All sessions">
        <div className="flex flex-col [&>*]:shrink-0">
          {sessions.map((entry) => (
            <SessionRow key={entry.summary.session_id} entry={entry} />
          ))}
          {sessions.length === 0 && (
            <div className="p-4 text-basic-muted paragraph-medium">
              No sessions yet.
            </div>
          )}
        </div>
      </BoxSurface>
    </div>
  );
}

function SessionRow({ entry }: { entry: ManagedSessionSummary }) {
  const { summary } = entry;
  const running = isActiveRun(entry.active_run);
  const needsAttention = useAttention(summary.session_id);

  return (
    <Link
      to={routes.session(summary.session_id)}
      className="flex items-center gap-3 px-4 py-3 border-b border-secondary last:border-b-0 hover:bg-elevation-level-1"
    >
      <SessionAvatar id={summary.session_id} size={32} />
      <div className="flex flex-col min-w-0">
        <span className="label-small text-basic-primary truncate">
          {displaySessionTitle(summary)}
        </span>
        <span className="code code-small text-basic-muted truncate">
          {sessionIdShort(summary.session_id)} · {summary.cwd}
        </span>
      </div>
      <div className="flex-1" />
      {needsAttention && (
        <span className="size-2 rounded-full bg-info-primary" aria-hidden />
      )}
      <Badge text={sessionEnvLabel(summary)} color={BadgeColor.Gray} />
      <Badge
        text={running ? "Running" : "Idle"}
        color={running ? BadgeColor.Green : BadgeColor.Neutral}
      />
    </Link>
  );
}
