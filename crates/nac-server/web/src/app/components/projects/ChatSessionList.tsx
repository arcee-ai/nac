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
import { displaySessionTitle, isActiveRun } from "@/app/lib/format";
import { groupByRecency } from "@/app/lib/projects";
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
  emptyLabel = "No chats",
}: ChatSessionListProps) {
  const now = useNow(RECENCY_TICK_MS);
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
    <div className="flex flex-col gap-1">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          {/* A single unpinned group needs no heading to tell it from anything. */}
          {groups.length > 1 ? <GroupLabel>{group.label}</GroupLabel> : null}
          {group.items.map((entry) => {
            const title = displaySessionTitle(entry.summary);
            return (
              <ChatSessionButton
                key={entry.summary.session_id}
                sessionId={entry.summary.session_id}
                title={title}
                active={entry.summary.session_id === activeSessionId}
                running={isActiveRun(entry.active_run)}
                onClick={() => onOpen(entry)}
                actions={
                  onRename || onDelete ? (
                    <>
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
      ))}
    </div>
  );
}
