import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, IconName } from "@/app/atoms";

interface ChatSessionActionsProps {
  title: string;
  pinned?: boolean;
  onPin?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

/** Shared row actions; callers choose whether pinning is server or browser presentation. */
export function ChatSessionActions({
  title,
  pinned = false,
  onPin,
  onRename,
  onDelete,
}: ChatSessionActionsProps) {
  return (
    <>
      {onPin ? (
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          title={pinned ? "Unpin chat" : "Pin chat"}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${title}`}
          onClick={onPin}
        >
          <Icon iconName={pinned ? IconName.Unpin : IconName.Pin} />
        </Button>
      ) : null}
      {onRename ? (
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          title="Rename chat"
          aria-label={`Rename ${title}`}
          onClick={onRename}
        >
          <Icon iconName={IconName.Edit} />
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          variant={ButtonVariant.GhostDestructive}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          title="Delete chat"
          aria-label={`Delete ${title}`}
          onClick={onDelete}
        >
          <Icon iconName={IconName.Trash} />
        </Button>
      ) : null}
    </>
  );
}
