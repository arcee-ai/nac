import { memo } from "react";

import { FileSegmentButton } from "@/app/components/inspector/agent-segments/FileSegmentButton";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";

export type SegmentDetailBoxAccent = "info" | "error";

export type SegmentDetailBoxContent =
  | { kind: "markdown"; key: string; content: string; accent?: SegmentDetailBoxAccent }
  | { kind: "code"; key: string; content: string; accent?: SegmentDetailBoxAccent }
  | { kind: "file"; key: string; path: string; directory?: boolean }
  | { kind: "more"; key: string; count: number }
  | { kind: "muted"; key: string; content: string };

function boxTextClass(accent: SegmentDetailBoxAccent | undefined): string {
  if (accent === "error") return "text-error-primary";
  if (accent === "info") return "text-info-primary";
  return "text-basic-secondary";
}

function SegmentDetailBox({ box }: { box: SegmentDetailBoxContent }) {
  if (box.kind === "file") {
    return <FileSegmentButton path={box.path} directory={box.directory} />;
  }
  if (box.kind === "more") {
    return <span className="label-micro px-2 text-basic-muted">+{box.count} more</span>;
  }
  if (box.kind === "muted") {
    return <span className="label-micro px-2 text-basic-muted">{box.content}</span>;
  }

  return (
    <div
      className={cn(
        "agent-segment-box w-full overflow-hidden rounded-[6px] border border-tertiary bg-elevation-low px-3 py-2",
        box.accent === "error" && "agent-segment-box-error border-error-primary",
      )}
    >
      {box.kind === "code" ? (
        <pre className={cn("agent-segment-code-pre code-small", boxTextClass(box.accent))}>
          <code>{box.content}</code>
        </pre>
      ) : (
        <Markdown className={boxTextClass(box.accent)}>{box.content}</Markdown>
      )}
    </div>
  );
}

export default memo(SegmentDetailBox);
