import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionButton,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
} from "@/app/atoms";
import { ChatSessionPopover } from "@/app/components/projects/ChatSessionPopover";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { isActiveRun, NEW_CHAT_TITLE } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import { sessionBehaviorPresentation } from "@/app/lib/sessionBehavior";
import type { DropEdge } from "@/app/lib/sessionOrder";
import { applyTabOrder, placeIdAt, targetIndexInGroup } from "@/app/lib/sessionOrder";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import {
  dismissChatTab,
  restoreChatTab,
  setChatTabOrder,
  useChatTabOrder,
  useDismissedChatTabs,
} from "@/app/store/chatTabsStore";
import type { ManagedSessionSummary } from "@/app/types/api";

function edgeUnderPointer(element: HTMLElement, clientY: number): DropEdge {
  const rect = element.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function RailSessionActions({
  title,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onClose,
}: {
  title: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement={PopoverPlacement.CenterRight}
      size={PopoverSize.Small}
      sticky
      sheetOnMobile={false}
      content={
        <div className="flex flex-col gap-1">
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.IconLeft}
            className="w-full justify-start"
            disabled={!canMoveUp}
            onClick={() => run(onMoveUp)}
          >
            <Icon iconName={IconName.ArrowTop} /> Move up
          </Button>
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.IconLeft}
            className="w-full justify-start"
            disabled={!canMoveDown}
            onClick={() => run(onMoveDown)}
          >
            <Icon iconName={IconName.ArrowDown} /> Move down
          </Button>
          <Button
            variant={ButtonVariant.GhostDestructive}
            size={ButtonSize.Medium}
            content={ButtonContent.IconLeft}
            className="w-full justify-start"
            onClick={() => run(onClose)}
          >
            <Icon iconName={IconName.Close} /> Close chat
          </Button>
        </div>
      }
    >
      <Button
        variant={open ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost}
        size={ButtonSize.Small}
        content={ButtonContent.Icon}
        aria-label={`Actions for ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon iconName={IconName.MenuVertical} />
      </Button>
    </Popover>
  );
}

/** Wide-screen project-chat navigation beside the transcript. */
export function ProjectSessionRail({
  projectId,
  sessions,
  activeSessionId,
  collapsed,
  onToggleCollapsed,
  leading,
}: {
  projectId: string;
  sessions: ManagedSessionSummary[];
  activeSessionId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  leading?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const projectActions = useProjectActions();
  const sessionTitle = useSessionTitle();
  const dismissed = useDismissedChatTabs();
  const tabOrder = useChatTabOrder(projectId);
  const [allChatsOpen, setAllChatsOpen] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ sessionId: string; edge: DropEdge } | null>(null);

  useEffect(() => {
    restoreChatTab(activeSessionId);
  }, [activeSessionId]);

  const ordered = applyTabOrder(sessions, tabOrder);
  const visible = ordered.filter(
    (entry) =>
      !dismissed.has(entry.summary.session_id) || entry.summary.session_id === activeSessionId,
  );
  const reorderable = visible.length > 1;

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const moveTo = (sessionId: string, targetSessionId: string, edge: DropEdge) => {
    const index = targetIndexInGroup(ordered, targetSessionId, edge, sessionId);
    setChatTabOrder(
      projectId,
      placeIdAt(
        ordered.map((entry) => entry.summary.session_id),
        sessionId,
        index,
      ),
    );
  };

  const moveBy = (sessionId: string, delta: -1 | 1) => {
    const current = visible.findIndex((entry) => entry.summary.session_id === sessionId);
    const target = visible[current + delta];
    if (!target) return;
    moveTo(sessionId, target.summary.session_id, delta < 0 ? "before" : "after");
  };

  const closeChat = (sessionId: string) => {
    if (sessionId === activeSessionId) {
      const index = visible.findIndex((entry) => entry.summary.session_id === sessionId);
      const next = visible[index + 1] ?? visible[index - 1];
      navigate(next ? routes.session(next.summary.session_id) : routes.list());
    }
    dismissChatTab(sessionId);
  };

  if (collapsed) {
    return (
      <nav
        aria-label="Project chats"
        className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-r-tertiary bg-elevation-level-1 py-2"
      >
        {leading}
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.Icon}
          aria-label="Expand project chats"
          aria-expanded={false}
          onClick={onToggleCollapsed}
        >
          <Icon iconName={IconName.OpenSidebar} />
        </Button>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Project chats"
      className="flex w-[272px] shrink-0 flex-col overflow-hidden border-r border-r-tertiary bg-elevation-level-1"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-b-muted px-2 py-2">
        {leading}
        <span className="label-small min-w-0 flex-1 truncate px-1 text-basic-secondary">
          Project chats
        </span>
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.Icon}
          aria-label="Collapse project chats"
          aria-controls="project-session-rail-list"
          aria-expanded
          onClick={onToggleCollapsed}
        >
          <Icon iconName={IconName.CloseSidebar} />
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-b-muted p-2">
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.IconLeft}
          className="min-w-0 justify-start"
          aria-label="Create new session"
          onClick={() => void projectActions.newChat(projectId)}
        >
          <Icon iconName={IconName.Add} />
          <span className="truncate">New</span>
        </Button>
        <Popover
          open={allChatsOpen}
          onClose={() => setAllChatsOpen(false)}
          placement={PopoverPlacement.CenterRight}
          size={PopoverSize.Medium}
          sticky
          className="w-full"
          panelClassName="p-0 gap-0 overflow-hidden"
          content={
            <ChatSessionPopover
              sessions={sessions}
              activeSessionId={activeSessionId}
              onClose={() => setAllChatsOpen(false)}
            />
          }
        >
          <Button
            variant={allChatsOpen ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.IconLeft}
            className="min-w-0 justify-start"
            aria-label="All chats in this project"
            aria-expanded={allChatsOpen}
            onClick={() => setAllChatsOpen((value) => !value)}
          >
            <Icon iconName={IconName.MenuHorizontal} />
            <span className="truncate">All chats</span>
          </Button>
        </Popover>
      </div>

      <div id="project-session-rail-list" className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
        {visible.length === 0 ? (
          <ChatSessionButton
            title={NEW_CHAT_TITLE}
            active
            onClick={() => void projectActions.newChat(projectId)}
          />
        ) : (
          <div className="flex flex-col gap-1">
            {visible.map((entry, index) => {
              const sessionId = entry.summary.session_id;
              const title = sessionTitle(entry.summary);
              const behavior = sessionBehaviorPresentation(entry.summary.behavior);
              return (
                <div
                  key={sessionId}
                  className={cn("relative", dragging === sessionId && "opacity-40")}
                  draggable={reorderable}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", sessionId);
                    setDragging(sessionId);
                  }}
                  onDragEnd={endDrag}
                  onDragOver={(event) => {
                    if (!dragging) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const edge = edgeUnderPointer(event.currentTarget, event.clientY);
                    setDropAt((current) =>
                      current?.sessionId === sessionId && current.edge === edge
                        ? current
                        : { sessionId, edge },
                    );
                  }}
                  onDrop={(event) => {
                    if (!dragging) return;
                    event.preventDefault();
                    moveTo(
                      dragging,
                      sessionId,
                      edgeUnderPointer(event.currentTarget, event.clientY),
                    );
                    endDrag();
                  }}
                >
                  {dropAt?.sessionId === sessionId ? (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-accent-inverse",
                        dropAt.edge === "before" ? "top-0" : "bottom-0",
                      )}
                    />
                  ) : null}
                  <ChatSessionButton
                    title={title}
                    badge={behavior.navigationLabel}
                    badgeLabel={behavior.label}
                    active={sessionId === activeSessionId}
                    running={isActiveRun(entry.active_run)}
                    forkedFromTitle={entry.summary.forked_from?.title}
                    stackedBadge
                    onClick={() => navigate(routes.session(sessionId))}
                    actions={
                      <RailSessionActions
                        title={title}
                        canMoveUp={index > 0}
                        canMoveDown={index < visible.length - 1}
                        onMoveUp={() => moveBy(sessionId, -1)}
                        onMoveDown={() => moveBy(sessionId, 1)}
                        onClose={() => closeChat(sessionId)}
                      />
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
