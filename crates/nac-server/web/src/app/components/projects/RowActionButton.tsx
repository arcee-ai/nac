import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  type IconName,
  Tooltip,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * One control at the end of a list row. Phone controls keep a 44px target;
 * desktop controls retain the compact row's existing size.
 */
export function RowActionButton({
  icon,
  label,
  title,
  isMobile = false,
  destructive = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  title?: string;
  isMobile?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={title ?? label} sticky>
      <Button
        variant={destructive ? ButtonVariant.GhostDestructive : ButtonVariant.Ghost}
        size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
        content={ButtonContent.Icon}
        aria-label={label}
        className={cn(isMobile && "!size-11 !rounded-lg !p-0")}
        onClick={onClick}
      >
        <Icon iconName={icon} />
      </Button>
    </Tooltip>
  );
}
