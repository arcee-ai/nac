import { Button, ButtonContent, ButtonSize, ButtonVariant, Icon, type IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * One control at the end of a list row. A phone row draws a bare 20px glyph
 * 12px from its neighbour; the box keeps that size, and an invisible margin
 * around it takes the target to 32px without reaching the next one.
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
    <Button
      variant={destructive ? ButtonVariant.GhostDestructive : ButtonVariant.Ghost}
      size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
      content={ButtonContent.Icon}
      title={title ?? label}
      aria-label={label}
      // `.btn-medium.btn-icon` sets the 36px box in unlayered CSS.
      className={cn(
        isMobile && "relative !h-5 !rounded-[8px] !p-0 after:absolute after:-inset-1.5",
      )}
      onClick={onClick}
    >
      <Icon iconName={icon} />
    </Button>
  );
}
