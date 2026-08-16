import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Separator,
  SessionAvatar,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { displaySessionTitle, isActiveRun } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { pinGroup } from "@/app/lib/sessionOrder";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useSessions } from "@/app/services/queries";
import type { ManagedSessionSummary } from "@/app/types/api";

/**
 * One session in the switcher: the row that opens it, and the two actions that
 * act on it without leaving the trail — the same rename and delete the cards on
 * the sessions list offer.
 *
 * The actions keep their space in the row at all times and only become visible
 * on hover or on focus, so a pointer moving down the list does not make the
 * titles beside them re-truncate row by row.
 */
function SessionSwitcherRow({
  entry,
  active,
  isMobile,
  onOpen,
  onRename,
  onDelete,
}: {
  entry: ManagedSessionSummary;
  /** The session the trail is currently in. */
  active: boolean;
  isMobile: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const summary = entry.summary;
  const running = isActiveRun(entry.active_run);

  return (
    <div
      className={cn(
        "group flex items-center min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered",
        isMobile ? "h-12 gap-3 px-3" : "gap-2 px-2 py-1.5",
        active && "bg-btn-ghost-highlighted",
      )}
    >
      <button
        type="button"
        className={cn("flex flex-1 items-center min-w-0 text-left", isMobile ? "gap-3" : "gap-2")}
        onClick={onOpen}
      >
        <SessionAvatar id={summary.session_id} size={isMobile ? 24 : 20} isRunning={running} />
        <span
          className={cn(
            "truncate",
            isMobile ? "text-medium" : "label-small",
            running ? "text-shimmer-basic" : "text-basic-primary",
          )}
        >
          {displaySessionTitle(summary)}
        </span>
      </button>
      <div
        className={cn(
          "flex items-center gap-1 shrink-0",
          // A touch device has no hover to reveal them with.
          !isMobile &&
            "invisible opacity-0 transition-opacity duration-150 ease-out group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
        )}
      >
        <Button
          variant={ButtonVariant.Ghost}
          size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
          content={ButtonContent.Icon}
          title="Rename session"
          aria-label={`Rename ${displaySessionTitle(summary)}`}
          onClick={onRename}
        >
          <Icon iconName={IconName.Edit} />
        </Button>
        <Button
          variant={ButtonVariant.GhostDestructive}
          size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
          content={ButtonContent.Icon}
          title="Delete session"
          aria-label={`Delete ${displaySessionTitle(summary)}`}
          onClick={onDelete}
        >
          <Icon iconName={IconName.Trash} />
        </Button>
      </div>
    </div>
  );
}

/**
 * Heading for a group of rows, in the form the model catalog uses: the name,
 * then a rule filling whatever the name leaves of the line.
 */
function GroupLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-3 pb-1 first:pt-1">
      <span className="tag-label text-basic-muted whitespace-nowrap shrink-0">{children}</span>
      {/* Basis 100%, so it eats the row's slack and leaves the label at its
          natural width. */}
      <Separator className="shrink" />
    </div>
  );
}

/**
 * The session list behind the trail's session button: every session, the open
 * one marked, each row renaming and deleting in place.
 *
 * Rendered as the body of the trail's popover, which is what `onClose` closes —
 * an action that opens a modal of its own closes it first, so the two do not
 * stack.
 */
export function SessionSwitcher({
  sessionId,
  onClose,
}: {
  /** Session the trail is in, marked as the current row. */
  sessionId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const actions = useSessionActions();
  const isMobile = useIsMobile();
  const { data: sessions = [] } = useSessions();

  // Both groups in the order the sessions list calls default: the order the
  // cards were dragged into, newest first where nothing was dragged.
  const pinned = useMemo(() => pinGroup(sessions, true), [sessions]);
  const rest = useMemo(() => pinGroup(sessions, false), [sessions]);

  const row = (entry: ManagedSessionSummary) => (
    <SessionSwitcherRow
      key={entry.summary.session_id}
      entry={entry}
      active={entry.summary.session_id === sessionId}
      isMobile={isMobile}
      onOpen={() => {
        onClose();
        navigate(routes.session(entry.summary.session_id));
      }}
      onRename={() => {
        onClose();
        actions.rename(entry.summary);
      }}
      onDelete={() => {
        onClose();
        actions.remove(entry.summary);
      }}
    />
  );

  return (
    <div className={isMobile ? "flex flex-col h-[calc(70dvh)]" : "flex flex-col"}>
      {/* The trail is gone on a phone, so the way back to the list (and the
          launch affordance) stay pinned above the switcher. */}
      {isMobile ? (
        <div className="flex flex-col gap-1 shrink-0 pb-2 border-b border-muted">
          <TabButton
            size={TabButtonSize.Large}
            onClick={() => {
              onClose();
              navigate(routes.list());
            }}
          >
            <Icon iconName={IconName.Left} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate text-left">All Sessions</span>
          </TabButton>
          <Separator />
          <TabButton
            size={TabButtonSize.Large}
            onClick={() => {
              onClose();
              actions.launch();
            }}
          >
            <Icon iconName={IconName.Add} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate text-left">New Session</span>
          </TabButton>
        </div>
      ) : null}
      <div
        className={cn(
          "flex flex-col gap-1",
          isMobile && "flex-1 min-h-0 overflow-auto [&>*]:shrink-0 pt-2",
        )}
      >
        {sessions.length === 0 ? (
          <div className="label-small text-basic-muted px-2 py-1">No sessions</div>
        ) : pinned.length === 0 ? (
          // A single group needs no heading to tell it from anything.
          rest.map(row)
        ) : (
          <>
            <GroupLabel>Pinned</GroupLabel>
            {pinned.map(row)}
            {rest.length > 0 ? <GroupLabel>Other sessions</GroupLabel> : null}
            {rest.map(row)}
          </>
        )}
      </div>
    </div>
  );
}
