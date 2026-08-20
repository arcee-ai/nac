import { useEffect, useState } from "react";
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
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { isActiveRun } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import type { DropEdge } from "@/app/lib/sessionOrder";
import { applyTabOrder, placeIdAt, targetIndexInGroup } from "@/app/lib/sessionOrder";
import { NEW_CHAT_KEYS } from "@/app/lib/shortcuts";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  dismissChatTab,
  restoreChatTab,
  setChatTabOrder,
  useChatTabOrder,
  useDismissedChatTabs,
} from "@/app/store/chatTabsStore";
import type { ManagedSessionSummary, SessionSummarySnapshot } from "@/app/types/api";

/** Which side of the tab under the pointer the dragged one would land on. */
function edgeUnderPointer(element: HTMLElement, clientX: number): DropEdge {
  const rect = element.getBoundingClientRect();
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

/**
 * The strip above a project's transcript, listing the project's chats.
 *
 * Tabs can be dragged into any order, which the project keeps for the rest of
 * the visit. That order is the strip's alone: the chat lists elsewhere are read
 * to find a chat, so they stay sorted by when each was last used.
 *
 * A session that belongs to no project gets the same slot, filled with the way
 * to file it somewhere — an orphan is not a project of one, so it has no tabs
 * to show, and nowhere to put a new chat either.
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
  const sessionTitle = useSessionTitle();
  const dismissed = useDismissedChatTabs();
  const tabOrder = useChatTabOrder(projectId);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ sessionId: string; edge: DropEdge } | null>(null);

  // Reaching a chat any other way — the popover, the trail, a bookmarked URL —
  // is as much "open it" as clicking its tab, so it earns its place back.
  useEffect(() => {
    restoreChatTab(activeSessionId);
  }, [activeSessionId]);

  if (!projectId) {
    return (
      <div className="flex h-12 items-center gap-3 px-2 border-b border-b-tertiary">
        {leading}
        <Icon iconName={IconName.Danger} size={28} className="shrink-0 text-danger-primary" />
        <div className="flex flex-col flex-1 min-w-0 text-danger-primary">
          <span className="label-micro truncate">The session is not assigned</span>
          <span className="text-[10px] leading-[12px] opacity-75 truncate">
            Adding new sessions is unavailable
          </span>
        </div>
        <Tooltip title="Delete chat" position={Tooltip.Position.BottomLeft}>
          <Button
            variant={ButtonVariant.GhostDestructive}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            className="shrink-0"
            aria-label="Delete chat"
            disabled={!summary}
            onClick={() => summary && sessionActions.remove(summary)}
          >
            <Icon iconName={IconName.Trash} />
          </Button>
        </Tooltip>
        <Button
          variant={ButtonVariant.Primary}
          size={ButtonSize.Medium}
          content={ButtonContent.IconLeft}
          className="shrink-0"
          onClick={() => summary && projectActions.assign(summary)}
          disabled={!summary}
        >
          <Icon iconName={IconName.FolderOpen} /> Assign to Project
        </Button>
      </div>
    );
  }

  // A project with no chat yet has one tab standing in for the chat it is about
  // to get, and nothing to list or add alongside it.
  const empty = sessions.length === 0;

  // Closed tabs keep their place in the arrangement, so reopening one puts it
  // back where the user left it rather than at the front.
  const ordered = applyTabOrder(sessions, tabOrder);

  // The chat on screen keeps its tab whatever the user did with it, because a
  // transcript with no tab above it reads as belonging to nothing.
  const visible = ordered.filter(
    (entry) =>
      !dismissed.has(entry.summary.session_id) || entry.summary.session_id === activeSessionId,
  );

  // A single tab has nothing to trade places with.
  const reorderable = visible.length > 1;

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const dropOn = (targetSessionId: string, edge: DropEdge) => {
    if (!dragging) return;
    const index = targetIndexInGroup(ordered, targetSessionId, edge, dragging);
    setChatTabOrder(
      projectId,
      placeIdAt(
        ordered.map((entry) => entry.summary.session_id),
        dragging,
        index,
      ),
    );
    endDrag();
  };

  // Closing the chat being read has to leave another one to read.
  const closeTab = (sessionId: string) => {
    if (sessionId === activeSessionId) {
      const index = visible.findIndex((entry) => entry.summary.session_id === sessionId);
      const next = visible[index + 1] ?? visible[index - 1];
      if (!next) return;
      navigate(routes.session(next.summary.session_id));
    }
    dismissChatTab(sessionId);
  };

  return (
    <div className="flex items-center gap-3 px-2 border-b border-b-tertiary">
      {leading ? <div className="flex items-center shrink-0">{leading}</div> : null}
      {/* Horizontal only: the strip is one row and must never grow taller. */}
      <div className="flex items-start gap-2 flex-1 min-w-0 overflow-x-auto overflow-y-clip [&>*]:shrink-0">
        {empty ? (
          <ChatSessionTab
            title="New Chat"
            active
            onClick={() => void projectActions.newChat(projectId)}
          />
        ) : (
          visible.map((entry) => {
            const sessionId = entry.summary.session_id;
            return (
              <div
                key={sessionId}
                className={cn("relative", dragging === sessionId && "opacity-40")}
                draggable={reorderable}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox starts no drag at all without a payload.
                  event.dataTransfer.setData("text/plain", sessionId);
                  setDragging(sessionId);
                }}
                onDragEnd={endDrag}
                onDragOver={(event) => {
                  // Anything else being dragged over the strip — a file, a
                  // selection — is none of the strip's business.
                  if (!dragging) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const edge = edgeUnderPointer(event.currentTarget, event.clientX);
                  setDropAt((current) =>
                    current?.sessionId === sessionId && current.edge === edge
                      ? current
                      : { sessionId, edge },
                  );
                }}
                onDrop={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  dropOn(sessionId, edgeUnderPointer(event.currentTarget, event.clientX));
                }}
              >
                {dropAt?.sessionId === sessionId ? (
                  // On the tab's own edge rather than out in the gap between
                  // tabs: the strip scrolls, and anything outside a tab is
                  // clipped away at either end of it.
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-accent-inverse",
                      dropAt.edge === "before" ? "left-0" : "right-0",
                    )}
                  />
                ) : null}
                <ChatSessionTab
                  title={sessionTitle(entry.summary)}
                  active={sessionId === activeSessionId}
                  running={isActiveRun(entry.active_run)}
                  forkedFromTitle={entry.summary.forked_from?.title}
                  onClick={() => navigate(routes.session(sessionId))}
                  // The last tab has nowhere to hand the screen over to.
                  onDismiss={visible.length > 1 ? () => closeTab(sessionId) : undefined}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center shrink-0">
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          placement={PopoverPlacement.BottomLeft}
          size={PopoverSize.Medium}
          sticky
          // The panel is the popover's own frame: its heading rules and the
          // list's inset reach the edges, which the shared padding would inset.
          panelClassName="p-0 gap-0 overflow-hidden"
          content={
            <ChatSessionPopover
              sessions={sessions}
              activeSessionId={activeSessionId}
              onClose={() => setOpen(false)}
            />
          }
        >
          <Button
            variant={open ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            aria-label="All chats in this project"
            aria-expanded={open}
            disabled={empty}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon iconName={IconName.MenuHorizontal} />
          </Button>
        </Popover>
        <Tooltip
          title="New chat"
          keyboardShortcuts={NEW_CHAT_KEYS}
          position={Tooltip.Position.BottomLeft}
        >
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Icon}
            aria-label="New chat"
            disabled={empty}
            onClick={() => void projectActions.newChat(projectId)}
          >
            <Icon iconName={IconName.Add} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
