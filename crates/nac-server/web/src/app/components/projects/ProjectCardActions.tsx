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
  /** Projects only — a loose chat has neither a pin nor a name of its own. */
  onTogglePin?: () => void;
  onRename?: () => void;
  /** Files an unassigned chat; only meaningful on an orphan card. */
  onAssign?: () => void;
  /** Tablet/mobile reorder controls (Default sort), projects only. */
  reorder?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
  };
}

/**
 * Row of per-card actions. The two kinds of card carry different verbs: a
 * project is pinned, renamed and deleted, while the one thing worth offering on
 * an unassigned chat is filing it, so that gets a labelled primary button.
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
  if (orphan) {
    return (
      <div className="flex items-center gap-2 shrink-0">
        <IconAction
          title="Delete chat"
          icon={IconName.Trash}
          variant={ButtonVariant.GhostDestructive}
          onClick={onDelete}
        />
        {onAssign ? (
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Small}
            content={ButtonContent.IconLeft}
            onClick={(e) => {
              e.stopPropagation();
              onAssign();
            }}
          >
            <Icon iconName={IconName.FolderOpen} /> Assign to project
          </Button>
        ) : null}
      </div>
    );
  }

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
        title="Delete project"
        icon={IconName.Trash}
        variant={ButtonVariant.GhostDestructive}
        onClick={onDelete}
      />
    </div>
  );
}
