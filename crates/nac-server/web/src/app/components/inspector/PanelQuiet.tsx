import type { ReactNode } from "react";

import { cn } from "@/app/lib/cn";

/**
 * The drawer panels' empty, waiting and failed detail: one quiet line, an
 * optional lead above it and an optional action below, centred in whatever
 * room the panel has. No illustration; the line says what is missing.
 */
export function PanelQuiet({
  title,
  children,
  action,
  tone,
  live,
}: {
  /** A short lead in full ink, e.g. "No terminal open". */
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  /** A failure reads in the error tone. */
  tone?: "error";
  /** Announce the line: "status" while waiting, "alert" for a failure. */
  live?: "status" | "alert";
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto px-8 py-16 text-center">
      <div role={live} className="flex max-w-80 flex-col items-center gap-1">
        {title ? <p className="type-label text-basic-primary">{title}</p> : null}
        {children ? (
          <p
            className={cn(
              "type-body-chrome break-words",
              tone === "error" ? "text-error-primary" : "text-basic-tertiary",
            )}
          >
            {children}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
