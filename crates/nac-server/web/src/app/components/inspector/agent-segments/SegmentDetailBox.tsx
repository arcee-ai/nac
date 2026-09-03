import { memo } from "react";

import { FileSegmentButton } from "@/app/components/inspector/agent-segments/FileSegmentButton";
import { Markdown } from "@/app/lib/markdown";
import { cn } from "@/app/lib/cn";

export type SidebarBoxAccent = "info" | "error";

export type SidebarBoxContent =
  | {
      kind: "markdown";
      key: string;
      content: string;
      accent?: SidebarBoxAccent;
    }
  | { kind: "code"; key: string; content: string; accent?: SidebarBoxAccent }
  | { kind: "file"; key: string; path: string; directory?: boolean }
  | { kind: "more"; key: string; count: number }
  | { kind: "muted"; key: string; content: string };

function boxTextClass(accent: SidebarBoxAccent | undefined): string {
  if (accent === "error") return "text-error-primary";
  if (accent === "info") return "text-info-primary";
  return "text-basic-secondary";
}

export function SegmentDetailBox({ box }: { box: SidebarBoxContent }) {
  if (box.kind === "file") {
    return <FileSegmentButton path={box.path} directory={box.directory} />;
  }
  if (box.kind === "more") {
    return <span className="label-micro text-basic-muted px-2">+{box.count} more</span>;
  }
  if (box.kind === "muted") {
    return <span className="label-micro text-basic-muted px-2">{box.content}</span>;
  }

  return (
    <div
      className={cn(
        "w-full agent-segment-box overflow-hidden",
        box.accent === "error" && "agent-segment-box-error",
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
