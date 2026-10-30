import type { ReactNode } from "react";

import { PanelPhoneScreen } from "@/app/components/inspector/PanelPhoneScreen";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";

/** A line standing in for a list's rows, inset and sized like their labels on a phone. */
export function PanelListNote({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <p className={cn("text-basic-muted", isMobile ? "px-3 py-2 label-small" : "p-1 label-micro")}>
      {children}
    </p>
  );
}

/**
 * A panel that could not load. A phone still draws it as a screen of its own,
 * with the header's way out and the tab bar.
 */
export function PanelFailure({ listTitle, children }: { listTitle: string; children: ReactNode }) {
  const isMobile = useIsMobile();
  const message = (
    <div className={cn("p-6 label-small text-error-primary", isMobile && "pt-20")}>{children}</div>
  );
  if (!isMobile) return message;
  return (
    <PanelPhoneScreen title={listTitle} bar>
      {message}
    </PanelPhoneScreen>
  );
}

/**
 * A panel with nothing in it yet, centred in the whole box instead of split
 * into a list and its detail. A phone still draws it as a screen of its own,
 * with the header's way out and the tab bar.
 */
export function PanelEmptyState({
  listTitle,
  title,
  description,
  phoneLead,
}: {
  listTitle: string;
  title: string;
  description?: string;
  /** What heads the list on a phone, kept above the message there. */
  phoneLead?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const message = (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 min-h-0 w-full p-8 text-center">
      <p className="header-md w-full truncate text-basic-primary">{title}</p>
      {description ? (
        <p className="text-small w-full truncate text-basic-tertiary" title={description}>
          {description}
        </p>
      ) : null}
    </div>
  );
  if (!isMobile) return message;
  return (
    <PanelPhoneScreen title={listTitle} bar>
      {phoneLead ? <div className="shrink-0 px-2 pt-16">{phoneLead}</div> : null}
      <div className={cn("flex flex-1 flex-col min-h-0", phoneLead ? "pb-14" : "py-14")}>
        {message}
      </div>
    </PanelPhoneScreen>
  );
}
