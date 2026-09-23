import { memo } from "react";

import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";

export type SegmentDetailBoxContent =
  | { kind: "markdown"; key: string; content: string; error?: boolean }
  | { kind: "code"; key: string; content: string; error?: boolean };

function SegmentDetailBox({ box }: { box: SegmentDetailBoxContent }) {
  return (
    <div
      className={cn(
        "agent-segment-box w-full overflow-hidden rounded-[6px] border border-tertiary bg-elevation-low px-3 py-2",
        box.error && "agent-segment-box-error border-error-primary",
      )}
    >
      {box.kind === "code" ? (
        <pre
          className={cn(
            "agent-segment-code-pre code-small",
            box.error ? "text-error-primary" : "text-basic-secondary",
          )}
        >
          <code>{box.content}</code>
        </pre>
      ) : (
        <Markdown className={box.error ? "text-error-primary" : "text-basic-secondary"}>
          {box.content}
        </Markdown>
      )}
    </div>
  );
}

export default memo(SegmentDetailBox);
