import { IconName } from "@/app/atoms";
import { RowActionButton } from "@/app/components/projects/RowActionButton";

interface ChatSessionActionsProps {
  title: string;
  pinned?: boolean;
  /**
   * Bare 20px glyphs for the mobile row. Desktop stays small: its 24px target
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
    <>
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
    </>
  );
}
