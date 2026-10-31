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
}

/** Shared row actions; callers choose whether pinning is server or browser presentation. */
export function ChatSessionActions({
  title,
  pinned = false,
  isMobile = false,
  onPin,
  onRename,
  onDelete,
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
