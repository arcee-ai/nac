import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionTab,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  Tooltip,
} from "@/app/atoms";
import { ChatSessionPopover } from "@/app/components/projects/ChatSessionPopover";
import { cn } from "@/app/lib/cn";
import { displaySessionTitle, isActiveRun } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import type { ManagedSessionSummary, SessionSummarySnapshot } from "@/app/types/api";

/** Below this the tabs are a modal instead; the strip needs room to be one. */
const STRIP = "flex items-end gap-1 min-w-0 border-b border-muted px-2";

/**
 * The strip above a project's transcript, listing the project's chats.
 *
 * A session that belongs to no project gets the same slot, filled with the way
 * to file it somewhere — an orphan is not a project of one, so it has no tabs
 * to show.
 */
export function ProjectSessionTabs({
  projectId,
  sessions,
  activeSessionId,
  summary,
  leading,
}: {
  /** Null when the open session belongs to no project. */
  projectId: string | null;
  /** The project's chats, newest first; empty for an orphan. */
  sessions: ManagedSessionSummary[];
  activeSessionId: string;
  /** The open session, needed to offer assigning it. */
  summary: SessionSummarySnapshot | null;
  /** Controls that belong to the row rather than the strip, e.g. the side
   *  panel toggle while the panel is away. */
  leading?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const projectActions = useProjectActions();
  const sessionActions = useSessionActions();
  const [open, setOpen] = useState(false);

  if (!projectId) {
    return (
      <div className={cn(STRIP, "h-12 justify-between")}>
        <div className="flex items-center gap-2 min-w-0">
          {leading}
          <Icon iconName={IconName.Flag} size={16} className="shrink-0 text-basic-muted" />
          <span className="label-small text-basic-muted truncate">
            This chat is not assigned to a project
          </span>
        </div>
        <Button
          variant={ButtonVariant.Secondary}
          size={ButtonSize.Small}
          content={ButtonContent.Text}
          className="shrink-0 mb-1"
          onClick={() => summary && projectActions.assign(summary)}
          disabled={!summary}
        >
          Assign to Project
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(STRIP, "h-12")}>
      {leading ? <div className="flex items-center shrink-0 mb-1">{leading}</div> : null}
      {/* Horizontal only: the strip is one row and must never grow taller. */}
      <div className="flex items-end gap-1 flex-1 min-w-0 overflow-x-auto [&>*]:shrink-0">
        {sessions.length === 0 ? (
          <ChatSessionTab
            title="New chat"
            active
            onClick={() => void projectActions.newChat(projectId)}
          />
        ) : (
          sessions.map((entry) => (
            <ChatSessionTab
              key={entry.summary.session_id}
              title={displaySessionTitle(entry.summary)}
              active={entry.summary.session_id === activeSessionId}
              running={isActiveRun(entry.active_run)}
              onClick={() => navigate(routes.session(entry.summary.session_id))}
              // The last chat cannot go: a project with none has nothing open.
              onClose={sessions.length > 1 ? () => sessionActions.remove(entry.summary) : undefined}
            />
          ))
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0 mb-1">
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          placement={PopoverPlacement.BottomRight}
          size={PopoverSize.Medium}
          sticky
          content={
            <ChatSessionPopover
              sessions={sessions}
              activeSessionId={activeSessionId}
              onNewChat={() => void projectActions.newChat(projectId)}
              onClose={() => setOpen(false)}
            />
          }
        >
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Small}
            content={ButtonContent.Icon}
            aria-label="All chats in this project"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon iconName={IconName.MenuHorizontal} />
          </Button>
        </Popover>
        <Tooltip title="New chat" position={Tooltip.Position.BottomCenter}>
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Small}
            content={ButtonContent.Icon}
            aria-label="New chat"
            onClick={() => void projectActions.newChat(projectId)}
          >
            <Icon iconName={IconName.Add} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
