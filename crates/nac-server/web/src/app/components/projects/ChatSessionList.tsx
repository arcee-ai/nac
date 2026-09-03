import { useMemo } from "react";

import { ChatSessionButton, Icon, IconName } from "@/app/atoms";
import { GroupLabel } from "@/app/components/projects/GroupLabel";
import { useNow } from "@/app/hooks/useNow";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { isActiveRun } from "@/app/lib/format";
import { groupByRecency } from "@/app/lib/projects";
import {
  sessionBehaviorPresentation,
  sessionOriginFromRecord,
  sessionTypeFromBehavior,
} from "@/app/lib/sessionBehavior";
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
                  sessionType={sessionTypeFromBehavior(entry.summary.behavior)}
                  origin={sessionOriginFromRecord(
                    entry.lineage,
                    entry.summary.forked_from,
                    entry.summary.converted_from,
                  )}
                  badgeLabel={behavior.label}
                  active={entry.summary.session_id === activeSessionId}
                  running={isActiveRun(entry.active_run)}
                  isMobile={isMobile}
                  onClick={() => onOpen(entry)}
                  actions={
                    onPin || onRename || onDelete ? (
                      <>
                        {onPin ? (
                          <ChatRowAction
                            isMobile={isMobile}
                            title={entry.summary.pinned ? "Unpin chat" : "Pin chat"}
                            ariaLabel={`${entry.summary.pinned ? "Unpin" : "Pin"} ${title}`}
                            iconName={entry.summary.pinned ? IconName.Unpin : IconName.Pin}
                            onClick={() => onPin(entry)}
                          />
                        ) : null}
                        {onRename ? (
                          <ChatRowAction
                            isMobile={isMobile}
                            title="Rename chat"
                            ariaLabel={`Rename ${title}`}
                            iconName={IconName.Edit}
                            onClick={() => onRename(entry)}
                          />
                        ) : null}
                        {onDelete ? (
                          <ChatRowAction
                            isMobile={isMobile}
                            title="Delete chat"
                            ariaLabel={`Delete ${title}`}
                            iconName={IconName.Trash}
                            destructive
                            onClick={() => onDelete(entry)}
                          />
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

/** Figma ChatSessionButton actions: 16px desktop, 20px mobile, no Button chrome. */
function ChatRowAction({
  isMobile,
  title,
  ariaLabel,
  iconName,
  destructive = false,
  onClick,
}: {
  isMobile: boolean;
  title: string;
  ariaLabel: string;
  iconName: IconName;
  destructive?: boolean;
  onClick: () => void;
}) {
  const size = isMobile ? 20 : 16;
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[8px]",
        isMobile ? "size-5" : "size-4",
        destructive ? "text-btn-destructive" : "text-btn-secondary",
      )}
      onClick={onClick}
    >
      <Icon iconName={iconName} size={size} />
    </button>
  );
}
