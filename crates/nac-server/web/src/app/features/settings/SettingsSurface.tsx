import type { ReactNode } from "react";

import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";

/**
 * The page frame a list-and-form manager (Configurations, MCP servers, SSH
 * hosts) renders into on the Settings page instead of a dialog: one hairline
 * card with the list beside the form and the form's explicit Save row below.
 *
 * `data-settings-surface` is the focus boundary the forms use to place late
 * validation feedback, the way they use `data-modal-open` inside a dialog.
 */
export function SettingsSurface({
  label,
  footer,
  children,
  className,
}: {
  label: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const isMobile = useIsMobile();
  return (
    <section
      data-settings-surface="true"
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-col rounded-card border border-tertiary bg-elevation-level-1",
        !isMobile && "h-[min(720px,calc(100dvh-180px))] min-h-[440px] overflow-hidden",
        className,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row [&>*:only-child]:min-w-0 [&>*:only-child]:flex-1">
        {children}
      </div>
      {footer ? (
        <footer
          className={cn(
            "settings-surface-footer flex shrink-0 items-center justify-end gap-2 border-t border-tertiary px-4 py-3",
            isMobile &&
              "sticky bottom-0 z-10 rounded-b-card bg-elevation-level-1 pb-[max(12px,env(safe-area-inset-bottom))]",
          )}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
