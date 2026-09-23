import { cn } from "@/app/lib/cn";

export function ToolCallLabel({
  label,
  statusLabel,
  active = false,
  failed = false,
  className,
}: {
  label: string;
  statusLabel: string;
  active?: boolean;
  failed?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-baseline gap-2", className)}>
      <span
        className={cn(
          "label-micro min-w-0 truncate",
          active ? "text-shimmer-basic" : failed ? "text-error-primary" : "text-basic-primary",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-micro shrink-0 whitespace-nowrap",
          failed ? "text-error-primary" : "text-basic-muted",
        )}
      >
        {statusLabel}
      </span>
    </div>
  );
}
