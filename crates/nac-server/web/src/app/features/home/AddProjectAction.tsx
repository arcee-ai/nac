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
} from "@/app/atoms";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { Menu, MenuItem } from "@/app/features/sidebar/MenuItem";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";

/**
 * Home's own "Add project": the creation form locally; on a managed host, the
 * choice between adding a repository and creating from a path already there.
 */
export function AddProjectAction({ touch = false }: { touch?: boolean }) {
  const managed = useManagedHost();
  const projectActions = useProjectActions();
  const [open, setOpen] = useState(false);

  const trigger = (onClick: () => void, expanded?: boolean) => (
    <Button
      variant={ButtonVariant.Secondary}
      size={touch ? ButtonSize.Large : ButtonSize.Small}
      content={ButtonContent.IconLeft}
      className={touch ? "min-h-11" : undefined}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Icon iconName={IconName.Add} />
      <span>Add project</span>
    </Button>
  );

  if (!managed.isManaged) return trigger(projectActions.create);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
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
