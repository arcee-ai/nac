import { cn } from "@/app/lib/cn";

/** Count sitting on a panel icon. Shared by the side box tabs and the collapsed rail. */
export function PanelCountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-btn-primary-disabled px-0.5 text-[9px] leading-3 font-medium tracking-[-0.05em] text-basic-secondary",
        className,
      )}
    >
      {count}
    </span>
  );
}
