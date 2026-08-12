import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

type Props = {
  title: string;
  subtitle: string | null;
  trailing?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  variant?: "default" | "compact";
};

export function RevisionRowButton({
  title,
  subtitle,
  trailing,
  selected,
  onClick,
  variant = "default",
}: Props) {
  const compact = variant === "compact";
  return (
    <button
      type="button"
      className={cn(
        "flex items-start gap-2 w-full text-left",
        compact
          ? "p-1 rounded-[4px] btn-ghost"
          : `p-2 rounded-[8px] ${selected ? "btn-ghost-highlighted" : "btn-ghost"}`,
      )}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon
        iconName={selected ? IconName.Check : IconName.History}
        size={compact ? 16 : 20}
        className="shrink-0 mt-[2px]"
      />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className={cn("truncate", compact ? "label-micro text-btn-secondary" : "label-medium text-basic-primary")}>
          {title}
        </span>
        {subtitle ? (
          <span className={cn("truncate", compact ? "label-micro" : "label-small", "text-basic-muted")}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className={cn("shrink-0 flex items-center gap-1 code code-small", compact ? "mt-[2px]" : "mt-[6px]")}>
          {trailing}
        </span>
      ) : null}
    </button>
  );
}
