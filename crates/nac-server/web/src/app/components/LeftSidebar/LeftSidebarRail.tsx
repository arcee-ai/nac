import type { ReactNode } from "react";

import { Button, ButtonContent, ButtonVariant, Icon, IconName, Logo, Tooltip } from "@/app/atoms";
import { TooltipPosition } from "@/app/atoms/tooltip";

import type { SidebarCommands } from "./useSidebarCommands.tsx";

/** Icon column left behind once the panel has slid away. */
export function LeftSidebarRail({
  commands,
  onToggle,
  toggleKeys,
}: {
  commands: SidebarCommands;
  onToggle: () => void;
  toggleKeys: string[];
}) {
  return (
    <div
      className="flex h-full flex-col justify-between bg-elevation-level-2 p-2"
      style={{ boxShadow: "var(--left-sidebar-closed)" }}
    >
      <div className="flex flex-col items-center gap-4 [&>*]:shrink-0">
        <button
          type="button"
          className="text-basic-primary"
          aria-label="All projects"
          onClick={commands.openProjects}
        >
          <Logo markOnly height={25} />
        </button>
        <RailButton label="Show sidebar" keys={toggleKeys} onClick={onToggle}>
          <Icon iconName={IconName.OpenSidebar} />
        </RailButton>
        <RailButton label="All projects" onClick={commands.openProjects}>
          <Icon iconName={IconName.Folders} />
        </RailButton>
        <RailButton label="New session" onClick={commands.newSession}>
          <Icon iconName={IconName.Add} />
        </RailButton>
        <RailButton label={commands.mcpLabel} onClick={commands.openMcp}>
          <Icon iconName={IconName.Toolbox} />
        </RailButton>
        <RailButton label="SSH" onClick={commands.openSsh}>
          <Icon iconName={IconName.Globe} />
        </RailButton>
      </div>
      <RailButton label="Configurations" onClick={commands.openConfigurations}>
        <Icon iconName={IconName.Gear} />
      </RailButton>
    </div>
  );
}

function RailButton({
  label,
  keys,
  onClick,
  children,
}: {
  label: string;
  keys?: string[];
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip title={label} keyboardShortcuts={keys} position={TooltipPosition.CenterRight} sticky>
      <Button
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
}
