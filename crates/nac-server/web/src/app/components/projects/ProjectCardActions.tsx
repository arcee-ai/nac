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

interface ProjectCardActionsProps {
  /** A card for a chat that belongs to no project gets its own verbs. */
  orphan: boolean;
  pinned: boolean;
  running: boolean;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** Files an unassigned chat; only meaningful on an orphan card. */
  onAssign?: () => void;
  /** Stops the run of an unassigned chat, in place of deleting it. */
  onStop?: () => void;
  /** Tablet/mobile reorder controls (Default sort). */
  reorder?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };
}

/**
 * Row of per-card actions. A running chat offers "stop" instead of "delete",
 * mirroring the design and avoiding a destructive action mid-run. A project is
 * never itself running, so its delete never turns into a stop — the dialog it
 * opens keeps the chats anyway.
 */
export function ProjectCardActions({
  orphan,
  pinned,
  running,
  onTogglePin,
  onRename,
  onDelete,
  onAssign,
  onStop,
  reorder,
}: ProjectCardActionsProps) {
  const noun = orphan ? "chat" : "project";
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
      {orphan && onAssign ? (
        <IconAction title="Assign to a project" icon={IconName.Folders} onClick={onAssign} />
      ) : null}
      <IconAction
        title={pinned ? `Unpin ${noun}` : `Pin ${noun}`}
        icon={pinned ? IconName.Unpin : IconName.Pin}
        onClick={onTogglePin}
      />
      <IconAction title={`Rename ${noun}`} icon={IconName.Edit} onClick={onRename} />
      {running && onStop ? (
        <IconAction
          title="Stop run"
          icon={IconName.Stop}
          variant={ButtonVariant.GhostDestructive}
          onClick={onStop}
        />
      ) : (
        <IconAction
          title={`Delete ${noun}`}
          icon={IconName.Trash}
          variant={ButtonVariant.GhostDestructive}
          onClick={onDelete}
        />
      )}
    </div>
  );
}
