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
  onDelete: () => void;
  /** Projects only — an unassigned chat cannot be pinned. */
  onTogglePin?: () => void;
  onRename?: () => void;
  /** Files an unassigned chat; only meaningful on an orphan card. */
  onAssign?: () => void;
  /** Tablet/mobile reorder controls (Default sort). */
  reorder?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };
}

/**
 * Row of per-card actions. Both kinds of card can be renamed, deleted and
 * reordered; a project can also be pinned, while an unassigned chat can be
 * filed under a project instead.
 */
export function ProjectCardActions({
  orphan,
  pinned,
  onDelete,
  onTogglePin,
  onRename,
  onAssign,
  reorder,
}: ProjectCardActionsProps) {
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
      {orphan ? (
        <>
          {onRename ? <IconAction title="Edit" icon={IconName.Edit} onClick={onRename} /> : null}
          {onAssign ? (
            <IconAction title="Assign to project" icon={IconName.FolderOpen} onClick={onAssign} />
          ) : null}
          <IconAction
            title="Delete chat"
            icon={IconName.Trash}
            variant={ButtonVariant.GhostDestructive}
            onClick={onDelete}
          />
        </>
      ) : (
        <>
          {onTogglePin ? (
            <IconAction
              title={pinned ? "Unpin project" : "Pin project"}
              icon={pinned ? IconName.Unpin : IconName.Pin}
              onClick={onTogglePin}
            />
          ) : null}
          {onRename ? (
            <IconAction title="Rename project" icon={IconName.Edit} onClick={onRename} />
          ) : null}
          <IconAction
            title="Remove project"
            icon={IconName.Trash}
            variant={ButtonVariant.GhostDestructive}
            onClick={onDelete}
          />
        </>
      )}
    </div>
  );
}
