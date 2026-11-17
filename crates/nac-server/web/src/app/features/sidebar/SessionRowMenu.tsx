import type { KeyboardEvent, MouseEvent } from "react";

import { Icon, IconName, Popover, PopoverPlacement, PopoverSize, Tooltip } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

import { Menu, MenuItem, MenuSeparator } from "./MenuItem";

export interface SessionRowMenuProps {
  title: string;
  pinned?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Phone menu rows: a 44px trigger. Coarse pointers get one through CSS. */
  touch?: boolean;
  /** Reveal classes for the trigger (hover/focus on fine pointers). */
  className?: string;
  onRename?: () => void;
  onPin?: () => void;
  /** Files a session that belongs to no project. */
  onAssign?: () => void;
  /** Opens the full-name disclosure; receives the selecting event for focus return. */
  onViewName?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Starts the existing delete confirmation. */
  onDelete?: () => void;
}

/**
 * A session row's one "⋯" control. Every row action lives in this menu, so the
 * row itself stays a single quiet line: rename, pin, move to a project, the
 * full name, and delete last. Item names keep the row's title ("Rename …").
 */
export function SessionRowMenu({
  title,
  pinned = false,
  open,
  onOpenChange,
  touch = false,
  className,
  onRename,
  onPin,
  onAssign,
  onViewName,
  onDelete,
}: SessionRowMenuProps) {
  const label = `${title} options`;
  const then = (run?: () => void) => () => {
    onOpenChange(false);
    run?.();
  };
  // Tab leaves the menu the way Escape does: closed, focus back on the trigger.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    onOpenChange(false);
  };
  return (
    <Popover
      open={open}
      onClose={() => onOpenChange(false)}
      sticky
      placement={PopoverPlacement.BottomRight}
      size={PopoverSize.Small}
      sheetClassName="px-2"
      content={
        <div className="contents" onKeyDown={onKeyDown}>
          <Menu label={label} autoFocus>
            {onRename ? (
              <MenuItem
                icon={IconName.Edit}
                label="Rename"
                ariaLabel={`Rename ${title}`}
                onSelect={then(onRename)}
              />
            ) : null}
            {onPin ? (
              <MenuItem
                icon={pinned ? IconName.Unpin : IconName.Pin}
                label={pinned ? "Unpin" : "Pin"}
                ariaLabel={`${pinned ? "Unpin" : "Pin"} ${title}`}
                onSelect={then(onPin)}
              />
            ) : null}
            {onAssign ? (
              <MenuItem icon={IconName.Folder} label="Move to project" onSelect={then(onAssign)} />
            ) : null}
            {onViewName ? (
              <MenuItem
                icon={IconName.Info}
                label="View full name"
                disabled={!title}
                onSelect={(event) => {
                  onOpenChange(false);
                  onViewName(event);
                }}
              />
            ) : null}
            {onDelete ? (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={IconName.Trash}
                  label="Delete"
                  ariaLabel={`Delete ${title}`}
                  destructive
                  onSelect={then(onDelete)}
                />
              </>
            ) : null}
          </Menu>
        </div>
      }
    >
      <Tooltip title="Session options" sticky disabled={open}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          onKeyDown={(event) => {
            if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              onOpenChange(true);
            }
          }}
          className={cn(
            "relative flex shrink-0 items-center justify-center rounded-pill text-basic-tertiary outline-none",
            touch ? "size-11" : "size-6 [@media(hover:none)]:size-11",
            "hover:bg-[var(--f-wash-2)] hover:text-basic-primary",
            "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
            "transition-[opacity,background-color,color] duration-150 ease-out motion-reduce:transition-none",
            open && "bg-[var(--f-wash-2)] text-basic-primary",
            className,
          )}
        >
          <Icon iconName={IconName.MenuHorizontal} size={16} />
        </button>
      </Tooltip>
    </Popover>
  );
}
