import { memo } from "react";

import { cn } from "@/app/lib/cn";
import {
  GLOB_EMPTY_RESULT_LABEL,
  isEmptyGlobResultPreview,
  type ToolPresentation,
} from "@/app/lib/toolPresentation";

const STATUS_MARK: Record<ToolPresentation["status"], string> = {
  pending: "○",
  running: "▸",
  success: "✓",
  error: "✕",
  "timed-out": "◷",
  cancelled: "■",
  interrupted: "!",
};

/** Compact primary-transcript presentation for one safe tool lifecycle. */
export const ToolCallDetail = memo(function ToolCallDetail({ tool }: { tool: ToolPresentation }) {
  const pending = tool.status === "pending" || tool.status === "running";
  const emptyGlob = tool.name === "glob" && isEmptyGlobResultPreview(tool.resultPreview);
  const resultPreview = emptyGlob ? GLOB_EMPTY_RESULT_LABEL : tool.resultPreview;
  return (
    <div
      className="my-3 w-full max-w-full min-w-0 rounded-[6px] border border-tertiary px-3 py-2"
      data-tool-call-id={tool.callId}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          aria-hidden="true"
          className={cn(
            "code code-small shrink-0",
            pending
              ? "text-shimmer-basic"
              : tool.status === "success"
                ? "text-success-primary"
                : "text-error-primary",
          )}
        >
          {STATUS_MARK[tool.status]}
        </span>
        <span className="label-small break-words text-basic-primary">{tool.label}</span>
        {tool.summary ? (
          <span className="code code-small min-w-0 break-all text-basic-tertiary">
            {tool.summary}
          </span>
        ) : null}
        <span
          aria-label={`${tool.label} status: ${tool.statusLabel}`}
          className={cn(
            "label-micro shrink-0",
            pending ? "text-basic-secondary" : "text-basic-muted",
          )}
        >
          {tool.statusLabel}
        </span>
      </div>
      {resultPreview ? (
        <p
          className={cn(
            emptyGlob
              ? "label-micro mt-1 min-w-0 pl-5 text-basic-muted"
              : "code code-small mt-1 min-w-0 break-all pl-5",
            !emptyGlob &&
              (tool.status === "error" || tool.resultPreview?.startsWith("Error:")
                ? "text-error-primary"
                : "text-basic-tertiary"),
          )}
        >
          {resultPreview}
        </p>
      ) : null}
    </div>
  );
});
