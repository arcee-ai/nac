import { useMemo } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionButton,
  Icon,
  IconName,
} from "@/app/atoms";
import { GroupLabel } from "@/app/components/projects/GroupLabel";
import { useNow } from "@/app/hooks/useNow";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun } from "@/app/lib/format";
import { groupByRecency } from "@/app/lib/projects";
import { sessionBehaviorPresentation } from "@/app/lib/sessionBehavior";
import type { ManagedSessionSummary } from "@/app/types/api";

/** Date buckets only shift once a day, so a minute of resolution is plenty. */
const RECENCY_TICK_MS = 60_000;

interface ChatSessionListProps {
  sessions: ManagedSessionSummary[];
  /** The session currently open, marked as the active row. */
  activeSessionId?: string | null;
  onOpen: (summary: ManagedSessionSummary) => void;
  onRename?: (summary: ManagedSessionSummary) => void;
  onDelete?: (summary: ManagedSessionSummary) => void;
  onPin?: (summary: ManagedSessionSummary) => void;
  /** Taller rows and always-visible actions, matching the mobile modal. */
  isMobile?: boolean;
  emptyLabel?: string;
}

/**
 * Sessions as date-separated rows. Pinned sessions are lifted out of the date
 * buckets into their own group at the top, matching the projects list.
 */
export function ChatSessionList({
  sessions,
  activeSessionId = null,
  onOpen,
  onRename,
  onDelete,
  onPin,
  isMobile = false,
  emptyLabel = "No chats",
}: ChatSessionListProps) {
  const now = useNow(RECENCY_TICK_MS);
  const sessionTitle = useSessionTitle();
  const groups = useMemo(
    () =>
      groupByRecency(
        sessions,
        (entry) => ({
          updatedAt: entry.summary.updated_at,
          pinned: Boolean(entry.summary.pinned),
        }),
        now,
      ),
    [sessions, now],
  );

  if (sessions.length === 0) {
    return <div className="label-small text-basic-muted px-2 py-1">{emptyLabel}</div>;
  }

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <GroupLabel className="px-2">{group.label}</GroupLabel>
          <div className="flex flex-col gap-1">
            {group.items.map((entry) => {
              const title = entry.lineage?.description?.trim()
                ? entry.lineage.description
                : sessionTitle(entry.summary);
              const behavior = sessionBehaviorPresentation(entry.summary.behavior);
              return (
                <ChatSessionButton
                  key={entry.summary.session_id}
                  title={title}
                  badge={behavior.navigationLabel}
                  badgeLabel={behavior.label}
                  active={entry.summary.session_id === activeSessionId}
                  running={isActiveRun(entry.active_run)}
                  forkedFromTitle={entry.summary.forked_from?.title}
                  isMobile={isMobile}
                  onClick={() => onOpen(entry)}
                  actions={
                    onPin || onRename || onDelete ? (
                      <>
                        {onPin ? (
                          <Button
                            variant={ButtonVariant.Ghost}
                            size={ButtonSize.Small}
                            content={ButtonContent.Icon}
                            title={entry.summary.pinned ? "Unpin chat" : "Pin chat"}
                            aria-label={`${entry.summary.pinned ? "Unpin" : "Pin"} ${title}`}
                            onClick={() => onPin(entry)}
                          >
                            <Icon iconName={entry.summary.pinned ? IconName.Unpin : IconName.Pin} />
                          </Button>
                        ) : null}
                        {onRename ? (
                          <Button
                            variant={ButtonVariant.Ghost}
                            size={ButtonSize.Small}
                            content={ButtonContent.Icon}
                            title="Rename chat"
                            aria-label={`Rename ${title}`}
                            onClick={() => onRename(entry)}
                          >
                            <Icon iconName={IconName.Edit} />
                          </Button>
                        ) : null}
                        {onDelete ? (
                          <Button
                            variant={ButtonVariant.GhostDestructive}
                            size={ButtonSize.Small}
                            content={ButtonContent.Icon}
                            title="Delete chat"
                            aria-label={`Delete ${title}`}
                            onClick={() => onDelete(entry)}
                          >
                            <Icon iconName={IconName.Trash} />
                          </Button>
                        ) : null}
                      </>
                    ) : null
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
