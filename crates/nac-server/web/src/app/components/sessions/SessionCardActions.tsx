import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";

interface IconActionProps {
  title: string;
  icon: IconName;
  onClick: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
}

// `sticky` keeps the box out of the card's clipped overflow; it opens upwards so
// it never covers the button the pointer is on.
function IconAction({
  title,
  icon,
  onClick,
  variant = ButtonVariant.Ghost,
  disabled = false,
}: IconActionProps) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter} sticky>
      <Button
        variant={variant}
        size={ButtonSize.Small}
        content={ButtonContent.Icon}
        aria-label={title}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <Icon iconName={icon} />
      </Button>
    </Tooltip>
  );
}

interface SessionCardActionsProps {
  pinned: boolean;
  running: boolean;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
  onStop: () => void;
  /** Tablet/mobile reorder controls (Default sort). */
  reorder?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };
}

/**
 * Row of per-card actions. A running session offers "stop" instead of "delete",
 * mirroring the design and avoiding a destructive action mid-run.
 */
export function SessionCardActions({
  pinned,
  running,
  onTogglePin,
  onRename,
  onDelete,
  onStop,
  reorder,
}: SessionCardActionsProps) {
  return (
    <div
      className={
        reorder
          ? "flex items-center gap-1.5 shrink-0"
          : "flex items-center gap-4 xl:gap-1.5 shrink-0"
      }
    >
      {reorder ? (
        <>
          <IconAction
            title="Move down"
            icon={IconName.ArrowDown}
            disabled={!reorder.canMoveDown}
            onClick={reorder.onMoveDown}
          />
          <IconAction
            title="Move up"
            icon={IconName.ArrowTop}
            disabled={!reorder.canMoveUp}
            onClick={reorder.onMoveUp}
          />
        </>
      ) : null}
      <IconAction
        title={pinned ? "Unpin session" : "Pin session"}
        icon={pinned ? IconName.Unpin : IconName.Pin}
        onClick={onTogglePin}
      />
      <IconAction
        title="Rename session"
        icon={IconName.Edit}
        onClick={onRename}
      />
      {running ? (
        <IconAction
          title="Stop run"
          icon={IconName.Stop}
          variant={ButtonVariant.GhostDestructive}
          onClick={onStop}
        />
      ) : (
        <IconAction
          title="Delete session"
          icon={IconName.Trash}
          variant={ButtonVariant.GhostDestructive}
          onClick={onDelete}
        />
      )}
    </div>
  );
}
