import { memo } from "react";

import { cn } from "@/app/lib/cn";
import type { ToolPresentation } from "@/app/lib/toolPresentation";

const STATUS_TONE: Record<ToolPresentation["status"], string> = {
  pending: "text-basic-tertiary",
  running: "text-basic-secondary",
  "awaiting-approval": "text-[var(--f-amber-text)]",
  success: "text-basic-muted",
  error: "text-error-primary",
  "timed-out": "text-error-primary",
  cancelled: "text-basic-muted",
  interrupted: "text-error-primary",
  unknown: "text-basic-muted",
};

/**
 * What one tool call did, as a fold row opens it: the call's product label and
 * status in words, the bounded argument it acted on, and the bounded preview of
 * what came back. Never the raw tool body.
 */
export const ToolCallDetail = memo(function ToolCallDetail({ tool }: { tool: ToolPresentation }) {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-2" data-tool-call-id={tool.callId}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="type-meta-strong text-basic-secondary">{tool.label}</span>
        <span
          aria-label={`${tool.label} status: ${tool.statusLabel}`}
          className={cn("type-meta", STATUS_TONE[tool.status])}
        >
          {tool.statusLabel}
        </span>
      </div>
      {tool.summary ? (
        <p className="code code-small !my-0 min-w-0 break-all whitespace-pre-wrap text-basic-secondary">
          {tool.summary}
        </p>
      ) : null}
      {tool.resultPreview ? (
        <pre
          className={cn(
            "code code-small !my-0 max-h-60 min-w-0 overflow-auto rounded-md border border-muted",
            "bg-[var(--color-code-bg)] px-3 py-2 break-all whitespace-pre-wrap text-basic-tertiary",
          )}
        >
          {tool.resultPreview}
        </pre>
      ) : null}
    </div>
  );
});
