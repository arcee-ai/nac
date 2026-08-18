import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, ButtonSize, Icon, IconName, Input, InputLeading, InputSize } from "@/app/atoms";
import { ChatSessionList } from "@/app/components/projects/ChatSessionList";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import type { ManagedSessionSummary } from "@/app/types/api";

interface ChatSessionPopoverProps {
  /** The project's sessions; already narrowed by the caller. */
  sessions: ManagedSessionSummary[];
  activeSessionId?: string | null;
  /**
   * Adds a create row above the list. Only the phone passes it: a desktop
   * reaches the same action from the tab strip's own button, so repeating it
   * here would put two of them on one screen.
   */
  onNewChat?: () => void;
  onClose: () => void;
}

/**
 * The chat list behind the tab strip's overflow button: every session of the
 * open project, the current one marked, each row renaming and deleting in
 * place.
 *
 * Rendered as the body of a popover, which is what `onClose` closes — an action
 * that opens a modal of its own closes it first, so the two do not stack.
 */
export function ChatSessionPopover({
  sessions,
  activeSessionId = null,
  onNewChat,
  onClose,
}: ChatSessionPopoverProps) {
  const navigate = useNavigate();
  const actions = useSessionActions();
  const isMobile = useIsMobile();
  const sessionTitle = useSessionTitle();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((entry) => sessionTitle(entry.summary).toLowerCase().includes(needle));
  }, [sessions, query, sessionTitle]);

  return (
    <div className={cn("flex flex-col", isMobile ? "h-[calc(70dvh)]" : "max-h-[520px]")}>
      <div className="flex flex-col gap-2 shrink-0 border-b border-muted p-2">
        <Input
          inputSize={isMobile ? InputSize.Large : InputSize.Medium}
          leading={InputLeading.Icon}
          leadingIconName={IconName.Search}
          placeholder="Search chats"
          aria-label="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {onNewChat ? (
          <Button
            size={isMobile ? ButtonSize.Large : ButtonSize.Medium}
            className="w-full justify-start"
            onClick={() => {
              onClose();
              onNewChat();
            }}
          >
            <Icon iconName={IconName.Add} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate text-left">New chat</span>
          </Button>
        ) : null}
      </div>
      <div className="flex-1 min-h-0 overflow-auto [&>*]:shrink-0 px-1 py-4">
        <ChatSessionList
          sessions={visible}
          activeSessionId={activeSessionId}
          emptyLabel={query.trim() ? "No matching chats" : "No chats yet"}
          onOpen={(entry) => {
            onClose();
            navigate(routes.session(entry.summary.session_id));
          }}
          onRename={(entry) => {
            onClose();
            actions.rename(entry.summary);
          }}
          onDelete={(entry) => {
            onClose();
            actions.remove(entry.summary);
          }}
        />
      </div>
    </div>
  );
}
