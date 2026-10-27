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
