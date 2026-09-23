import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { ChatSessionButton } from "@/app/atoms";
import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { GroupLabel } from "@/app/components/projects/GroupLabel";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun } from "@/app/lib/format";
import { buildSessionNavigation, isSessionUnread } from "@/app/lib/sessionNavigation";
import { routes } from "@/app/lib/routes";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { trackAttention, useAttention } from "@/app/store/attentionStore";
import {
  markSessionViewed,
  toggleSessionNavigationPin,
  useSessionNavigationPins,
  useSessionViewedAt,
} from "@/app/store/sessionNavigationStore";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

function SessionCollectionRow({
  entry,
  projectLabel,
  active,
  pinned,
}: {
  entry: ManagedSessionSummary;
  projectLabel?: string;
  active: boolean;
  pinned: boolean;
}) {
  const navigate = useNavigate();
  const actions = useSessionActions();
  const sessionTitle = useSessionTitle();
  const isMobile = useIsMobile();
  const attention = useAttention(entry.summary.session_id);
  const viewedAt = useSessionViewedAt(entry.summary.session_id);
  const title = sessionTitle(entry.summary);
  const running = isActiveRun(entry.active_run);
  const unread = isSessionUnread(entry.summary.updated_at, viewedAt);
  const status = entry.summary.model_config_error
    ? "Needs attention"
    : running
      ? "Running"
      : attention
        ? "Run finished"
        : unread
          ? "Updated"
          : projectLabel;
  const accessibleState = [status, unread ? "updated since last viewed" : null]
    .filter(Boolean)
    .join(", ");

  return (
    <ChatSessionButton
      title={title}
      active={active}
      running={running}
      unread={unread}
      forkedFromTitle={entry.summary.forked_from?.title}
      badge={status ?? undefined}
      badgeLabel={status ?? undefined}
      isMobile={isMobile}
      aria-label={`${title}${accessibleState ? `, ${accessibleState}` : ""}`}
      onClick={() => {
        markSessionViewed(entry.summary.session_id, entry.summary.updated_at);
        navigate(routes.session(entry.summary.session_id));
      }}
      actions={
        <ChatSessionActions
          title={title}
          pinned={pinned}
          onPin={() => toggleSessionNavigationPin(entry.summary.session_id)}
          onRename={() => actions.rename(entry.summary)}
          onDelete={() => actions.remove(entry.summary)}
        />
      }
    />
  );
}

/**
 * The authoritative global parent-session collection. It is navigation only:
 * ownership and server presentation remain untouched by pins or viewed marks.
 */
export function SessionCollection({
  sessions,
  projects,
  activeSessionId,
}: {
  sessions: ManagedSessionSummary[];
  projects: ProjectRecord[];
  activeSessionId: string;
}) {
  const pinnedIds = useSessionNavigationPins();
  const model = useMemo(
    () => buildSessionNavigation(projects, sessions, pinnedIds),
    [projects, sessions, pinnedIds],
  );

  useEffect(() => {
    trackAttention(sessions, activeSessionId);
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const current = sessions.find(
      (entry) => entry.lineage == null && entry.summary.session_id === activeSessionId,
    );
    if (current) markSessionViewed(activeSessionId, current.summary.updated_at);
  }, [sessions, activeSessionId]);

  return (
    <nav aria-label="All sessions" className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      <section aria-labelledby="pinned-sessions-heading" className="flex flex-col gap-1 pb-4">
        <div id="pinned-sessions-heading">
          <GroupLabel>Pinned</GroupLabel>
        </div>
        {model.pinned.length > 0 ? (
          model.pinned.map(({ session, projectLabel }) => (
            <SessionCollectionRow
              key={session.summary.session_id}
              entry={session}
              projectLabel={projectLabel}
              active={session.summary.session_id === activeSessionId}
              pinned
            />
          ))
        ) : (
          <p className="px-2 py-1 label-micro text-basic-muted">No pinned sessions</p>
        )}
      </section>

      <div className="flex flex-col gap-4">
        {model.groups.map((group) => (
          <section key={group.key} aria-labelledby={`session-group-${group.key}`}>
            <div id={`session-group-${group.key}`} className="mb-1">
              <GroupLabel>{group.label}</GroupLabel>
            </div>
            <div className="flex flex-col gap-1">
              {group.sessions.map((entry) => (
                <SessionCollectionRow
                  key={entry.summary.session_id}
                  entry={entry}
                  active={entry.summary.session_id === activeSessionId}
                  pinned={false}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {model.pinned.length === 0 && model.groups.length === 0 ? (
        <p className="px-2 py-4 text-small text-basic-muted">No parent sessions yet</p>
      ) : null}
    </nav>
  );
}
