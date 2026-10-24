import type { ReactNode } from "react";

import { InsightItemCodeDisplayerState, InsightShowFullButton } from "@/app/atoms";
import type { InsightSegment } from "@/app/features/insights/model/types";
import { useFullContent } from "@/app/features/insights/presentation/items/useFullContent";
import type { ToolPresentation } from "@/app/lib/toolPresentation";

/** How the backend ends a result preview it cut, or one that leaves lines out. */
const CUT_PREVIEW = "...";

function errorMessage({ status, statusLabel }: ToolPresentation, result: string | null): string {
  if (status === "error") return result || statusLabel;
  return result ? `${statusLabel}: ${result}` : statusLabel;
}

/**
 * The mutation tools fail with `{ "error": …, "message": … }`. Their preview
 * is the message, so the full line is too.
 */
function errorText(output: string): string {
  const text = output.trim();
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      const { message } = parsed;
      if (typeof message === "string" && message) return message;
    }
  } catch {
    // Not JSON, so it reads as returned.
  }
  return text;
}

/**
 * A failed call's error line is its result preview. When the backend cut the
 * preview, the line offers the call's full output the way a field does.
 */
export function useErrorLine(
  segment: InsightSegment,
  sessionId: string,
  failed: boolean,
): { message: string | null; action: ReactNode } {
  const presentation = failed && segment.kind === "tool" ? segment.presentation : null;
  const preview = presentation?.resultPreview ?? null;
  const callId = preview?.endsWith(CUT_PREVIEW) ? presentation?.callId || null : null;
  const full = useFullContent(sessionId, callId);
  if (!presentation) return { message: null, action: null };
  const output = full.content?.output;
  const message = errorMessage(presentation, output == null ? preview : errorText(output));
  if (!callId) return { message, action: null };
  const expanded = full.state === InsightItemCodeDisplayerState.Expanded;
  return {
    message,
    action: (
      <>
        {full.failed ? (
          <p role="alert" className="break-words text-micro text-error-primary">
            Could not load the full error.
          </p>
        ) : null}
        <InsightShowFullButton
          expanded={expanded}
          loading={full.state === InsightItemCodeDisplayerState.Loading}
          onClick={expanded ? full.hide : full.showFull}
        />
      </>
    ),
  };
}
