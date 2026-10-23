import type React from "react";

import { cn } from "../../lib/cn";

interface InsightCodeBoxProps {
  /** "Input" or "Output". Some types show bare boxes. */
  label?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Monospace box for a tool's input or output inside an `InsightItem`. Long
 * lines wrap instead of scrolling sideways, so the detail column stays the
 * only scroller. A labelled box that is not the last child of the item's
 * column keeps 8px more room below it, which is how the design sets "Input"
 * apart from "Output" or from the error message.
 */
const InsightCodeBox: React.FC<InsightCodeBoxProps> = ({ label, children, className }) => (
  <div className={cn("flex w-full min-w-0 flex-col gap-1", label && "not-last:pb-2", className)}>
    {label ? <span className="label-micro text-basic-primary">{label}</span> : null}
    <div className="w-full rounded-[8px] border border-input bg-input p-1">
      <div className="px-1 code code-small text-input whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  </div>
);

export default InsightCodeBox;
