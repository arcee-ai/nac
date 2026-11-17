import "./navigation.css";
import { IconName } from "@/app/atoms";
import { RowActionButton } from "@/app/components/projects/RowActionButton";

interface ChatSessionActionsProps {
  title: string;
  pinned?: boolean;
  /**
   * 44px phone targets with a shared narrow-screen action layout. Desktop keeps a 24px target; it
   * is the WCAG 2.5.8 minimum.
   */
  isMobile?: boolean;
  onPin?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  /** Files a session that belongs to no project. */
  onAssign?: () => void;
}

/** Shared row actions; callers choose whether pinning is server or browser presentation. */
export function ChatSessionActions({
  title,
  pinned = false,
  isMobile = false,
  onPin,
  onRename,
  onDelete,
  onAssign,
}: ChatSessionActionsProps) {
  return (
    <div className={isMobile ? "nac-session-actions flex items-center gap-0" : "contents"}>
      {onPin ? (
        <RowActionButton
          icon={pinned ? IconName.Unpin : IconName.Pin}
          title={pinned ? "Unpin chat" : "Pin chat"}
          label={`${pinned ? "Unpin" : "Pin"} ${title}`}
          isMobile={isMobile}
          onClick={onPin}
        />
      ) : null}
      {onAssign ? (
        <RowActionButton
          icon={IconName.Folder}
          title="Assign to project"
          label={`Assign ${title} to a project`}
          isMobile={isMobile}
          onClick={onAssign}
        />
      ) : null}
      {onRename ? (
        <RowActionButton
          icon={IconName.Edit}
          title="Rename chat"
          label={`Rename ${title}`}
          isMobile={isMobile}
          onClick={onRename}
        />
      ) : null}
      {onDelete ? (
        <RowActionButton
          icon={IconName.Trash}
          title="Delete chat"
          label={`Delete ${title}`}
          isMobile={isMobile}
          destructive
          onClick={onDelete}
        />
      ) : null}
    </div>
  );
}
