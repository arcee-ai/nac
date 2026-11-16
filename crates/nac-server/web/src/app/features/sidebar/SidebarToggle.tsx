import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Tooltip,
} from "@/app/atoms";
import { TooltipPosition } from "@/app/atoms/tooltip";
import { cn } from "@/app/lib/cn";

import { SIDEBAR_TOGGLE_KEYS, useSidebar } from "./useSidebar";

/**
 * "Show sidebar": renders only while the sidebar is hidden on a width that has
 * one, so any page header can always include it and never shows a dead
 * control. (Session header: place it first in the 52px header row.)
 */
export function SidebarToggle({ className }: { className?: string }) {
  const { mode, open, toggle } = useSidebar();
  if (mode === "none" || open) return null;
  return (
    <Tooltip
      title="Show sidebar"
      keyboardShortcuts={SIDEBAR_TOGGLE_KEYS}
      position={TooltipPosition.BottomRight}
      sticky
    >
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Icon}
        aria-label="Show sidebar"
        className={cn("shrink-0", className)}
        onClick={toggle}
      >
        <Icon iconName={IconName.LeftSidebar} />
      </Button>
    </Tooltip>
  );
}
