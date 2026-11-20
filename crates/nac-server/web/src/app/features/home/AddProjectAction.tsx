import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  Tooltip,
} from "@/app/atoms";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { Menu, MenuItem } from "@/app/features/sidebar/MenuItem";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";

/**
 * The shared "Add project" action: the creation form locally; on a managed host, the
 * choice between adding a repository and creating from a path already there.
 */
export function AddProjectAction({
  touch = false,
  iconOnly = false,
  beforeCreate,
}: {
  touch?: boolean;
  iconOnly?: boolean;
  beforeCreate?: () => void;
}) {
  const managed = useManagedHost();
  const projectActions = useProjectActions();
  const [open, setOpen] = useState(false);

  const iconLabel = managed.isManaged ? "Add project to this host" : "New project";
  const trigger = (onClick: () => void, expanded?: boolean) => {
    const button = (
      <Button
        variant={iconOnly ? ButtonVariant.Ghost : ButtonVariant.Secondary}
        size={touch ? (iconOnly ? ButtonSize.Medium : ButtonSize.Large) : ButtonSize.Small}
        content={iconOnly ? ButtonContent.Icon : ButtonContent.IconLeft}
        className={touch ? (iconOnly ? "!size-11" : "min-h-11") : undefined}
        aria-label={iconOnly ? iconLabel : undefined}
        aria-haspopup={expanded === undefined ? undefined : "menu"}
        aria-expanded={expanded}
        onClick={onClick}
      >
        <Icon iconName={IconName.Add} />
        {iconOnly ? null : <span>Add project</span>}
      </Button>
    );
    return iconOnly ? (
      <Tooltip title={iconLabel} sticky>
        {button}
      </Tooltip>
    ) : (
      button
    );
  };

  const choose = (action: () => void) => () => {
    setOpen(false);
    beforeCreate?.();
    action();
  };
  if (!managed.isManaged) return trigger(choose(projectActions.create));
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      sticky
      placement={touch ? PopoverPlacement.BottomLeft : PopoverPlacement.BottomRight}
      size={PopoverSize.Medium}
      content={
        <Menu label="Add project">
          <MenuItem
            icon={IconName.Github}
            label="Add repository"
            hint="Clone a GitHub repository onto this host"
            onSelect={choose(managed.addRepository)}
          />
          <MenuItem
            icon={IconName.Folder}
            label="Create from an existing path"
            hint="Use a folder that is already on this host"
            onSelect={choose(projectActions.create)}
          />
        </Menu>
      }
    >
      {trigger(() => setOpen((value) => !value), open)}
    </Popover>
  );
}
