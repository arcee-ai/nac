import { useState } from "react";

import {
  BottomSheet,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  HorizontalTabsItem,
  HorizontalTabsItemVariant,
  Icon,
  IconName,
  Separator,
} from "@/app/atoms";
import { ChatSessionPopover } from "@/app/components/projects/ChatSessionPopover";
import { ProjectPopover } from "@/app/components/projects/ProjectPopover";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import type { ManagedSessionSummary, SessionSummarySnapshot } from "@/app/types/api";

type Tab = "chats" | "projects";

/**
 * The phone's navigator: one sheet holding both lists, with a bar at the bottom
 * to swap between them. A desktop opens the two popovers from separate triggers,
 * but a phone header has room for exactly one.
 *
 * A chat that belongs to no project has no sibling chats to list, so the sheet
 * opens on the projects tab and offers to file it instead.
 */
export function MobileProjectSessionModal({
  open,
  onClose,
  projectId,
  sessions,
  activeSessionId,
  summary,
}: {
  open: boolean;
  onClose: () => void;
  /** Null when the open chat belongs to no project, or none is open. */
  projectId: string | null;
  /** The open project's chats; empty when there is no project. */
  sessions: ManagedSessionSummary[];
  activeSessionId: string | null;
  summary: SessionSummarySnapshot | null;
}) {
  const actions = useProjectActions();
  const [tab, setTab] = useState<Tab>(projectId ? "chats" : "projects");
  const orphan = summary != null && !projectId;

  return (
    <BottomSheet open={open} onClose={onClose} className="px-2 max-h-[85dvh]">
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "chats" && projectId ? (
          <ChatSessionPopover
            sessions={sessions}
            activeSessionId={activeSessionId}
            onNewChat={() => void actions.newChat(projectId)}
            onClose={onClose}
          />
        ) : (
          <ProjectPopover activeId={projectId ?? activeSessionId} onClose={onClose} />
        )}
      </div>

      {orphan ? (
        <div className="px-2 pt-2">
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Large}
            content={ButtonContent.IconLeft}
            className="w-full"
            onClick={() => {
              onClose();
              actions.assign(summary);
            }}
          >
            <Icon iconName={IconName.Folders} /> Assign to Project
          </Button>
        </div>
      ) : null}

      <Separator className="my-2" />
      <div className="flex items-center gap-1 px-2">
        {projectId ? (
          <HorizontalTabsItem
            active={tab === "chats"}
            variant={HorizontalTabsItemVariant.Neutral}
            iconName={IconName.Chat}
            className="flex-1 justify-center"
            onClick={() => setTab("chats")}
          >
            Chat sessions
          </HorizontalTabsItem>
        ) : null}
        <HorizontalTabsItem
          active={tab === "projects" || !projectId}
          variant={HorizontalTabsItemVariant.Neutral}
          iconName={IconName.Folders}
          className="flex-1 justify-center"
          onClick={() => setTab("projects")}
        >
          Projects
        </HorizontalTabsItem>
      </div>
    </BottomSheet>
  );
}
