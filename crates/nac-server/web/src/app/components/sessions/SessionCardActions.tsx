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
}

// `sticky` keeps the box out of the card's clipped overflow; it opens upwards so
// it never covers the button the pointer is on.
function IconAction({
  title,
  icon,
  onClick,
  variant = ButtonVariant.Ghost,
}: IconActionProps) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter} sticky>
      <Button
        variant={variant}
        size={ButtonSize.Small}
        content={ButtonContent.Icon}
        aria-label={title}
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
}: SessionCardActionsProps) {
  return (
    <div className="flex items-center gap-4 xl:gap-1.5 shrink-0">
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
