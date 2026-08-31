import { memo } from "react";

import { Markdown } from "@/app/lib/markdown";
import { cn } from "@/app/lib/cn";

export type SidebarBoxContent =
  | { kind: "markdown"; key: string; content: string }
  | { kind: "code"; key: string; content: string };

export function SegmentDetailBox({
  box,
  size = "small",
}: {
  box: SidebarBoxContent;
  size?: "small" | "medium";
}) {
  const boxed =
    size === "medium"
      ? "rounded-lg p-4 bg-elevation-sublevel-variant-A shadow-concave"
      : "rounded-lg p-2 bg-elevation-sublevel-variant-A shadow-concave";
  return (
    <div className={cn(boxed, "w-full agent-segment-box overflow-hidden")}>
      {box.kind === "code" ? (
        <pre className="agent-segment-code-pre code-small">
          <code>{box.content}</code>
        </pre>
      ) : (
        <Markdown className="text-basic-tertiary">{box.content}</Markdown>
      )}
    </div>
  );
}

export default memo(SegmentDetailBox);
